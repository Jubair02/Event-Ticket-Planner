import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireAuth } from '@/lib/auth'

const ORDER_INCLUDE = {
  event: {
    select: {
      id: true,
      slug: true,
      title: true,
      banner: true,
      venue: true,
      city: true,
      startDate: true,
      endDate: true,
      startTime: true,
      endTime: true,
      category: true,
      status: true,
    },
  },
  tickets: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      ticketCode: true,
      qrToken: true,
      attendeeName: true,
      status: true,
      checkedInAt: true,
      createdAt: true,
      ticketType: { select: { id: true, name: true, price: true } },
    },
  },
  payments: true,
} as const

/** GET /api/orders/mine — the signed-in customer's orders, newest first. */
export async function GET() {
  try {
    const user = await requireAuth()
    const orders = await db.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: ORDER_INCLUDE,
    })
    return NextResponse.json({ orders })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/orders/mine failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load your orders' }, { status: 500 })
  }
}
