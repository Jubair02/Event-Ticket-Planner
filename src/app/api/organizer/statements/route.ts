import { NextResponse } from 'next/server'
import { AuthError, requireOrganizer } from '@/lib/auth'
import { monthlyStatements } from '@/lib/settlement'

/**
 * GET /api/organizer/statements
 *
 * Month-by-month summaries derived from the ledger. There is no separate
 * statement table on purpose: a statement that can drift from the ledger it
 * describes is worse than no statement, so each period is recomputed from the
 * entries. Drill into a period with `/api/organizer/ledger?period=YYYY-MM`.
 */
export async function GET() {
  try {
    const { organizer } = await requireOrganizer()
    const statements = await monthlyStatements(organizer.id)
    return NextResponse.json({ statements })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/organizer/statements failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load statements' }, { status: 500 })
  }
}
