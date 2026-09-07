import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { MINUTE, clientIp, enforceRateLimits } from '@/lib/rate-limit'

/**
 * Returns true when the generated reset code may be handed back to the caller.
 *
 * Demo mode is ON outside production (so the flow is usable locally without an
 * email provider) and OFF in production unless DEMO_PASSWORD_RESET=true is set
 * explicitly. Returning the code in production would let anyone reset any
 * account's password just by knowing the email address.
 * DEMO_PASSWORD_RESET=false forces it off anywhere.
 */
function demoResetEnabled(): boolean {
  const flag = process.env.DEMO_PASSWORD_RESET
  if (flag === 'true') return true
  if (flag === 'false') return false
  return process.env.NODE_ENV !== 'production'
}

/**
 * POST /api/auth/forgot — request a password reset code.
 *
 * Always responds 200 so the response cannot be used to enumerate which email
 * addresses have accounts. The code itself is only echoed back in demo mode
 * (see above); in production it needs a real delivery channel (email/SMS),
 * which is not wired up yet.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { email?: string } | null
    const email = (body?.email || '').trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

    const limited = enforceRateLimits([
      { key: `forgot:ip:${clientIp(req)}`, limit: 5, windowMs: 15 * MINUTE },
      { key: `forgot:email:${email}`, limit: 3, windowMs: 15 * MINUTE },
    ])
    if (limited) return limited

    const demo = demoResetEnabled()
    const user = await db.user.findUnique({ where: { email } })

    let resetCode: string | null = null
    if (user) {
      resetCode = String(crypto.randomInt(100000, 1000000))
      await db.user.update({
        where: { id: user.id },
        data: {
          resetCode,
          resetCodeExpiry: new Date(Date.now() + 10 * 60 * 1000),
        },
      })

      if (!demo) {
        // Deliberately does not log the code itself — logs are not a delivery
        // channel. Wire up an email provider to complete this flow.
        console.info('[auth] password reset requested; code generated but delivery is not configured')
      }
    }

    // Identical shape whether or not the account exists.
    return demo && resetCode
      ? NextResponse.json({ ok: true, resetCode })
      : NextResponse.json({ ok: true })
  } catch (e) {
    console.error('POST /api/auth/forgot failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
