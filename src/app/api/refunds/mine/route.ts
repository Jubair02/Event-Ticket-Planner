import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireAuth } from '@/lib/auth'
import { REFUND_DETAIL_INCLUDE, serializeRefundForCustomer } from '@/lib/refund-service'

const MAX_ROWS = 100

/**
 * GET /api/refunds/mine — the signed-in customer's refunds, newest first.
 *
 * Serialised through `serializeRefundForCustomer`, so the response carries the
 * status, the money and a plain-language timeline but none of the operator
 * identities or gateway internals.
 */
export async function GET() {
  try {
    const user = await requireAuth()

    const refunds = await db.refund.findMany({
      where: { userId: user.id },
      orderBy: { requestedAt: 'desc' },
      take: MAX_ROWS,
      include: REFUND_DETAIL_INCLUDE,
    })

    return NextResponse.json({ refunds: refunds.map(serializeRefundForCustomer) })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/refunds/mine failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load your refunds' }, { status: 500 })
  }
}
