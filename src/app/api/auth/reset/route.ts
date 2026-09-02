import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      email?: string
      code?: string
      newPassword?: string
    } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const email = (body.email || '').trim().toLowerCase()
    const code = (body.code || '').trim()
    const newPassword = body.newPassword || ''

    if (!email || !code) return NextResponse.json({ error: 'Email and reset code are required' }, { status: 400 })
    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user || !user.resetCode || user.resetCode !== code) {
      return NextResponse.json({ error: 'Invalid or expired reset code' }, { status: 400 })
    }
    if (!user.resetCodeExpiry || user.resetCodeExpiry.getTime() < Date.now()) {
      return NextResponse.json({ error: 'Reset code has expired. Request a new one.' }, { status: 400 })
    }

    const passwordHash = await hashPassword(newPassword)
    await db.user.update({
      where: { id: user.id },
      data: { password: passwordHash, resetCode: null, resetCodeExpiry: null },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('POST /api/auth/reset failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
