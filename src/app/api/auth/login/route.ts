import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { COOKIE_NAME, safeUser, sessionCookieOptions, signToken, verifyPassword } from '@/lib/auth'
import { MINUTE, clientIp, enforceRateLimits } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { email?: string; password?: string } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const email = (body.email || '').trim().toLowerCase()
    const password = body.password || ''
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    // Throttle credential guessing, per source and per targeted account.
    const limited = enforceRateLimits([
      { key: `login:ip:${clientIp(req)}`, limit: 20, windowMs: 10 * MINUTE },
      { key: `login:email:${email}`, limit: 8, windowMs: 10 * MINUTE },
    ])
    if (limited) return limited

    const user = await db.user.findUnique({
      where: { email },
      include: { organizer: true },
    })
    if (!user) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })

    const valid = await verifyPassword(password, user.password)
    if (!valid) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })

    if (user.status === 'SUSPENDED') {
      return NextResponse.json({ error: 'Your account has been suspended' }, { status: 403 })
    }

    const token = await signToken({ sub: user.id, role: user.role })
    const res = NextResponse.json({ user: safeUser(user) })
    res.cookies.set(COOKIE_NAME, token, sessionCookieOptions())
    return res
  } catch (e) {
    console.error('POST /api/auth/login failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
