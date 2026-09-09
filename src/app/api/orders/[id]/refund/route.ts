import { NextRequest, NextResponse } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth'
import { MINUTE, clientIp, enforceRateLimits } from '@/lib/rate-limit'
import { db } from '@/lib/db'
import { RefundError } from '@/lib/refunds'
import {
  actorFromUser,
  createRefund,
  planRefund,
  serializeRefundForCustomer,
} from '@/lib/refund-service'

/**
 * The customer's own refund endpoint for one order.
 *
 * Two things are deliberately absent from the request contract:
 *
 * - **An amount.** A partial refund is expressed as `ticketIds`, and the server
 *   prices those tickets from the stored ticket-type prices. A body carrying an
 *   `amount` is rejected outright rather than ignored, so a client written
 *   against the wrong assumption fails loudly instead of quietly getting a
 *   different number than it asked for.
 * - **A reason code.** Customers always file CUSTOMER_REQUEST, which is what
 *   puts them in the tiered voluntary-cancellation policy. Letting them name
 *   EVENT_CANCELLED would let them pick the 100% policy for themselves.
 */

function parseTicketIds(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw)) return null
  const ids = raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
  return ids.length > 0 ? ids : null
}

/** Turns a RefundError into its intended HTTP response. */
function refundErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof RefundError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
  }
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
  return null
}

async function assertOwnOrder(orderId: string, userId: string, role: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { userId: true } })
  if (!order) throw new RefundError('Order not found.', 404, 'REFUND_ORDER_NOT_FOUND')
  if (order.userId !== userId && role !== 'SUPER_ADMIN') {
    throw new RefundError('You do not have permission to refund this order.', 403, 'REFUND_FORBIDDEN')
  }
}

/**
 * GET /api/orders/[id]/refund — what this order would be refunded, and why.
 *
 * The preview runs the same `planRefund` the creation path runs, so the figure
 * shown to the customer is the figure that gets written. `?ticketIds=a,b`
 * prices a subset.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    const { id } = await params
    await assertOwnOrder(id, user.id, user.role)

    const raw = req.nextUrl.searchParams.get('ticketIds')
    const ticketIds = raw
      ? raw
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : null

    const plan = await planRefund(db, {
      orderId: id,
      ticketIds,
      reasonCode: 'CUSTOMER_REQUEST',
      initiatedBy: 'CUSTOMER',
    })

    return NextResponse.json({
      quote: {
        type: plan.type,
        policy: plan.policy,
        currency: plan.quote.currency,
        amountMinor: plan.quote.amountMinor,
        ticketFaceValueMinor: plan.quote.ticketFaceValueMinor,
        platformFeeRefundedMinor: plan.quote.platformFeeRefundedMinor,
        processingFeeMinor: plan.quote.processingFeeMinor,
        grossTicketValueMinor: plan.quote.grossTicketValueMinor,
        refundableRemainingMinor: plan.quote.refundableRemainingMinor,
        tickets: plan.tickets.map((t) => ({
          ticketId: t.id,
          ticketCode: t.ticketCode,
          ticketTypeName: t.ticketTypeName,
          faceValueMinor: t.faceValueMinor,
          status: t.status,
        })),
        lines: plan.quote.lines,
      },
    })
  } catch (e) {
    const mapped = refundErrorResponse(e)
    if (mapped) return mapped
    console.error('GET /api/orders/[id]/refund failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to price a refund for this order' }, { status: 500 })
  }
}

/**
 * POST /api/orders/[id]/refund — file a refund request.
 *
 * Lands in REQUESTED for an admin to approve. Rate limited because a refund
 * request is a write that claims tickets, and a loop of them would lock up an
 * order's tickets and fill the review queue.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    const { id } = await params

    const limited = enforceRateLimits([
      { key: `refund-req:ip:${clientIp(req)}`, limit: 20, windowMs: 10 * MINUTE },
      { key: `refund-req:user:${user.id}`, limit: 5, windowMs: 10 * MINUTE },
    ])
    if (limited) return limited

    await assertOwnOrder(id, user.id, user.role)

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (body && ('amount' in body || 'amountMinor' in body)) {
      return NextResponse.json(
        {
          error:
            'Refund amounts are calculated by the server. Send the ticket ids you want refunded instead of an amount.',
          code: 'REFUND_AMOUNT_NOT_ACCEPTED',
        },
        { status: 400 }
      )
    }

    const ticketIds = parseTicketIds(body?.ticketIds)
    const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null

    const refund = await createRefund({
      orderId: id,
      ticketIds,
      reasonCode: 'CUSTOMER_REQUEST',
      reasonNote: note,
      initiatedBy: 'CUSTOMER',
      actor: actorFromUser(user, clientIp(req)),
    })

    return NextResponse.json({ refund: serializeRefundForCustomer(refund) }, { status: 201 })
  } catch (e) {
    const mapped = refundErrorResponse(e)
    if (mapped) return mapped
    console.error('POST /api/orders/[id]/refund failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to request a refund' }, { status: 500 })
  }
}
