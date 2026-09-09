import { NextRequest, NextResponse } from 'next/server'
import { AuthError, requireRole } from '@/lib/auth'
import { clientIp } from '@/lib/rate-limit'
import { RefundError } from '@/lib/refunds'
import {
  actorFromUser,
  decideRefund,
  processRefund,
  serializeRefundForAdmin,
} from '@/lib/refund-service'

const ACTIONS = ['approve', 'reject', 'process', 'retry'] as const
type Action = (typeof ACTIONS)[number]

function isAction(v: unknown): v is Action {
  return typeof v === 'string' && (ACTIONS as readonly string[]).includes(v)
}

/**
 * PATCH /api/admin/refunds/[id] — move one refund through the state machine.
 *
 * Body: `{ action: 'approve' | 'reject' | 'process' | 'retry', note?, rejectionReason? }`
 *
 * - `approve` — REQUESTED to APPROVED.
 * - `reject`  — REQUESTED, APPROVED or FAILED to REJECTED. Requires a reason,
 *               and releases the refund's tickets so a corrected refund can be
 *               filed. This is also how a permanently failed refund is
 *               abandoned.
 * - `process` — APPROVED to PROCESSING, then to the gateway.
 * - `retry`   — the same thing for a FAILED refund. It reuses the original
 *               idempotency key, so a refund the gateway actually completed
 *               before timing out cannot be paid a second time.
 *
 * The amount is never part of this request. It was fixed when the refund was
 * created and priced, and an approval cannot silently change it.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRole('SUPER_ADMIN')
    const { id } = await params

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const action = body?.action
    if (!isAction(action)) {
      return NextResponse.json(
        { error: `Action must be one of: ${ACTIONS.join(', ')}` },
        { status: 400 }
      )
    }

    const actor = actorFromUser(admin, clientIp(req))
    const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null

    if (action === 'approve' || action === 'reject') {
      const refund = await decideRefund({
        refundId: id,
        action,
        actor,
        note,
        rejectionReason:
          typeof body?.rejectionReason === 'string' ? body.rejectionReason.slice(0, 500) : null,
      })
      return NextResponse.json({ refund: serializeRefundForAdmin(refund) })
    }

    const result = await processRefund({ refundId: id, actor })
    return NextResponse.json({
      refund: serializeRefundForAdmin(result.refund),
      outcome: result.outcome,
      message: result.message,
    })
  } catch (e) {
    if (e instanceof RefundError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('PATCH /api/admin/refunds/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to update refund' }, { status: 500 })
  }
}
