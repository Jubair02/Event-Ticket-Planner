import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AuthError, requireRole } from '@/lib/auth'

/** GET /api/admin/stats — platform-wide overview for SUPER_ADMIN. */
export async function GET() {
  try {
    await requireRole('SUPER_ADMIN')

    const [
      totalUsers,
      totalCustomers,
      totalOrganizers,
      totalStaff,
      totalEvents,
      publishedEvents,
      pendingEvents,
      pendingOrganizers,
      totalOrders,
      paidOrders,
      revenueAgg,
      ticketsSoldAgg,
      totalCheckIns,
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { role: 'CUSTOMER' } }),
      db.user.count({ where: { role: 'ORGANIZER' } }),
      db.user.count({ where: { role: 'EVENT_STAFF' } }),
      db.event.count(),
      db.event.count({ where: { status: 'PUBLISHED' } }),
      db.event.count({ where: { status: 'PENDING_APPROVAL' } }),
      db.organizer.count({ where: { status: 'PENDING' } }),
      db.order.count(),
      db.order.count({ where: { paymentStatus: 'PAID' } }),
      db.order.aggregate({ _sum: { totalAmount: true }, where: { paymentStatus: 'PAID' } }),
      db.ticketType.aggregate({ _sum: { soldQuantity: true } }),
      db.ticket.count({ where: { status: 'CHECKED_IN' } }),
    ])

    return NextResponse.json({
      stats: {
        totalUsers,
        totalCustomers,
        totalOrganizers,
        totalStaff,
        totalEvents,
        publishedEvents,
        pendingEvents,
        pendingOrganizers,
        totalOrders,
        paidOrders,
        totalRevenue: revenueAgg._sum.totalAmount ?? 0,
        totalTicketsSold: ticketsSoldAgg._sum.soldQuantity ?? 0,
        totalCheckIns,
      },
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/admin/stats failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
