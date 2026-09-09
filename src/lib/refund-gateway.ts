/**
 * Gateway adapter for refunds.
 *
 * The rest of the platform mocks SSLCOMMERZ (see /api/payments/execute), so
 * this mocks its refund API to match. It is written as a real adapter rather
 * than an inline stub for two reasons: the state machine that calls it must be
 * exercised against realistic outcomes (accepted-then-settled-later, retryable
 * failure, permanent failure), and swapping in the live HTTP client should mean
 * replacing the body of one function, not rewriting the engine.
 *
 * Two properties matter more than the simulation itself:
 *
 * 1. **Idempotency.** Every submission carries the refund's `idempotencyKey`,
 *    and the synthetic gateway id is derived from that key, so re-submitting
 *    after a timeout returns the same reference instead of paying twice. A live
 *    gateway is asked to honour the key the same way.
 * 2. **Authenticated callbacks.** An unauthenticated refund webhook would let
 *    anyone mark refunds settled. Callbacks are HMAC-signed.
 */

import crypto from 'crypto'

import { formatMinor, type Minor } from '@/lib/money'

/**
 * How the simulated gateway behaves. Set REFUND_GATEWAY_MODE to:
 *
 * - `settle` (default) - accepts and settles immediately, so a refund reaches
 *   COMPLETED within the request that processed it.
 * - `async` - accepts and leaves the refund PROCESSING until a signed webhook
 *   arrives. This is how most real gateways behave; use it to exercise the
 *   webhook path.
 * - `fail` - retryable failure (timeout / temporarily unavailable).
 * - `decline` - permanent failure (the capture cannot be reversed).
 */
export type RefundGatewayMode = 'settle' | 'async' | 'fail' | 'decline'

const DEFAULT_MODE: RefundGatewayMode = 'settle'

function gatewayMode(): RefundGatewayMode {
  const raw = process.env.REFUND_GATEWAY_MODE?.trim().toLowerCase()
  if (raw === 'settle' || raw === 'async' || raw === 'fail' || raw === 'decline') return raw
  return DEFAULT_MODE
}

const DEV_FALLBACK_WEBHOOK_SECRET = 'ticketbd-dev-refund-webhook-secret'
const MIN_SECRET_LENGTH = 32

/**
 * Shared secret for refund callbacks. Required in production for the same
 * reason AUTH_SECRET is: without it, a POST from anywhere on the internet could
 * mark refunds settled or failed.
 */
function webhookSecret(): string {
  const configured = process.env.REFUND_WEBHOOK_SECRET?.trim()
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      configured
        ? `REFUND_WEBHOOK_SECRET is too short (${configured.length} chars) - use at least ${MIN_SECRET_LENGTH}.`
        : 'REFUND_WEBHOOK_SECRET is not set. Refusing to accept refund callbacks signed with the development fallback secret in production.'
    )
  }
  return DEV_FALLBACK_WEBHOOK_SECRET
}

// ---------------------------------------------------------------- submission

export type GatewayRefundRequest = {
  /** The refund's stable idempotency key. Replays must not pay twice. */
  idempotencyKey: string
  provider: string
  /** Gateway reference of the capture being reversed. */
  originalTransactionId: string | null
  /** Amount to reverse, in paisa. Computed by the engine, never by a client. */
  amountMinor: Minor
  currency: string
  reason: string
}

export type GatewayRefundOutcome =
  | {
      ok: true
      /**
       * true  - money is gone, move the refund to COMPLETED now.
       * false - the gateway accepted it and will call back; stay PROCESSING.
       */
      settled: boolean
      gatewayRefundId: string
      gatewayStatus: string
      message: string
    }
  | {
      ok: false
      /** Whether a later retry could plausibly succeed. */
      retryable: boolean
      gatewayStatus: string
      message: string
    }

/**
 * Derives the gateway's refund reference from the idempotency key, which makes
 * the simulation idempotent in the way that actually matters: the same key
 * always yields the same reference, so a retry after a network timeout is
 * recognisable as the same refund rather than a second one.
 */
export function derivedGatewayRefundId(idempotencyKey: string): string {
  const digest = crypto.createHmac('sha256', webhookSecret()).update(idempotencyKey).digest('hex')
  return `SSLRFD${digest.slice(0, 20).toUpperCase()}`
}

/** Builds the per-refund idempotency key stored on the row. */
export function buildIdempotencyKey(refundNumber: string): string {
  return `rfd_${refundNumber}_${crypto.randomBytes(8).toString('hex')}`
}

/**
 * Submits a refund to the gateway.
 *
 * Replace the body with the live HTTP call; the contract to keep is that a
 * timeout or an unclear response must surface as `retryable: true` and must NOT
 * be treated as a failure that releases the tickets, because the money may
 * still be on its way.
 */
export async function submitGatewayRefund(req: GatewayRefundRequest): Promise<GatewayRefundOutcome> {
  if (req.amountMinor <= 0) {
    return {
      ok: false,
      retryable: false,
      gatewayStatus: 'INVALID_AMOUNT',
      message: 'The gateway rejected a refund of zero or less.',
    }
  }

  const gatewayRefundId = derivedGatewayRefundId(req.idempotencyKey)

  switch (gatewayMode()) {
    case 'async':
      return {
        ok: true,
        settled: false,
        gatewayRefundId,
        gatewayStatus: 'ACCEPTED',
        message: 'Refund accepted by the gateway; awaiting settlement callback.',
      }
    case 'fail':
      return {
        ok: false,
        retryable: true,
        gatewayStatus: 'TIMEOUT',
        message: 'The gateway did not respond in time. The refund can be retried.',
      }
    case 'decline':
      return {
        ok: false,
        retryable: false,
        gatewayStatus: 'DECLINED',
        message: 'The gateway declined to reverse this capture.',
      }
    case 'settle':
    default:
      return {
        ok: true,
        settled: true,
        gatewayRefundId,
        gatewayStatus: 'SETTLED',
        message: `Refund of ${formatMinor(req.amountMinor)} settled by ${req.provider}.`,
      }
  }
}

// ---------------------------------------------------------------- callbacks

export type RefundWebhookPayload = {
  gatewayRefundId: string
  /** SETTLED | FAILED - anything else is rejected as unrecognised. */
  status: 'SETTLED' | 'FAILED'
  message?: string
}

/** HMAC-SHA256 of the exact raw body, hex encoded. */
export function signWebhookBody(rawBody: string): string {
  return crypto.createHmac('sha256', webhookSecret()).update(rawBody).digest('hex')
}

/**
 * Timing-safe signature check over the raw request body. The body must be the
 * bytes as received - re-serialising parsed JSON would change the signature.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false
  const expected = signWebhookBody(rawBody)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature.trim().toLowerCase(), 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** Validates a callback body without trusting any of its fields. */
export function parseWebhookPayload(raw: unknown): RefundWebhookPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as Record<string, unknown>
  const gatewayRefundId = typeof body.gatewayRefundId === 'string' ? body.gatewayRefundId.trim() : ''
  const status = body.status
  if (!gatewayRefundId) return null
  if (status !== 'SETTLED' && status !== 'FAILED') return null
  const message = typeof body.message === 'string' ? body.message.slice(0, 500) : undefined
  return { gatewayRefundId, status, message }
}
