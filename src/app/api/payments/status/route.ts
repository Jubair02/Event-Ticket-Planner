import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireAuth } from '@/lib/auth'

/** GET /api/payments/status?orderId= — polling endpoint for the gateway UI. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const orderId = req.nextUrl.searchParams.get('orderId')
    if (!orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 })

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'You do not have permission to view this payment' }, { status: 403 })
    }

    return NextResponse.json({
      status: order.payments[0]?.status ?? 'PENDING',
      paymentStatus: order.paymentStatus,
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/payments/status failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load payment status' }, { status: 500 })
  }
}
