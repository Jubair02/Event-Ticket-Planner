import { NextResponse } from 'next/server'
import { COOKIE_NAME, sessionCookieOptions } from '@/lib/auth'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  // Same flags as when it was set (maxAge 0 clears it) — a cookie only clears
  // reliably when the attributes match.
  res.cookies.set(COOKIE_NAME, '', sessionCookieOptions(0))
  return res
}
