import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/** PUT /api/admin/organizers/[id] — approve / reject / reset to pending. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('SUPER_ADMIN')
    const { id } = await params

    const body = (await req.json().catch(() => null)) as { status?: unknown } | null
    const status = body?.status
    if (status !== 'APPROVED' && status !== 'REJECTED' && status !== 'PENDING') {
      return NextResponse.json({ error: 'Status must be APPROVED, REJECTED or PENDING' }, { status: 400 })
    }

    const organizer = await db.organizer.findUnique({ where: { id } })
    if (!organizer) return NextResponse.json({ error: 'Organizer not found' }, { status: 404 })

    const updated = await db.organizer.update({
      where: { id },
      data: { status },
      include: { user: { select: { id: true, name: true, email: true, phone: true, status: true } } },
    })
    return NextResponse.json({ organizer: updated })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('PUT /api/admin/organizers/[id] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to update organizer' }, { status: 500 })
  }
}
