import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import { jsonSafe } from '@/lib/serialize'

const MAX_ROWS = 200

/**
 * GET /api/admin/events?status=&q= — moderation list of all events.
 *
 * `counts` spans every event, so the pending-approval backlog is visible from
 * any filter rather than only from the one that shows it.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole('SUPER_ADMIN')

    const sp = req.nextUrl.searchParams
    const status = (sp.get('status') || '').trim()
    const q = (sp.get('q') || '').trim()

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (q) where.title = { contains: q, mode: 'insensitive' }

    const [events, grouped] = await Promise.all([
      db.event.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        include: {
          organizer: { select: { organizationName: true, user: { select: { name: true } } } },
          ticketTypes: true,
        },
      }),
      db.event.groupBy({ by: ['status'], _count: { _all: true } }),
    ])
    // ticketTypes carry bigint money columns, which NextResponse cannot
    // serialise on its own.
    return NextResponse.json(
      jsonSafe({
        events,
        counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
        truncated: events.length === MAX_ROWS,
      }),
    )
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/admin/events failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }
}
