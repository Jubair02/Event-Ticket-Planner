import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

const STAFF_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  staffAssignments: { include: { event: { select: { id: true, title: true } } } },
} as const

async function getOwnedStaff(organizerId: string, staffId: string) {
  const staff = await db.user.findUnique({ where: { id: staffId } })
  if (!staff || staff.role !== 'EVENT_STAFF' || staff.createdByOrganizerId !== organizerId) return null
  return staff
}

/** PUT /api/organizer/staff/[id] — replace assignments and/or update status. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })

    const { id } = await params
    const staff = await getOwnedStaff(organizer.id, id)
    if (!staff) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })

    const body = (await req.json().catch(() => null)) as {
      eventIds?: unknown
      status?: unknown
    } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    if (body.status !== undefined) {
      if (body.status !== 'ACTIVE' && body.status !== 'SUSPENDED') {
        return NextResponse.json({ error: 'Status must be ACTIVE or SUSPENDED' }, { status: 400 })
      }
      await db.user.update({ where: { id: staff.id }, data: { status: body.status } })
    }

    if (body.eventIds !== undefined) {
      if (!Array.isArray(body.eventIds)) {
        return NextResponse.json({ error: 'eventIds must be an array' }, { status: 400 })
      }
      const requestedIds = Array.from(
        new Set((body.eventIds as unknown[]).filter((v): v is string => typeof v === 'string'))
      )
      const ownedEvents = requestedIds.length
        ? await db.event.findMany({ where: { id: { in: requestedIds }, organizerId: organizer.id }, select: { id: true } })
        : []

      await db.$transaction([
        db.staffAssignment.deleteMany({ where: { userId: staff.id } }),
        ...ownedEvents.map((ev) =>
          db.staffAssignment.create({ data: { userId: staff.id, eventId: ev.id } })
        ),
      ])
    }

    const fresh = await db.user.findUnique({ where: { id: staff.id }, select: STAFF_SELECT })
    return NextResponse.json({ staff: fresh })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('PUT /api/organizer/staff/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to update staff member' }, { status: 500 })
  }
}

/** DELETE /api/organizer/staff/[id] — removes the staff user (assignments cascade via explicit delete). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })

    const { id } = await params
    const staff = await getOwnedStaff(organizer.id, id)
    if (!staff) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })

    await db.$transaction([
      db.staffAssignment.deleteMany({ where: { userId: staff.id } }),
      db.user.delete({ where: { id: staff.id } }),
    ])

    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('DELETE /api/organizer/staff/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to delete staff member' }, { status: 500 })
  }
}
