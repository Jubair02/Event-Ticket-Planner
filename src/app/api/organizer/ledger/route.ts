import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireOrganizer } from '@/lib/auth'
import { LEDGER_TYPES, type LedgerType } from '@/lib/settlement'
import { serialiseLedgerEntry } from '@/lib/settlement-dto'

const PAGE_SIZE = 50

/**
 * GET /api/organizer/ledger?type=&period=YYYY-MM&cursor=
 *
 * The organizer's own entries, newest first. Cursor-paginated rather than
 * offset-paginated: a ledger grows at the head, so `skip` would re-shuffle
 * pages as new sales land mid-scroll.
 */
export async function GET(req: NextRequest) {
  try {
    const { organizer } = await requireOrganizer()

    const sp = req.nextUrl.searchParams
    const type = (sp.get('type') || '').trim()
    const period = (sp.get('period') || '').trim()
    const cursor = (sp.get('cursor') || '').trim()

    const where: {
      organizerId: string
      type?: LedgerType
      createdAt?: { gte: Date; lt: Date }
    } = { organizerId: organizer.id }

    if (type && (LEDGER_TYPES as readonly string[]).includes(type)) {
      where.type = type as LedgerType
    }

    // `YYYY-MM` -> that calendar month, resolved in server time to match the
    // grouping used by the statement summaries.
    if (/^\d{4}-\d{2}$/.test(period)) {
      const [y, m] = period.split('-').map(Number)
      where.createdAt = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) }
    }

    const rows = await db.ledgerEntry.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = rows.length > PAGE_SIZE
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows

    return NextResponse.json({
      entries: page.map(serialiseLedgerEntry),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/organizer/ledger failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load your ledger' }, { status: 500 })
  }
}
