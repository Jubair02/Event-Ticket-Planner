import { NextRequest, NextResponse } from 'next/server'

/**
 * Minimal in-process fixed-window rate limiter for the auth endpoints.
 *
 * LIMITATION — read before relying on this: the counters live in the memory of
 * a single server process. On a long-running server (the standalone build) that
 * is effective. On serverless/multi-instance hosting (Vercel) each instance has
 * its own counters and a cold start resets them, so a determined attacker
 * spreading requests across instances gets more attempts than the numbers
 * below suggest. It raises the cost of brute force substantially but is not a
 * hard guarantee; for that, back it with a shared store (Vercel KV / Upstash
 * Redis) and keep the same call sites.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
const MAX_TRACKED_KEYS = 10_000

/** Drops expired buckets so the map cannot grow without bound. */
function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number }

/**
 * Counts one hit against `key`. Returns ok:false once `limit` hits occur inside
 * `windowMs`, with the seconds remaining until the window resets.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  if (buckets.size > MAX_TRACKED_KEYS) sweep(now)

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) }
  }

  bucket.count += 1
  return { ok: true }
}

/**
 * Best-effort client identifier. Next removed `request.ip`, so this reads the
 * proxy headers Vercel sets. Spoofable in principle, which is another reason
 * the per-account limits below matter as much as the per-IP ones.
 */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim() || 'unknown'
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** 429 with a Retry-After header and a message safe to show to the user. */
export function tooManyRequests(retryAfterSeconds: number): NextResponse {
  const minutes = Math.ceil(retryAfterSeconds / 60)
  const wait = retryAfterSeconds < 60 ? `${retryAfterSeconds} seconds` : `${minutes} minute${minutes === 1 ? '' : 's'}`
  return NextResponse.json(
    { error: `Too many attempts. Please try again in ${wait}.` },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  )
}

/**
 * Applies several limits at once and returns a 429 for the first one exceeded.
 * Pass the tightest/most specific limit last so it is not shadowed.
 */
export function enforceRateLimits(
  limits: Array<{ key: string; limit: number; windowMs: number }>
): NextResponse | null {
  for (const { key, limit, windowMs } of limits) {
    const result = rateLimit(key, limit, windowMs)
    if (!result.ok) return tooManyRequests(result.retryAfterSeconds)
  }
  return null
}

export const MINUTE = 60_000
