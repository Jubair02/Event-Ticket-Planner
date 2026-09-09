import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import {
  LEDGER_TYPES,
  SettlementError,
  computeBalances,
  recordAdjustment,
  type LedgerType,
} from '@/lib/settlement'
import { serialiseLedgerEntry } from '@/lib/settlement-dto'

const PAGE_SIZE = 100

/**
 * GET /api/admin/organizers/[id]/ledger?type=&cursor=
 *
 * Read-only inspection of any organizer's ledger, so a payout decision or a
 * balance dispute can be settled against the entries themselves.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('SUPER_ADMIN')
    const { id } = await params

    const organizer = await db.organizer.findUnique({
      where: { id },
      select: {
        id: true,
        organizationName: true,
        status: true,
        user: { select: { name: true, email: true } },
      },
    })
    if (!organizer) return NextResponse.json({ error: 'Organizer not found' }, { status: 404 })

    const sp = req.nextUrl.searchParams
    const type = (sp.get('type') || '').trim()
    const cursor = (sp.get('cursor') || '').trim()

    const [balances, rows] = await Promise.all([
      computeBalances(db, id),
      db.ledgerEntry.findMany({
        where: {
          organizerId: id,
          ...((LEDGER_TYPES as readonly string[]).includes(type)
            ? { type: type as LedgerType }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE_SIZE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    ])

    const hasMore = rows.length > PAGE_SIZE
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows

    return NextResponse.json({
      organizer,
      balances,
      entries: page.map(serialiseLedgerEntry),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/admin/organizers/[id]/ledger failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load ledger' }, { status: 500 })
  }
}

/**
 * POST /api/admin/organizers/[id]/ledger — post a manual ADJUSTMENT.
 *
 * The only way to write an arbitrary entry, and the escape hatch for the cases
 * the automated paths cannot express: waiving a fee, correcting a bad payout,
 * or recovering a negative balance left by a late refund. Always attributed to
 * the admin who posted it and always requires a reason.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRole('SUPER_ADMIN')
    const { id } = await params

    const body = (await req.json().catch(() => null)) as {
      amount?: unknown
      description?: unknown
    } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const organizer = await db.organizer.findUnique({ where: { id }, select: { id: true } })
    if (!organizer) return NextResponse.json({ error: 'Organizer not found' }, { status: 404 })

    const amount = Number(body.amount)
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ error: 'Enter an adjustment amount' }, { status: 400 })
    }

    const entry = await recordAdjustment({
      organizerId: id,
      amount,
      description: String(body.description ?? ''),
      adminId: admin.id,
    })

    const balances = await computeBalances(db, id)
    return NextResponse.json({ entry: serialiseLedgerEntry(entry), balances }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof SettlementError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('POST /api/admin/organizers/[id]/ledger failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to post adjustment' }, { status: 500 })
  }
}
