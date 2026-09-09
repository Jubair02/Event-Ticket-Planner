import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import { jsonSafe } from '@/lib/serialize'
import { EVENT_STATUS_LABELS } from '@/lib/constants'

const ACTION_STATUS: Record<string, string | undefined> = {
  approve: 'PUBLISHED',
  restore: 'PUBLISHED',
  reject: 'REJECTED',
  suspend: 'SUSPENDED',
}

/**
 * Which statuses each moderation action may be applied from, mirroring what the
 * admin dashboard offers. Without this the API would happily publish an event
 * the organizer never submitted (e.g. approve straight from DRAFT).
 * feature/unfeature are not transitions, so they are allowed from any status.
 */
const ALLOWED_FROM: Record<string, string[]> = {
  approve: ['PENDING_APPROVAL', 'REJECTED', 'SUSPENDED'],
  reject: ['PENDING_APPROVAL'],
  suspend: ['PUBLISHED', 'ONGOING'],
  restore: ['SUSPENDED'],
}

/** PUT /api/admin/events/[id] — moderation actions on an event. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('SUPER_ADMIN')
    const { id } = await params

    const body = (await req.json().catch(() => null)) as { action?: unknown } | null
    const action = typeof body?.action === 'string' ? body.action : ''
    if (!action) return NextResponse.json({ error: 'Action is required' }, { status: 400 })

    const event = await db.event.findUnique({ where: { id } })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    const allowedFrom = ALLOWED_FROM[action]
    if (allowedFrom && !allowedFrom.includes(event.status)) {
      const label = EVENT_STATUS_LABELS[event.status] ?? event.status
      return NextResponse.json(
        { error: `Cannot ${action} an event that is ${label}` },
        { status: 400 }
      )
    }

    const data: { status?: string; featured?: boolean } = {}
    if (action === 'feature') data.featured = true
    else if (action === 'unfeature') data.featured = false
    else if (ACTION_STATUS[action]) data.status = ACTION_STATUS[action]
    else return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

    const updated = await db.event.update({
      where: { id },
      data,
      include: {
        organizer: { select: { organizationName: true, user: { select: { name: true } } } },
        ticketTypes: true,
      },
    })
    return NextResponse.json(jsonSafe({ event: updated }))
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('PUT /api/admin/events/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 })
  }
}
