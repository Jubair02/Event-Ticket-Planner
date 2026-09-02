import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/** POST /api/staff/checkin — check an ACTIVE ticket in (assignment required). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireRole('EVENT_STAFF')

    const body = (await req.json().catch(() => null)) as { ticketId?: unknown } | null
    const ticketId = typeof body?.ticketId === 'string' ? body.ticketId : ''
    if (!ticketId) return NextResponse.json({ error: 'Ticket is required' }, { status: 400 })

    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        ticketType: { select: { name: true, price: true } },
        event: { select: { id: true, title: true, startDate: true, startTime: true, venue: true } },
        user: { select: { name: true } },
        order: { select: { orderNumber: true } },
      },
    })
    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })

    const assignment = await db.staffAssignment.findFirst({
      where: { userId: user.id, eventId: ticket.eventId },
    })
    if (!assignment) {
      return NextResponse.json({ error: 'You are not assigned to this event' }, { status: 403 })
    }

    if (ticket.status === 'CHECKED_IN') {
      return NextResponse.json({ error: 'ALREADY_CHECKED_IN', checkedInAt: ticket.checkedInAt }, { status: 409 })
    }
    if (ticket.status === 'CANCELLED') {
      return NextResponse.json({ error: 'This ticket has been cancelled' }, { status: 400 })
    }
    if (ticket.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'This ticket is not valid for check-in' }, { status: 400 })
    }

    const updated = await db.ticket.update({
      where: { id: ticket.id },
      data: {
        status: 'CHECKED_IN',
        checkedInAt: new Date(),
        checkedInById: user.id,
      },
      include: {
        ticketType: { select: { name: true, price: true } },
        event: { select: { id: true, title: true, startDate: true, startTime: true, venue: true } },
        user: { select: { name: true } },
        order: { select: { orderNumber: true } },
      },
    })

    return NextResponse.json({ ticket: updated })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/staff/checkin failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Check-in failed' }, { status: 500 })
  }
}
