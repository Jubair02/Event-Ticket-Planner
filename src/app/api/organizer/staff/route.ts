import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, hashPassword, requireRole } from '@/lib/auth'

const STAFF_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  staffAssignments: { include: { event: { select: { id: true, title: true } } } },
} as const

/** GET /api/organizer/staff — event staff created by this organizer. */
export async function GET() {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })

    const staff = await db.user.findMany({
      where: { createdByOrganizerId: organizer.id, role: 'EVENT_STAFF' },
      orderBy: { createdAt: 'desc' },
      select: STAFF_SELECT,
    })
    return NextResponse.json({ staff })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/organizer/staff failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 })
  }
}

/** POST /api/organizer/staff — create an EVENT_STAFF user + event assignments. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })
    if (organizer.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Your organizer account must be approved first' }, { status: 403 })
    }

    const body = (await req.json().catch(() => null)) as {
      name?: unknown
      email?: unknown
      phone?: unknown
      password?: unknown
      eventIds?: unknown
    } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null
    const password = typeof body.password === 'string' ? body.password : ''

    if (!name || !email) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    const existing = await db.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    // Only assign to events owned by this organizer (deduped).
    const requestedIds = Array.isArray(body.eventIds)
      ? Array.from(new Set((body.eventIds as unknown[]).filter((v): v is string => typeof v === 'string')))
      : []
    const ownedEvents = requestedIds.length
      ? await db.event.findMany({ where: { id: { in: requestedIds }, organizerId: organizer.id }, select: { id: true } })
      : []

    const passwordHash = await hashPassword(password)
    const staffUser = await db.user.create({
      data: {
        name,
        email,
        phone,
        password: passwordHash,
        role: 'EVENT_STAFF',
        createdByOrganizerId: organizer.id,
        staffAssignments: {
          create: ownedEvents.map((ev) => ({ eventId: ev.id })),
        },
      },
      select: STAFF_SELECT,
    })

    return NextResponse.json({ staff: staffUser }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/organizer/staff failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to create staff account' }, { status: 500 })
  }
}
