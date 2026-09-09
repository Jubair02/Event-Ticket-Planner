import { NextRequest, NextResponse } from 'next/server'
import { AuthError, requireRole } from '@/lib/auth'
import { clientIp } from '@/lib/rate-limit'
import { RefundError } from '@/lib/refunds'
import { actorFromUser, cancelEventAndRefund } from '@/lib/refund-service'

/**
 * POST /api/admin/events/[id]/cancel — cancel an event and refund its buyers.
 *
 * Body: `{ note?: string, limit?: number }`
 *
 * Cancelling used to void tickets and stop there, which left every buyer of a
 * dead event holding a worthless ticket and no refund. This cancels the event,
 * voids its live tickets, and files a full refund (100% including the platform
 * fee — see resolveRefundPolicy) for every order still owed money, grouped
 * under one batch id.
 *
 * The refunds are created APPROVED but not sent to the gateway here: paying
 * out thousands of orders inside one request would time out halfway through.
 * Drain them with POST /api/admin/refunds/process, which reports what is left.
 *
 * Safe to call again. The event is already cancelled on a re-run, and orders
 * whose tickets a refund already claimed are skipped rather than refunded
 * twice — which is also how a batch interrupted by `hasMore` is continued.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRole('SUPER_ADMIN')
    const { id } = await params

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null
    const rawLimit = Number(body?.limit)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : undefined

    const summary = await cancelEventAndRefund({
      eventId: id,
      actor: actorFromUser(admin, clientIp(req)),
      reasonNote: note ?? 'Event cancelled by platform administration.',
      limit,
    })

    return NextResponse.json({ summary })
  } catch (e) {
    if (e instanceof RefundError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/admin/events/[id]/cancel failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to cancel the event' }, { status: 500 })
  }
}
