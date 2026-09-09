import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireAuth } from '@/lib/auth'
import {
  REFUND_DETAIL_INCLUDE,
  serializeRefundForAdmin,
  serializeRefundForCustomer,
} from '@/lib/refund-service'

/**
 * GET /api/refunds/[id] — one refund, at the caller's level of access.
 *
 * The same row serialises two ways: a SUPER_ADMIN gets the full record
 * including the operator trail and the gateway exchange, and the customer who
 * owns it gets status, money and a plain-language timeline. Anyone else gets a
 * 404 rather than a 403, so refund ids are not enumerable.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    const { id } = await params

    const refund = await db.refund.findUnique({ where: { id }, include: REFUND_DETAIL_INCLUDE })
    if (!refund) return NextResponse.json({ error: 'Refund not found' }, { status: 404 })

    if (user.role === 'SUPER_ADMIN') {
      return NextResponse.json({ refund: serializeRefundForAdmin(refund) })
    }
    if (refund.userId !== user.id) {
      return NextResponse.json({ error: 'Refund not found' }, { status: 404 })
    }
    return NextResponse.json({ refund: serializeRefundForCustomer(refund) })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/refunds/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load refund' }, { status: 500 })
  }
}
