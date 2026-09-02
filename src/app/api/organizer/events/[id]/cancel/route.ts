import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/** POST /api/organizer/events/[id]/cancel — CANCELLED + cancel ACTIVE tickets. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })

    const { id } = await params
    const event = await db.event.findUnique({ where: { id } })
    if (!event || event.organizerId !== organizer.id) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const updated = await db.event.update({
      where: { id: event.id },
      data: { status: 'CANCELLED' },
      include: { ticketTypes: true },
    })
    await db.ticket.updateMany({
      where: { eventId: event.id, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    })

    return NextResponse.json({ event: updated })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/organizer/events/[id]/cancel failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to cancel event' }, { status: 500 })
  }
}
