import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'
import { jsonSafe } from '@/lib/serialize'
import { clientIp } from '@/lib/rate-limit'
import { RefundError } from '@/lib/refunds'
import { actorFromUser, cancelEventAndRefund } from '@/lib/refund-service'

/**
 * POST /api/organizer/events/[id]/cancel
 *
 * Cancels the organizer's own event, voids its live tickets and files a full
 * refund for every order still owed money.
 *
 * Cancelling used to void tickets while leaving the money alone, which let an
 * organizer cancel an event and still draw a payout for tickets nobody could
 * use. The refund engine now handles both sides in one place: the customer's
 * refund and the matching ledger reversal of the organizer's share are created
 * together, so the two can never disagree.
 *
 * Refunds land APPROVED and are paid out by POST /api/admin/refunds/process.
 * The organizer cannot move money themselves; they can only cause the refunds
 * to be owed.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('ORGANIZER')
    const organizer = await db.organizer.findUnique({ where: { userId: user.id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer profile not found' }, { status: 404 })

    const { id } = await params
    const event = await db.event.findUnique({ where: { id }, select: { id: true, organizerId: true, status: true } })
    if (!event || event.organizerId !== organizer.id) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    if (event.status === 'CANCELLED') {
      return NextResponse.json({ error: 'This event is already cancelled' }, { status: 400 })
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null

    const summary = await cancelEventAndRefund({
      eventId: event.id,
      // Recorded as ADMIN-tier authority because the refunds are issued by the
      // platform on the organizer's instruction; the audit trail names the
      // organizer who triggered it.
      actor: actorFromUser(user, clientIp(req)),
      reasonNote: note ?? 'Event cancelled by the organizer.',
    })

    const updated = await db.event.findUnique({
      where: { id: event.id },
      include: { ticketTypes: true },
    })

    return NextResponse.json(jsonSafe({ event: updated, summary }))
  } catch (e) {
    if (e instanceof RefundError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/organizer/events/[id]/cancel failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to cancel event' }, { status: 500 })
  }
}
