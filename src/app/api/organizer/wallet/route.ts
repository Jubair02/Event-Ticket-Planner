import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireOrganizer } from '@/lib/auth'
import {
  MIN_PAYOUT_AMOUNT,
  PAYOUT_HOLD_DAYS,
  computeBalances,
  safePayoutMethod,
} from '@/lib/settlement'
import { serialiseLedgerEntry, serialisePayout } from '@/lib/settlement-dto'

/**
 * GET /api/organizer/wallet
 *
 * Everything the wallet screen renders above the fold, in one round trip:
 * balances, payout destinations, payouts in flight and the latest ledger lines.
 */
export async function GET() {
  try {
    const { organizer } = await requireOrganizer()

    const [balances, methods, payouts, recentLedger] = await Promise.all([
      computeBalances(db, organizer.id),
      db.payoutMethod.findMany({
        where: { organizerId: organizer.id, archivedAt: null },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }),
      db.payout.findMany({
        where: { organizerId: organizer.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { method: true },
      }),
      db.ledgerEntry.findMany({
        where: { organizerId: organizer.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ])

    return NextResponse.json({
      balances,
      methods: methods.map(safePayoutMethod),
      payouts: payouts.map(serialisePayout),
      recentLedger: recentLedger.map(serialiseLedgerEntry),
      policy: { holdDays: PAYOUT_HOLD_DAYS, minPayout: MIN_PAYOUT_AMOUNT },
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/organizer/wallet failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load your wallet' }, { status: 500 })
  }
}
