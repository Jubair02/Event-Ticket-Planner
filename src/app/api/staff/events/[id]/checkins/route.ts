import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/** GET /api/staff/events/[id]/checkins — latest 50 check-ins for an assigned event. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('EVENT_STAFF')
    const { id } = await params

    const assignment = await db.staffAssignment.findFirst({
      where: { userId: user.id, eventId: id },
    })
    if (!assignment) {
      return NextResponse.json({ error: 'You are not assigned to this event' }, { status: 403 })
    }

    const checkIns = await db.ticket.findMany({
      where: { eventId: id, status: 'CHECKED_IN' },
      orderBy: { checkedInAt: 'desc' },
      take: 50,
      select: {
        id: true,
        ticketCode: true,
        attendeeName: true,
        checkedInAt: true,
        ticketType: { select: { name: true } },
        user: { select: { name: true } },
      },
    })

    return NextResponse.json({ checkIns })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/staff/events/[id]/checkins failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load check-ins' }, { status: 500 })
  }
}
