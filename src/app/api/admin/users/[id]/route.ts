import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/** PUT /api/admin/users/[id] — activate / suspend a user (never yourself). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRole('SUPER_ADMIN')
    const { id } = await params

    const body = (await req.json().catch(() => null)) as { status?: unknown } | null
    const status = body?.status
    if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
      return NextResponse.json({ error: 'Status must be ACTIVE or SUSPENDED' }, { status: 400 })
    }

    if (id === admin.id && status === 'SUSPENDED') {
      return NextResponse.json({ error: 'You cannot suspend your own account' }, { status: 400 })
    }

    const target = await db.user.findUnique({ where: { id } })
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Admins must not be able to lock each other out. The dashboard already
    // hides the control for admin rows; this enforces it at the API too.
    if (target.role === 'SUPER_ADMIN' && status === 'SUSPENDED') {
      return NextResponse.json({ error: 'Super admin accounts cannot be suspended' }, { status: 403 })
    }

    const user = await db.user.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        organizer: { select: { id: true, organizationName: true, status: true } },
      },
    })
    return NextResponse.json({ user })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('PUT /api/admin/users/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}
