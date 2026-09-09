import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import { fromDbMinor } from '@/lib/money'

const MAX_ROWS = 60

// Not exported: Next validates the export surface of a route module, so the
// shared type lives with the component that renders it.
type AuditSource = 'REFUND' | 'LEDGER' | 'PAYOUT'

/** One row of the trail, whichever table it came from. */
type AuditEntry = {
  id: string
  source: AuditSource
  at: string
  action: string
  subject: string
  detail: string
  actor: string
  amountMinor: number | null
  href: string | null
}

/**
 * GET /api/admin/audit?source=
 *
 * A merged, newest-first trail of the things that move money: refund
 * transitions, ledger postings and payout decisions.
 *
 * The three tables are read separately and merged in memory rather than joined
 * in SQL, because they share no key — they are different kinds of event that
 * only happen to belong on one timeline. Each is capped before merging, so the
 * cost stays bounded no matter how lopsided the activity is.
 *
 * Read-only by definition: an audit trail that can be edited is not one.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole('SUPER_ADMIN')

    const source = req.nextUrl.searchParams.get('source')?.trim()
    const want = (s: AuditSource) => !source || source === 'ALL' || source === s

    const [refundLogs, ledgerRows, payouts] = await Promise.all([
      want('REFUND')
        ? db.refundAuditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: MAX_ROWS,
            select: {
              id: true,
              action: true,
              fromStatus: true,
              toStatus: true,
              actorRole: true,
              actorName: true,
              amountMinor: true,
              note: true,
              createdAt: true,
              refund: {
                select: { id: true, refundNumber: true, order: { select: { orderNumber: true } } },
              },
            },
          })
        : [],
      want('LEDGER')
        ? db.ledgerEntry.findMany({
            orderBy: { occurredAt: 'desc' },
            take: MAX_ROWS,
            select: {
              id: true,
              kind: true,
              account: true,
              direction: true,
              amountMinor: true,
              description: true,
              orderId: true,
              occurredAt: true,
            },
          })
        : [],
      want('PAYOUT')
        ? db.payout.findMany({
            where: { reviewedAt: { not: null } },
            orderBy: { reviewedAt: 'desc' },
            take: MAX_ROWS,
            select: {
              id: true,
              payoutNumber: true,
              status: true,
              amountMinor: true,
              reviewNote: true,
              reviewedAt: true,
              reviewedBy: { select: { name: true } },
              organizer: { select: { organizationName: true } },
            },
          })
        : [],
    ])

    const entries: AuditEntry[] = [
      ...refundLogs.map((r) => ({
        id: `refund:${r.id}`,
        source: 'REFUND' as const,
        at: r.createdAt.toISOString(),
        action: r.action,
        subject: r.refund.refundNumber,
        detail:
          r.note ??
          (r.fromStatus && r.toStatus ? `${r.fromStatus} to ${r.toStatus}` : `Order ${r.refund.order.orderNumber}`),
        // A null actor with role SYSTEM is the engine acting on its own.
        actor: r.actorName ?? (r.actorRole === 'SYSTEM' ? 'System' : r.actorRole),
        amountMinor: r.amountMinor === null ? null : fromDbMinor(r.amountMinor),
        href: null,
      })),
      ...ledgerRows.map((l) => ({
        id: `ledger:${l.id}`,
        source: 'LEDGER' as const,
        at: l.occurredAt.toISOString(),
        action: l.kind,
        subject: `${l.direction === 'DEBIT' ? 'Dr' : 'Cr'} ${l.account}`,
        detail: l.description ?? '',
        actor: 'System',
        amountMinor: fromDbMinor(l.amountMinor),
        href: null,
      })),
      ...payouts.map((p) => ({
        id: `payout:${p.id}`,
        source: 'PAYOUT' as const,
        // Only reviewed payouts are selected, so this is never null.
        at: (p.reviewedAt as Date).toISOString(),
        action: `PAYOUT_${p.status}`,
        subject: p.payoutNumber,
        detail: p.reviewNote ?? p.organizer.organizationName,
        actor: p.reviewedBy?.name ?? 'System',
        amountMinor: fromDbMinor(p.amountMinor),
        href: null,
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX_ROWS)

    return NextResponse.json({ entries })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/admin/audit failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load the audit trail' }, { status: 500 })
  }
}
