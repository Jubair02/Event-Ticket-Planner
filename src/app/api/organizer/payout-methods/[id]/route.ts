import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireOrganizer } from '@/lib/auth'
import { OPEN_PAYOUT_STATUSES, safePayoutMethod } from '@/lib/settlement'

/** PATCH /api/organizer/payout-methods/[id] — make this the default destination. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organizer } = await requireOrganizer()
    const { id } = await params

    const body = (await req.json().catch(() => null)) as { makeDefault?: unknown } | null
    if (body?.makeDefault !== true) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const method = await db.payoutMethod.findUnique({ where: { id } })
    if (!method || method.organizerId !== organizer.id || method.archivedAt) {
      return NextResponse.json({ error: 'Payout method not found' }, { status: 404 })
    }

    const updated = await db.$transaction(async (tx) => {
      await tx.payoutMethod.updateMany({
        where: { organizerId: organizer.id, isDefault: true },
        data: { isDefault: false },
      })
      return tx.payoutMethod.update({ where: { id }, data: { isDefault: true } })
    })

    return NextResponse.json({ method: safePayoutMethod(updated) })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('PATCH /api/organizer/payout-methods/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to update payout method' }, { status: 500 })
  }
}

/**
 * DELETE /api/organizer/payout-methods/[id] — archive a destination.
 *
 * Archived rather than deleted: historical payouts reference the method they
 * were sent to, and a settlement record that cannot name its destination is
 * useless in a dispute. Blocked while a payout to it is still in flight.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organizer } = await requireOrganizer()
    const { id } = await params

    const method = await db.payoutMethod.findUnique({ where: { id } })
    if (!method || method.organizerId !== organizer.id || method.archivedAt) {
      return NextResponse.json({ error: 'Payout method not found' }, { status: 404 })
    }

    const inFlight = await db.payout.count({
      where: { payoutMethodId: id, status: { in: OPEN_PAYOUT_STATUSES } },
    })
    if (inFlight > 0) {
      return NextResponse.json(
        { error: 'A payout to this account is still being processed. Wait for it to finish.' },
        { status: 400 },
      )
    }

    await db.$transaction(async (tx) => {
      await tx.payoutMethod.update({
        where: { id },
        data: { archivedAt: new Date(), isDefault: false },
      })
      // Promote another method so the organizer is never left without a default.
      if (method.isDefault) {
        const next = await tx.payoutMethod.findFirst({
          where: { organizerId: organizer.id, archivedAt: null },
          orderBy: { createdAt: 'desc' },
        })
        if (next) await tx.payoutMethod.update({ where: { id: next.id }, data: { isDefault: true } })
      }
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('DELETE /api/organizer/payout-methods/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to remove payout method' }, { status: 500 })
  }
}
