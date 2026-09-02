import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/** GET /api/organizer/stats — dashboard overview numbers for the organizer. */
export async function GET() {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })

    const [totalEvents, activeEvents, ticketsSoldAgg, revenueAgg, checkIns, pendingApprovals] =
      await Promise.all([
        db.event.count({ where: { organizerId: organizer.id } }),
        db.event.count({ where: { organizerId: organizer.id, status: { in: ['PUBLISHED', 'ONGOING'] } } }),
        db.ticketType.aggregate({
          _sum: { soldQuantity: true },
          where: { event: { organizerId: organizer.id } },
        }),
        db.order.aggregate({
          _sum: { totalAmount: true },
          where: { paymentStatus: 'PAID', event: { organizerId: organizer.id } },
        }),
        db.ticket.count({
          where: { status: 'CHECKED_IN', event: { organizerId: organizer.id } },
        }),
        db.event.count({ where: { organizerId: organizer.id, status: 'PENDING_APPROVAL' } }),
      ])

    return NextResponse.json({
      stats: {
        totalEvents,
        activeEvents,
        ticketsSold: ticketsSoldAgg._sum.soldQuantity ?? 0,
        revenue: revenueAgg._sum.totalAmount ?? 0,
        checkIns,
        pendingApprovals,
      },
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/organizer/stats failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
