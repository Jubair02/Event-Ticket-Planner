import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import { PAYOUT_STATUSES } from '@/lib/settlement'
import { serialisePayout } from '@/lib/settlement-dto'
import { fromDbMinor } from '@/lib/money'

const MAX_ROWS = 200

/**
 * GET /api/admin/payouts?status=&q=
 *
 * The payout queue. Decisions are made through `PUT /api/admin/payouts/[id]`.
 *
 * `counts` and `totals` are computed over every payout rather than the filtered
 * page, so REQUESTED work stays visible while the operator is looking at
 * something else.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole('SUPER_ADMIN')

    const sp = req.nextUrl.searchParams
    const status = sp.get('status')?.trim()
    const q = sp.get('q')?.trim()

    if (status && status !== 'ALL' && !(PAYOUT_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Unknown payout status filter' }, { status: 400 })
    }

    const where: Prisma.PayoutWhereInput = {
      ...(status && status !== 'ALL' ? { status } : {}),
      ...(q
        ? {
            OR: [
              { payoutNumber: { contains: q, mode: 'insensitive' } },
              { reference: { contains: q, mode: 'insensitive' } },
              { organizer: { organizationName: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }

    const [rows, grouped] = await Promise.all([
      db.payout.findMany({
        where,
        // Oldest request first within the queue view: a payout waiting longest
        // should be the one an operator sees first.
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: MAX_ROWS,
        include: {
          payoutMethod: true,
          reviewedBy: { select: { name: true } },
          organizer: {
            select: { id: true, organizationName: true, user: { select: { email: true } } },
          },
        },
      }),
      db.payout.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
    ])

    return NextResponse.json({
      payouts: rows.map(serialisePayout),
      counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      totalsMinor: Object.fromEntries(
        grouped.map((g) => [g.status, fromDbMinor(g._sum.amountMinor)])
      ),
      /** What is committed but not yet transferred — the cash an operator owes. */
      outstandingMinor: grouped
        .filter((g) => (['REQUESTED', 'APPROVED'] as string[]).includes(g.status))
        .reduce((sum, g) => sum + fromDbMinor(g._sum.amountMinor), 0),
      truncated: rows.length === MAX_ROWS,
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/admin/payouts failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load payouts' }, { status: 500 })
  }
}
