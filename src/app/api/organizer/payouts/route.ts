import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireOrganizer } from '@/lib/auth'
import { SettlementError, createPayoutRequest } from '@/lib/settlement'
import { serialisePayout } from '@/lib/settlement-dto'
import { isMinor } from '@/lib/money'

const MAX_ROWS = 100

/** GET /api/organizer/payouts — the organizer's own payout history, newest first. */
export async function GET() {
  try {
    const { organizer } = await requireOrganizer()
    const payouts = await db.payout.findMany({
      where: { organizerId: organizer.id },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      include: { payoutMethod: true, reviewedBy: { select: { name: true } } },
    })
    return NextResponse.json({ payouts: payouts.map(serialisePayout) })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/organizer/payouts failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load payouts' }, { status: 500 })
  }
}

/**
 * POST /api/organizer/payouts — request a payout.
 *
 * Body: `{ methodId, amountMinor, note? }`
 *
 * The amount is paisa, and the balance is re-checked inside the transaction
 * that writes the row, so two requests sent at once cannot both pass and
 * overdraw. All of that lives in `createPayoutRequest`; this handler only
 * validates the shape of the request and maps rule violations to statuses.
 */
export async function POST(req: NextRequest) {
  try {
    const { organizer } = await requireOrganizer()

    const body = (await req.json().catch(() => null)) as {
      methodId?: unknown
      amountMinor?: unknown
      note?: unknown
    } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const methodId = typeof body.methodId === 'string' ? body.methodId.trim() : ''
    if (!methodId) {
      return NextResponse.json({ error: 'Choose where to send the money' }, { status: 400 })
    }

    const amountMinor = Number(body.amountMinor)
    if (!isMinor(amountMinor) || amountMinor <= 0) {
      return NextResponse.json({ error: 'Enter a payout amount greater than zero' }, { status: 400 })
    }

    const payout = await createPayoutRequest({
      organizerId: organizer.id,
      methodId,
      amountMinor,
      note: typeof body.note === 'string' ? body.note : null,
    })

    return NextResponse.json({ payout: serialisePayout(payout) }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof SettlementError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('POST /api/organizer/payouts failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to request a payout' }, { status: 500 })
  }
}
