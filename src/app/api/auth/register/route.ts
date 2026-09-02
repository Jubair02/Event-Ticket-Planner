import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { COOKIE_NAME, hashPassword, safeUser, signToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      name?: string
      email?: string
      phone?: string
      password?: string
      accountType?: string
      organizationName?: string
    } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const name = (body.name || '').trim()
    const email = (body.email || '').trim().toLowerCase()
    const phone = (body.phone || '').trim() || null
    const password = body.password || ''
    const accountType = body.accountType === 'ORGANIZER' ? 'ORGANIZER' : 'CUSTOMER'
    const organizationName = (body.organizationName || '').trim()

    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }
    if (accountType === 'ORGANIZER' && !organizationName) {
      return NextResponse.json({ error: 'Organization name is required for organizer accounts' }, { status: 400 })
    }

    const existing = await db.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    const passwordHash = await hashPassword(password)

    const user = await db.user.create({
      data: {
        name,
        email,
        phone,
        password: passwordHash,
        role: accountType,
        ...(accountType === 'ORGANIZER'
          ? { organizer: { create: { organizationName, phone } } }
          : {}),
      },
      include: { organizer: true },
    })

    const token = await signToken({ sub: user.id, role: user.role })
    const res = NextResponse.json({ user: safeUser(user) }, { status: 201 })
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 3600,
    })
    return res
  } catch (e) {
    console.error('POST /api/auth/register failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
