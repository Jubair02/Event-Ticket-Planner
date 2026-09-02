import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import { CATEGORIES } from '@/lib/constants'

function parseDate(v: unknown): Date | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? 'invalid' : d
}

/**
 * PUT /api/organizer/events/[id] — partial update (owner only).
 * Body may also carry status ONGOING|COMPLETED|CANCELLED for direct transitions;
 * CANCELLED additionally cancels all ACTIVE tickets (refunds are out of MVP scope).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })

    const { id } = await params
    const event = await db.event.findUnique({ where: { id } })
    if (!event || event.organizerId !== organizer.id) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const data: Record<string, unknown> = {}
    const strFields = ['title', 'description', 'venue', 'address', 'city', 'startTime', 'endTime'] as const
    for (const f of strFields) {
      if (typeof body[f] === 'string') {
        const v = (body[f] as string).trim()
        if (!v) return NextResponse.json({ error: `${f} cannot be empty` }, { status: 400 })
        data[f] = v
      }
    }
    if (typeof body.category === 'string') {
      if (!CATEGORIES.includes(body.category as (typeof CATEGORIES)[number])) {
        return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
      }
      data.category = body.category
    }
    if ('banner' in body) data.banner = typeof body.banner === 'string' && body.banner.trim() ? body.banner.trim() : null
    if ('mapUrl' in body) data.mapUrl = typeof body.mapUrl === 'string' && body.mapUrl.trim() ? body.mapUrl.trim() : null

    if ('startDate' in body) {
      const d = parseDate(body.startDate)
      if (d === 'invalid' || d === null) {
        return NextResponse.json({ error: 'Invalid start date' }, { status: 400 })
      }
      data.startDate = d
    }
    if ('endDate' in body) {
      const d = parseDate(body.endDate)
      if (d === 'invalid' || d === null) {
        return NextResponse.json({ error: 'Invalid end date' }, { status: 400 })
      }
      data.endDate = d
    }
    if (data.startDate && data.endDate && (data.endDate as Date).getTime() < (data.startDate as Date).getTime()) {
      return NextResponse.json({ error: 'End date cannot be before the start date' }, { status: 400 })
    }

    let cancelTickets = false
    if (typeof body.status === 'string' && ['ONGOING', 'COMPLETED', 'CANCELLED'].includes(body.status)) {
      data.status = body.status
      if (body.status === 'CANCELLED') cancelTickets = true
    }

    const updated = await db.event.update({ where: { id: event.id }, data })
    if (cancelTickets) {
      await db.ticket.updateMany({
        where: { eventId: event.id, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      })
    }

    const fresh = await db.event.findUnique({
      where: { id: updated.id },
      include: { ticketTypes: true },
    })
    return NextResponse.json({ event: fresh })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('PUT /api/organizer/events/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 })
  }
}

/** DELETE /api/organizer/events/[id] — only when no orders exist. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })

    const { id } = await params
    const event = await db.event.findUnique({ where: { id } })
    if (!event || event.organizerId !== organizer.id) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const ordersCount = await db.order.count({ where: { eventId: event.id } })
    if (ordersCount > 0) {
      return NextResponse.json({ error: 'Cannot delete an event with orders. Cancel it instead.' }, { status: 409 })
    }

    await db.$transaction([
      db.staffAssignment.deleteMany({ where: { eventId: event.id } }),
      db.event.delete({ where: { id: event.id } }), // ticketTypes cascade
    ])

    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('DELETE /api/organizer/events/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 })
  }
}
