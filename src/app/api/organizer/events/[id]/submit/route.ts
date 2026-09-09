import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import { jsonSafe } from '@/lib/serialize'

/** POST /api/organizer/events/[id]/submit — DRAFT/REJECTED → PENDING_APPROVAL. */
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
    if (event.status !== 'DRAFT' && event.status !== 'REJECTED') {
      return NextResponse.json(
        { error: 'Only draft or rejected events can be submitted for approval' },
        { status: 400 }
      )
    }

    const updated = await db.event.update({
      where: { id: event.id },
      data: { status: 'PENDING_APPROVAL' },
      include: { ticketTypes: true },
    })
    return NextResponse.json(jsonSafe({ event: updated }))
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/organizer/events/[id]/submit failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to submit event' }, { status: 500 })
  }
}
