import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/** GET /api/staff/assignments — events this staff member is assigned to. */
export async function GET() {
  try {
    const user = await requireRole('EVENT_STAFF')

    const assignments = await db.staffAssignment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      include: {
        event: { include: { ticketTypes: { select: { totalQuantity: true, soldQuantity: true } } } },
      },
    })

    const rows = await Promise.all(
      assignments.map(async (a) => {
        const [checkedInCount] = await Promise.all([
          db.ticket.count({ where: { eventId: a.eventId, status: 'CHECKED_IN' } }),
        ])
        const totalTickets = a.event.ticketTypes.reduce((sum, tt) => sum + tt.soldQuantity, 0)
        return {
          id: a.id,
          checkedInCount,
          totalTickets,
          event: {
            id: a.event.id,
            title: a.event.title,
            venue: a.event.venue,
            city: a.event.city,
            banner: a.event.banner,
            startDate: a.event.startDate,
            startTime: a.event.startTime,
            status: a.event.status,
            ticketTypes: a.event.ticketTypes,
          },
        }
      })
    )

    return NextResponse.json({ assignments: rows })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/staff/assignments failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load assignments' }, { status: 500 })
  }
}
