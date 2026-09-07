import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/events?search=&category=&city=&sort=upcoming|popular&featured=true
 *
 * Public listing. Shows PUBLISHED *and* ONGOING events — an event that is
 * happening right now is still on sale (the detail route and order creation
 * both accept ONGOING), so hiding it would make it vanish mid-event.
 * Events whose endDate has passed are excluded so they stop being listed as
 * upcoming; organizers do not have to mark them COMPLETED for that to happen.
 *
 * Note: Postgres `contains` is case-sensitive, so `mode: 'insensitive'` is required.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const search = (sp.get('search') || '').trim()
    const category = (sp.get('category') || '').trim()
    const city = (sp.get('city') || '').trim()
    const sort = sp.get('sort') === 'popular' ? 'popular' : 'upcoming'
    const featured = sp.get('featured') === 'true'

    const where: Record<string, unknown> = {
      status: { in: ['PUBLISHED', 'ONGOING'] },
      endDate: { gte: new Date() },
    }
    if (category) where.category = category
    if (city) where.city = city
    if (featured) where.featured = true
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    const events = await db.event.findMany({
      where,
      orderBy: { startDate: 'asc' },
      include: {
        ticketTypes: true,
        organizer: { include: { user: { select: { name: true } } } },
      },
    })

    if (sort === 'popular') {
      const sold = (e: (typeof events)[number]) =>
        e.ticketTypes.reduce((sum, tt) => sum + tt.soldQuantity, 0)
      events.sort((a, b) => sold(b) - sold(a) || a.startDate.getTime() - b.startDate.getTime())
    }

    return NextResponse.json({ events })
  } catch (e) {
    console.error('GET /api/events failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }
}
