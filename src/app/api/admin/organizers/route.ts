import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

const MAX_ROWS = 200

/**
 * GET /api/admin/organizers?status=&q= — organizer directory with event counts.
 *
 * `counts` is computed over every organizer, not the filtered page, so the
 * review backlog stays visible while the operator is looking at another status.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole('SUPER_ADMIN')

    const sp = req.nextUrl.searchParams
    const status = (sp.get('status') || '').trim()
    const q = (sp.get('q') || '').trim()

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (q) {
      where.OR = [
        { organizationName: { contains: q, mode: 'insensitive' } },
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ]
    }

    const [rows, grouped] = await Promise.all([
      db.organizer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true, status: true } },
          _count: { select: { events: true } },
        },
      }),
      db.organizer.groupBy({ by: ['status'], _count: { _all: true } }),
    ])

    const organizers = rows.map(({ _count, ...org }) => ({ ...org, eventCount: _count.events }))
    return NextResponse.json({
      organizers,
      counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      truncated: rows.length === MAX_ROWS,
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/admin/organizers failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load organizers' }, { status: 500 })
  }
}
