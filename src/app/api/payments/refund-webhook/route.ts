import { NextRequest, NextResponse } from 'next/server'
import { MINUTE, clientIp, enforceRateLimits } from '@/lib/rate-limit'
import { RefundError } from '@/lib/refunds'
import { parseWebhookPayload, verifyWebhookSignature } from '@/lib/refund-gateway'
import { settleFromWebhook } from '@/lib/refund-service'

/**
 * POST /api/payments/refund-webhook — the gateway telling us a refund settled
 * or failed.
 *
 * This endpoint moves money, and it is the one refund endpoint with no session
 * behind it, so authentication is the signature:
 *
 * - The body is read as raw text and the HMAC is computed over those exact
 *   bytes. Parsing first and re-serialising would change the bytes and break
 *   every signature.
 * - The comparison is timing-safe (see verifyWebhookSignature).
 * - An unsigned or wrongly signed call gets 401 and is never parsed further.
 *   Without this, anyone who guessed a refund reference could mark refunds
 *   settled.
 *
 * Handling is idempotent: gateways retry, and a settlement arriving twice must
 * not move money twice. `settleFromWebhook` applies it with a compare-and-swap
 * and reports `changed: false` for a replay, while still recording the callback
 * in the audit trail so a duplicate is visible rather than invisible.
 *
 * Send `x-refund-signature: <hex>` where the hex is
 * `HMAC-SHA256(REFUND_WEBHOOK_SECRET, rawBody)`. In development, where the
 * secret falls back to a known value, `signWebhookBody` from
 * `@/lib/refund-gateway` produces it.
 */
export async function POST(req: NextRequest) {
  try {
    // The signature is the real gate; this only blunts a flood of forged calls.
    const limited = enforceRateLimits([
      { key: `refund-webhook:${clientIp(req)}`, limit: 300, windowMs: MINUTE },
    ])
    if (limited) return limited

    const rawBody = await req.text()
    const signature = req.headers.get('x-refund-signature')

    if (!verifyWebhookSignature(rawBody, signature)) {
      // Deliberately terse: a forged caller learns nothing about why it failed.
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let parsed: unknown = null
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const payload = parseWebhookPayload(parsed)
    if (!payload) {
      return NextResponse.json(
        { error: 'Body must carry gatewayRefundId and status SETTLED or FAILED' },
        { status: 400 }
      )
    }

    const result = await settleFromWebhook({ payload, ip: clientIp(req) })
    return NextResponse.json({
      refundNumber: result.refundNumber,
      status: result.status,
      // false means this callback was a replay of one already applied.
      changed: result.changed,
    })
  } catch (e) {
    if (e instanceof RefundError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    // A 500 tells a well-behaved gateway to retry, which is what we want.
    console.error('POST /api/payments/refund-webhook failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to process the refund callback' }, { status: 500 })
  }
}
