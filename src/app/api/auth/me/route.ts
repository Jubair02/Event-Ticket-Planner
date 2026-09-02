import { NextResponse } from 'next/server'
import { getAuthUser, safeUser } from '@/lib/auth'

export async function GET() {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ user: null })

    // SafeUser plus staff assignment refs for EVENT_STAFF sessions.
    const payload = {
      ...safeUser(user),
      ...(user.role === 'EVENT_STAFF'
        ? {
            staffAssignments: user.staffAssignments.map((a) => ({
              eventId: a.eventId,
              event: a.event,
            })),
          }
        : {}),
    }
    return NextResponse.json({ user: payload })
  } catch (e) {
    console.error('GET /api/auth/me failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ user: null })
  }
}
