import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/** GET /api/admin/events?status=&q= — moderation list of all events. */
export async function GET(req: NextRequest) {
  try {
    await requireRole('SUPER_ADMIN')

    const sp = req.nextUrl.searchParams
    const status = (sp.get('status') || '').trim()
    const q = (sp.get('q') || '').trim()

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (q) where.title = { contains: q, mode: 'insensitive' }

    const events = await db.event.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        organizer: { select: { organizationName: true, user: { select: { name: true } } } },
        ticketTypes: true,
      },
    })
    return NextResponse.json({ events })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/admin/events failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }
}
