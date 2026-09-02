import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/** GET /api/organizer/events/[id]/analytics — per-event sales + check-in stats. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })

    const { id } = await params
    const event = await db.event.findUnique({
      where: { id },
      include: {
        ticketTypes: true,
        organizer: { include: { user: { select: { name: true } } } },
        orders: {
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { name: true } }, _count: { select: { tickets: true } } },
        },
      },
    })
    if (!event || event.organizerId !== organizer.id) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const [checkIns, activeTickets] = await Promise.all([
      db.ticket.count({ where: { eventId: event.id, status: 'CHECKED_IN' } }),
      db.ticket.count({ where: { eventId: event.id, status: 'ACTIVE' } }),
    ])

    const totalTickets = event.ticketTypes.reduce((sum, tt) => sum + tt.totalQuantity, 0)
    const sold = event.ticketTypes.reduce((sum, tt) => sum + tt.soldQuantity, 0)
    const revenue = event.orders
      .filter((o) => o.paymentStatus === 'PAID')
      .reduce((sum, o) => sum + o.totalAmount, 0)

    const recentOrders = event.orders.slice(0, 10).map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      totalAmount: o.totalAmount,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
      user: { name: o.user.name },
      _count: { tickets: o._count.tickets },
    }))

    const ticketTypeBreakdown = event.ticketTypes.map((tt) => ({
      id: tt.id,
      name: tt.name,
      price: tt.price,
      totalQuantity: tt.totalQuantity,
      soldQuantity: tt.soldQuantity,
      revenue: tt.price * tt.soldQuantity,
    }))

    return NextResponse.json({
      analytics: {
        event,
        totalTickets,
        sold,
        available: totalTickets - sold,
        revenue,
        checkIns,
        notArrived: activeTickets,
        recentOrders,
        ticketTypeBreakdown,
      },
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/organizer/events/[id]/analytics failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 })
  }
}
