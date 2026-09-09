import { NextRequest, NextResponse } from 'next/server'
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

/**
 * GET /api/orders/[id] — order details for the owner or a SUPER_ADMIN.
 * Also used as the server-side payment verification source.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    const { id } = await params

    const order = await db.order.findUnique({ where: { id }, include: ORDER_INCLUDE })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    if (order.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'You do not have permission to view this order' }, { status: 403 })
    }

    return NextResponse.json({ order })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/orders/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load order' }, { status: 500 })
  }
}
