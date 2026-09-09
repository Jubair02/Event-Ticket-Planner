import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import { fromDbMinor } from '@/lib/money'
import { accountBalanceMinor } from '@/lib/ledger'

const MAX_ROWS = 200

const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED']

/**
 * GET /api/admin/payments?status=&method=&q=
 *
 * The money that has come in, plus the ledger's view of where it now sits.
 *
 * This is read-only on purpose. A payment is a record of what the gateway did;
 * correcting one means posting a refund or an adjustment, both of which have
 * their own audited paths, so there is nothing here to edit.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole('SUPER_ADMIN')

    const sp = req.nextUrl.searchParams
    const status = sp.get('status')?.trim()
    const method = sp.get('method')?.trim()
    const q = sp.get('q')?.trim()

    if (status && status !== 'ALL' && !PAYMENT_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Unknown payment status filter' }, { status: 400 })
    }

    const where: Prisma.PaymentWhereInput = {
      ...(status && status !== 'ALL' ? { status } : {}),
      ...(method && method !== 'ALL' ? { method } : {}),
      ...(q
        ? {
            OR: [
              { transactionId: { contains: q, mode: 'insensitive' } },
              { order: { orderNumber: { contains: q, mode: 'insensitive' } } },
              { order: { user: { email: { contains: q, mode: 'insensitive' } } } },
              { order: { user: { name: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    }

    const [rows, grouped, clearing, cash, revenue, payable] = await Promise.all([
      db.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        select: {
          id: true,
          amountMinor: true,
          gatewayFeeMinor: true,
          currency: true,
          provider: true,
          method: true,
          status: true,
          paidAt: true,
          createdAt: true,
          transactionId: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              totalMinor: true,
              refundedMinor: true,
              paymentStatus: true,
              user: { select: { id: true, name: true, email: true } },
              event: { select: { id: true, slug: true, title: true } },
            },
          },
        },
      }),
      db.payment.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amountMinor: true } }),
      accountBalanceMinor(db, 'GATEWAY_CLEARING'),
      accountBalanceMinor(db, 'CASH'),
      accountBalanceMinor(db, 'PLATFORM_REVENUE'),
      accountBalanceMinor(db, 'ORGANIZER_PAYABLE'),
    ])

    return NextResponse.json({
      payments: rows.map((p) => ({
        id: p.id,
        amountMinor: fromDbMinor(p.amountMinor),
        gatewayFeeMinor: fromDbMinor(p.gatewayFeeMinor),
        currency: p.currency,
        provider: p.provider,
        method: p.method,
        status: p.status,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        // A pending payment parks the order's item list here until the gateway
        // hands back a real id, so it is only shown once it means something.
        transactionId: p.status === 'PAID' ? p.transactionId : null,
        order: {
          id: p.order.id,
          orderNumber: p.order.orderNumber,
          totalMinor: fromDbMinor(p.order.totalMinor),
          refundedMinor: fromDbMinor(p.order.refundedMinor),
          paymentStatus: p.order.paymentStatus,
        },
        customer: p.order.user,
        event: p.order.event,
      })),
      counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      totalsMinor: Object.fromEntries(
        grouped.map((g) => [g.status, fromDbMinor(g._sum.amountMinor)])
      ),
      /**
       * Straight from the ledger rather than re-summed from the rows above, so
       * this panel and the books can never disagree.
       */
      ledger: {
        gatewayClearingMinor: clearing,
        cashMinor: cash,
        platformRevenueMinor: revenue,
        organizerPayableMinor: payable,
      },
      truncated: rows.length === MAX_ROWS,
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/admin/payments failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load payments' }, { status: 500 })
  }
}
