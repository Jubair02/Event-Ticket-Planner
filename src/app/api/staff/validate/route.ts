import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/**
 * POST /api/staff/validate — look up a ticket by QR token or ticket code.
 * Always 200 with a `result`; INVALID when the code matches nothing,
 * NOT_ASSIGNED when the ticket's event is not in the staff member's assignments.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireRole('EVENT_STAFF')

    const body = (await req.json().catch(() => null)) as { code?: unknown } | null
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!code) return NextResponse.json({ result: 'INVALID', error: 'Empty code' })

    const ticket = await db.ticket.findFirst({
      where: { OR: [{ qrToken: code }, { ticketCode: code }] },
      include: {
        ticketType: { select: { name: true, price: true } },
        event: { select: { id: true, title: true, startDate: true, startTime: true, venue: true } },
        user: { select: { name: true } },
        order: { select: { orderNumber: true } },
      },
    })
    if (!ticket) return NextResponse.json({ result: 'INVALID' })

    const assignment = await db.staffAssignment.findFirst({
      where: { userId: user.id, eventId: ticket.eventId },
    })
    if (!assignment) return NextResponse.json({ result: 'NOT_ASSIGNED' })

    const result =
      ticket.status === 'ACTIVE'
        ? 'VALID'
        : ticket.status === 'CHECKED_IN'
          ? 'ALREADY_CHECKED_IN'
          : ticket.status === 'CANCELLED'
            ? 'CANCELLED'
            : 'INVALID'

    return NextResponse.json({
      result,
      ticket: {
        id: ticket.id,
        ticketCode: ticket.ticketCode,
        attendeeName: ticket.attendeeName,
        status: ticket.status,
        checkedInAt: ticket.checkedInAt,
        ticketType: ticket.ticketType,
        event: ticket.event,
        user: ticket.user,
        order: ticket.order,
      },
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/staff/validate failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Validation failed' }, { status: 500 })
  }
}
