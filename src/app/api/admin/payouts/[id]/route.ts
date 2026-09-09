import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import { SettlementError, decidePayout } from '@/lib/settlement'
import { serialisePayout } from '@/lib/settlement-dto'

const ACTIONS = ['approve', 'reject', 'mark_paid'] as const
type Action = (typeof ACTIONS)[number]

/**
 * PUT /api/admin/payouts/[id]
 * Body: `{ action: 'approve' | 'reject' | 'mark_paid', note?, transferRef? }`
 *
 * `mark_paid` requires `transferRef` and is the only action that moves money:
 * it appends the PAYOUT ledger entry in the same transaction as the status
 * change. All state-machine and balance checks live in `decidePayout`.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRole('SUPER_ADMIN')
    const { id } = await params

    const body = (await req.json().catch(() => null)) as {
      action?: unknown
      note?: unknown
      transferRef?: unknown
    } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const action = String(body.action ?? '')
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return NextResponse.json(
        { error: 'Action must be approve, reject or mark_paid' },
        { status: 400 },
      )
    }

    await decidePayout({
      payoutId: id,
      action: action as Action,
      adminId: admin.id,
      note: typeof body.note === 'string' ? body.note : null,
      transferRef: typeof body.transferRef === 'string' ? body.transferRef : null,
    })

    // Re-read with relations so the client can patch its row without refetching.
    const fresh = await db.payout.findUnique({
      where: { id },
      include: {
        payoutMethod: true,
        reviewedBy: { select: { name: true } },
        organizer: {
          select: { id: true, organizationName: true, user: { select: { email: true } } },
        },
      },
    })
    if (!fresh) return NextResponse.json({ error: 'Payout not found' }, { status: 404 })

    return NextResponse.json({ payout: serialisePayout(fresh) })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof SettlementError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('PUT /api/admin/payouts/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to update payout' }, { status: 500 })
  }
}
