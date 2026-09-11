import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  createdAt: true,
  organizer: { select: { id: true, organizationName: true, status: true } },
} as const

const MAX_ROWS = 200

/**
 * GET /api/admin/users?role=&q= — user directory (no password fields).
 *
 * `counts` covers every user rather than the filtered page, so the role mix is
 * readable from any filter.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole('SUPER_ADMIN')

    const sp = req.nextUrl.searchParams
    const role = (sp.get('role') || '').trim()
    const q = (sp.get('q') || '').trim()

    const where: Record<string, unknown> = {}
    if (role) where.role = role
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ]
    }

    const [users, grouped] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        select: USER_SELECT,
      }),
      db.user.groupBy({ by: ['role'], _count: { _all: true } }),
    ])
    return NextResponse.json({
      users,
      counts: Object.fromEntries(grouped.map((g) => [g.role, g._count._all])),
      truncated: users.length === MAX_ROWS,
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/admin/users failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 })
  }
}
