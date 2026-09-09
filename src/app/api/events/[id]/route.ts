import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonSafe } from '@/lib/serialize'
import { getAuthUser } from '@/lib/auth'

/**
 * GET /api/events/[id]
 * PUBLISHED/ONGOING events are public. Other statuses are only visible to the
 * owning organizer or a SUPER_ADMIN — everyone else gets a 404.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const event = await db.event.findUnique({
      where: { id },
      include: {
        ticketTypes: true,
        organizer: { include: { user: { select: { name: true } } } },
      },
    })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    if (event.status !== 'PUBLISHED' && event.status !== 'ONGOING') {
      const user = await getAuthUser()
      const isOwner = !!user && user.role === 'ORGANIZER' && user.organizer?.id === event.organizerId
      const isAdmin = user?.role === 'SUPER_ADMIN'
      if (!isOwner && !isAdmin) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 })
      }
    }

    return NextResponse.json(jsonSafe({ event }))
  } catch (e) {
    console.error('GET /api/events/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load event' }, { status: 500 })
  }
}
