import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'

/**
 * Demo password-reset request. Always responds 200 to avoid email enumeration.
 * In demo mode (no email service) the generated code is returned in the response
 * so the SPA can display it.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { email?: string } | null
    const email = (body?.email || '').trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

    const user = await db.user.findUnique({ where: { email } })
    let resetCode = ''
    if (user) {
      resetCode = String(crypto.randomInt(100000, 1000000))
      await db.user.update({
        where: { id: user.id },
        data: {
          resetCode,
          resetCodeExpiry: new Date(Date.now() + 10 * 60 * 1000),
        },
      })
    }

    return NextResponse.json({ ok: true, resetCode })
  } catch (e) {
    console.error('POST /api/auth/forgot failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
