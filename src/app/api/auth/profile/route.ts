import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, hashPassword, requireAuth, safeUser, verifyPassword } from '@/lib/auth'

export async function PUT(req: NextRequest) {
  try {
    const session = await requireAuth()
    const body = (await req.json().catch(() => null)) as {
      name?: string
      phone?: string
      currentPassword?: string
      newPassword?: string
    } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const data: { name?: string; phone?: string | null; password?: string } = {}
    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
      data.name = name
    }
    if (typeof body.phone === 'string') {
      data.phone = body.phone.trim() || null
    }

    if (body.newPassword) {
      const newPassword = String(body.newPassword)
      if (newPassword.length < 6) {
        return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 })
      }
      if (!body.currentPassword) {
        return NextResponse.json({ error: 'Current password is required to change your password' }, { status: 400 })
      }
      const ok = await verifyPassword(String(body.currentPassword), session.password)
      if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
      data.password = await hashPassword(newPassword)
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    await db.user.update({ where: { id: session.id }, data })

    const fresh = await db.user.findUnique({
      where: { id: session.id },
      include: {
        organizer: true,
        staffAssignments: {
          include: { event: { select: { id: true, title: true, status: true, startDate: true } } },
        },
      },
    })
    if (!fresh) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const payload = {
      ...safeUser(fresh),
      ...(fresh.role === 'EVENT_STAFF'
        ? {
            staffAssignments: fresh.staffAssignments.map((a) => ({
              eventId: a.eventId,
              event: a.event,
            })),
          }
        : {}),
    }
    return NextResponse.json({ user: payload })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('PUT /api/auth/profile failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
