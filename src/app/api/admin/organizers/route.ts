import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/** GET /api/admin/organizers?status= — organizer directory with event counts. */
export async function GET(req: NextRequest) {
  try {
    await requireRole('SUPER_ADMIN')

    const status = (req.nextUrl.searchParams.get('status') || '').trim()
    const where: Record<string, unknown> = {}
    if (status) where.status = status

    const rows = await db.organizer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, status: true } },
        _count: { select: { events: true } },
      },
    })

    const organizers = rows.map(({ _count, ...org }) => ({ ...org, eventCount: _count.events }))
    return NextResponse.json({ organizers })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/admin/organizers failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load organizers' }, { status: 500 })
  }
}
