import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import { clientIp } from '@/lib/rate-limit'
import { fromDbMinor } from '@/lib/money'
import { RefundError, isRefundReasonCode, isRefundStatus } from '@/lib/refunds'
import {
  REFUND_DETAIL_INCLUDE,
  actorFromUser,
  createRefund,
  processRefund,
  serializeRefundForAdmin,
} from '@/lib/refund-service'

const MAX_ROWS = 200

const OWED_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  subtotalMinor: true,
  platformFeeMinor: true,
  totalMinor: true,
  refundedMinor: true,
  paymentStatus: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
  event: { select: { id: true, slug: true, title: true, status: true, startDate: true } },
  _count: { select: { tickets: true } },
} as const

/**
 * GET /api/admin/refunds — the refund desk.
 *
 * Three things an operator needs at once:
 *
 *  - `refunds`  — the queue itself, filterable by `status`, `type`, `eventId`
 *                 and `q` (refund number, order number or customer email).
 *  - `counts`   — how many sit in each state, so REQUESTED and FAILED are
 *                 visible without paging through the list.
 *  - `owed`     — paid orders on cancelled events that have no live refund yet.
 *                 These are the ones the engine has not been pointed at; they
 *                 are money owed that nothing is currently working on.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole('SUPER_ADMIN')

    const sp = req.nextUrl.searchParams
    const status = sp.get('status')?.trim()
    const type = sp.get('type')?.trim()
    const eventId = sp.get('eventId')?.trim()
    const batchId = sp.get('batchId')?.trim()
    const q = sp.get('q')?.trim()

    if (status && !isRefundStatus(status)) {
      return NextResponse.json({ error: 'Unknown refund status filter' }, { status: 400 })
    }

    const where: Prisma.RefundWhereInput = {
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(eventId ? { eventId } : {}),
      ...(batchId ? { batchId } : {}),
      ...(q
        ? {
            OR: [
              { refundNumber: { contains: q, mode: 'insensitive' } },
              { order: { orderNumber: { contains: q, mode: 'insensitive' } } },
              { user: { email: { contains: q, mode: 'insensitive' } } },
              { user: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }

    const [refunds, grouped, owed] = await Promise.all([
      db.refund.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        take: MAX_ROWS,
        include: REFUND_DETAIL_INCLUDE,
      }),
      db.refund.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amountMinor: true } }),
      db.order.findMany({
        where: {
          paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] },
          event: { status: 'CANCELLED' },
          // Anything but a rejected refund counts as "being handled".
          refunds: { none: { status: { not: 'REJECTED' } } },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        select: OWED_ORDER_SELECT,
      }),
    ])

    const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]))
    const totals = Object.fromEntries(
      grouped.map((g) => [g.status, fromDbMinor(g._sum.amountMinor ?? BigInt(0))])
    )

    return NextResponse.json({
      refunds: refunds.map(serializeRefundForAdmin),
      counts,
      totals,
      owed: owed.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        subtotalMinor: fromDbMinor(o.subtotalMinor),
        platformFeeMinor: fromDbMinor(o.platformFeeMinor),
        totalMinor: fromDbMinor(o.totalMinor),
        refundedMinor: fromDbMinor(o.refundedMinor),
        outstandingMinor: fromDbMinor(o.totalMinor) - fromDbMinor(o.refundedMinor),
        paymentStatus: o.paymentStatus,
        createdAt: o.createdAt,
        customer: o.user,
        event: o.event,
        ticketCount: o._count.tickets,
      })),
      owedOutstandingMinor: owed.reduce(
        (sum, o) => sum + (fromDbMinor(o.totalMinor) - fromDbMinor(o.refundedMinor)),
        0
      ),
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/admin/refunds failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load refunds' }, { status: 500 })
  }
}

/**
 * POST /api/admin/refunds — issue a refund as an admin.
 *
 * Body: `{ orderId, ticketIds?, reasonCode, note?, hold?, submit? }`
 *
 * - Omitting `ticketIds` refunds every refundable ticket on the order; passing
 *   a subset makes it a partial refund. There is no amount field: the server
 *   prices the tickets, and a body carrying `amount` is rejected so a
 *   mistaken client fails loudly.
 * - An admin refund is approved on creation, since the admin issuing it *is*
 *   the approval. Pass `hold: true` to leave it in REQUESTED for a second pair
 *   of eyes instead.
 * - `submit: true` also sends it to the gateway in the same request; otherwise
 *   it waits in the APPROVED queue for POST /api/admin/refunds/process.
 */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole('SUPER_ADMIN')
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    if ('amount' in body || 'amountMinor' in body) {
      return NextResponse.json(
        {
          error:
            'Refund amounts are calculated by the server. Send the ticket ids to refund instead of an amount.',
          code: 'REFUND_AMOUNT_NOT_ACCEPTED',
        },
        { status: 400 }
      )
    }

    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : ''
    if (!orderId) return NextResponse.json({ error: 'An order is required' }, { status: 400 })

    const reasonCode = body.reasonCode
    if (!isRefundReasonCode(reasonCode)) {
      return NextResponse.json({ error: 'A valid refund reason is required' }, { status: 400 })
    }

    const ticketIds = Array.isArray(body.ticketIds)
      ? body.ticketIds
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .map((v) => v.trim())
      : null

    const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null
    const actor = actorFromUser(admin, clientIp(req))

    let refund = await createRefund({
      orderId,
      ticketIds: ticketIds && ticketIds.length > 0 ? ticketIds : null,
      reasonCode,
      reasonNote: note,
      initiatedBy: 'ADMIN',
      actor,
      autoApprove: body.hold !== true,
    })

    let gatewayMessage: string | null = null
    if (body.submit === true && refund.status === 'APPROVED') {
      const result = await processRefund({ refundId: refund.id, actor })
      refund = result.refund
      gatewayMessage = result.message
    }

    return NextResponse.json(
      { refund: serializeRefundForAdmin(refund), gatewayMessage },
      { status: 201 }
    )
  } catch (e) {
    if (e instanceof RefundError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/admin/refunds failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to issue refund' }, { status: 500 })
  }
}
