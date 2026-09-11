import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { AuthError, requireOrganizer } from '@/lib/auth'
import { fromDbMinor } from '@/lib/money'

const MAX_ROWS = 200

/**
 * GET /api/organizer/orders?status=&eventId=&q=
 *
 * Every order across the organizer's own events, newest first.
 *
 * Scoped by `event.organizerId` rather than by a list of event ids, so an
 * organizer cannot widen it by passing someone else's `eventId`: the filter
 * narrows within their own events and can never reach outside them.
 */
export async function GET(req: NextRequest) {
  try {
    const { organizer } = await requireOrganizer()

    const sp = req.nextUrl.searchParams
    const status = sp.get('status')?.trim()
    const eventId = sp.get('eventId')?.trim()
    const q = sp.get('q')?.trim()

    const where: Prisma.OrderWhereInput = {
      event: { organizerId: organizer.id },
      ...(status && status !== 'ALL' ? { paymentStatus: status } : {}),
      ...(eventId ? { eventId } : {}),
      ...(q
        ? {
            OR: [
              { orderNumber: { contains: q, mode: 'insensitive' } },
              { attendeeName: { contains: q, mode: 'insensitive' } },
              { attendeeEmail: { contains: q, mode: 'insensitive' } },
              { user: { name: { contains: q, mode: 'insensitive' } } },
              { user: { email: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }

    /**
     * What the header figures describe.
     *
     * Deliberately carries `eventId` but neither `status` nor `q`: picking an
     * event re-scopes the whole page to that event, while filtering by status
     * or searching must not move the totals underneath the operator.
     */
    const scope: Prisma.OrderWhereInput = {
      event: { organizerId: organizer.id },
      ...(eventId ? { eventId } : {}),
    }

    const [rows, grouped, paidAgg] = await Promise.all([
      db.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        select: {
          id: true,
          orderNumber: true,
          subtotalMinor: true,
          discountMinor: true,
          platformFeeMinor: true,
          totalMinor: true,
          refundedMinor: true,
          paymentStatus: true,
          createdAt: true,
          attendeeName: true,
          attendeeEmail: true,
          user: { select: { name: true, email: true } },
          event: { select: { id: true, slug: true, title: true, startDate: true } },
          _count: { select: { tickets: true } },
        },
      }),
      db.order.groupBy({
        by: ['paymentStatus'],
        _count: { _all: true },
        where: scope,
      }),
      // Gross across paid orders, not just the page being shown, so the header
      // figure does not change as the operator filters.
      db.order.aggregate({
        _sum: { totalMinor: true, refundedMinor: true },
        where: { ...scope, paymentStatus: 'PAID' },
      }),
    ])

    return NextResponse.json({
      orders: rows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        subtotalMinor: fromDbMinor(o.subtotalMinor),
        discountMinor: fromDbMinor(o.discountMinor),
        platformFeeMinor: fromDbMinor(o.platformFeeMinor),
        totalMinor: fromDbMinor(o.totalMinor),
        refundedMinor: fromDbMinor(o.refundedMinor),
        paymentStatus: o.paymentStatus,
        createdAt: o.createdAt,
        // The attendee is who the tickets were issued to; older orders have
        // none, so the buyer stands in.
        attendeeName: o.attendeeName ?? o.user.name,
        attendeeEmail: o.attendeeEmail ?? o.user.email,
        buyerName: o.user.name,
        event: o.event,
        ticketCount: o._count.tickets,
      })),
      counts: Object.fromEntries(grouped.map((g) => [g.paymentStatus, g._count._all])),
      grossMinor: fromDbMinor(paidAgg._sum.totalMinor),
      refundedMinor: fromDbMinor(paidAgg._sum.refundedMinor),
      truncated: rows.length === MAX_ROWS,
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('GET /api/organizer/orders failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 })
  }
}
