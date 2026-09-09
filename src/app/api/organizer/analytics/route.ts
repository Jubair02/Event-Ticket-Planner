import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireOrganizer } from '@/lib/auth'
import { fromDbMinor, mulMinor } from '@/lib/money'

/**
 * GET /api/organizer/analytics
 *
 * One row per event, so an organizer can compare their events without opening
 * each one. `/api/organizer/events/[id]/analytics` is the drill-down.
 *
 * Revenue is summed from paid orders rather than from `price x soldQuantity`.
 * The two used to agree, but an order can now carry a discount, so multiplying
 * the list price would overstate what was actually taken. Capacity numbers
 * still come from the ticket types, which is where they live.
 */
export async function GET() {
  try {
    const { organizer } = await requireOrganizer()

    const [events, revenueByEvent, checkInsByEvent] = await Promise.all([
      db.event.findMany({
        where: { organizerId: organizer.id },
        orderBy: { startDate: 'desc' },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          category: true,
          startDate: true,
          endDate: true,
          ticketTypes: { select: { priceMinor: true, totalQuantity: true, soldQuantity: true } },
        },
      }),
      db.order.groupBy({
        by: ['eventId'],
        _sum: { totalMinor: true, platformFeeMinor: true, refundedMinor: true },
        _count: { _all: true },
        where: { event: { organizerId: organizer.id }, paymentStatus: 'PAID' },
      }),
      db.ticket.groupBy({
        by: ['eventId'],
        _count: { _all: true },
        where: { event: { organizerId: organizer.id }, status: 'CHECKED_IN' },
      }),
    ])

    const revenue = new Map(revenueByEvent.map((r) => [r.eventId, r]))
    const checkIns = new Map(checkInsByEvent.map((r) => [r.eventId, r._count._all]))

    const rows = events.map((e) => {
      const r = revenue.get(e.id)
      const capacity = e.ticketTypes.reduce((sum, t) => sum + t.totalQuantity, 0)
      const sold = e.ticketTypes.reduce((sum, t) => sum + t.soldQuantity, 0)
      // What the tickets would fetch at list price: the ceiling revenue can
      // reach, which is what makes the sell-through figure meaningful.
      const potentialMinor = e.ticketTypes.reduce(
        (sum, t) => sum + mulMinor(fromDbMinor(t.priceMinor), t.totalQuantity),
        0
      )
      const grossMinor = fromDbMinor(r?._sum.totalMinor)
      const refundedMinor = fromDbMinor(r?._sum.refundedMinor)
      const checkedIn = checkIns.get(e.id) ?? 0

      return {
        id: e.id,
        slug: e.slug,
        title: e.title,
        status: e.status,
        category: e.category,
        startDate: e.startDate,
        endDate: e.endDate,
        capacity,
        sold,
        available: Math.max(capacity - sold, 0),
        sellThrough: capacity > 0 ? sold / capacity : 0,
        orders: r?._count._all ?? 0,
        grossMinor,
        refundedMinor,
        netMinor: grossMinor - refundedMinor,
        platformFeeMinor: fromDbMinor(r?._sum.platformFeeMinor),
        potentialMinor,
        checkedIn,
        // Of the tickets sold, how many actually turned up. Only meaningful
        // once something has sold, so it is null rather than 0 before that.
        attendanceRate: sold > 0 ? checkedIn / sold : null,
      }
    })

    const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + pick(r), 0)

    return NextResponse.json({
      events: rows,
      totals: {
        events: rows.length,
        capacity: sum((r) => r.capacity),
        sold: sum((r) => r.sold),
        orders: sum((r) => r.orders),
        grossMinor: sum((r) => r.grossMinor),
        refundedMinor: sum((r) => r.refundedMinor),
        netMinor: sum((r) => r.netMinor),
        platformFeeMinor: sum((r) => r.platformFeeMinor),
        checkedIn: sum((r) => r.checkedIn),
      },
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/organizer/analytics failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 })
  }
}
