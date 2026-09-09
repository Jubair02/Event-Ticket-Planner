import { NextRequest, NextResponse } from 'next/server'
import { AuthError, requireRole } from '@/lib/auth'
import { clientIp } from '@/lib/rate-limit'
import { RefundError } from '@/lib/refunds'
import { actorFromUser, processRefundQueue } from '@/lib/refund-service'

/**
 * POST /api/admin/refunds/process — drain approved refunds to the gateway.
 *
 * Body: `{ limit?: number, batchId?: string }`
 *
 * Bounded on purpose. An event cancellation can approve thousands of refunds
 * at once, and paying them all inside one HTTP request would time out partway
 * through with no record of where it stopped. This processes up to `limit`
 * (default 25, max 100) oldest-first and reports `remaining`, so a caller — an
 * operator clicking again, or a cron — keeps going until it reaches zero.
 *
 * One refund failing does not abort the run: a single stuck refund would
 * otherwise block every refund queued behind it.
 */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole('SUPER_ADMIN')

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const rawLimit = Number(body?.limit)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : undefined
    const batchId = typeof body?.batchId === 'string' ? body.batchId.trim() || null : null

    const summary = await processRefundQueue({
      actor: actorFromUser(admin, clientIp(req)),
      limit,
      batchId,
    })

    return NextResponse.json({ summary })
  } catch (e) {
    if (e instanceof RefundError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/admin/refunds/process failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to process the refund queue' }, { status: 500 })
  }
}
