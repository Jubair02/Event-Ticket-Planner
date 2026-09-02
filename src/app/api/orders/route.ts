import { NextRequest, NextResponse } from 'next/server'
import { Order, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { AuthError, generateOrderNumber, requireAuth } from '@/lib/auth'
import { PLATFORM_FEE_RATE } from '@/lib/constants'

type ItemInput = { ticketTypeId?: unknown; quantity?: unknown }

/** Merges duplicate ticket types and validates quantities. Returns null when invalid. */
function mergeItems(raw: unknown): { ticketTypeId: string; quantity: number }[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const merged = new Map<string, number>()
  for (const it of raw as ItemInput[]) {
    const ticketTypeId = typeof it?.ticketTypeId === 'string' ? it.ticketTypeId.trim() : ''
    const quantity = Number(it?.quantity)
    if (!ticketTypeId || !Number.isInteger(quantity) || quantity < 1) return null
    merged.set(ticketTypeId, (merged.get(ticketTypeId) || 0) + quantity)
  }
  return Array.from(merged.entries()).map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }))
}

/**
 * POST /api/orders — create a pending order + pending payment.
 * The ordered items are stored server-side on the pending Payment row so the
 * payment-execution step can fulfill them WITHOUT trusting the frontend.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = (await req.json().catch(() => null)) as {
      eventId?: unknown
      items?: unknown
      attendee?: { name?: unknown; email?: unknown; phone?: unknown }
    } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const eventId = typeof body.eventId === 'string' ? body.eventId : ''
    if (!eventId) return NextResponse.json({ error: 'Event is required' }, { status: 400 })

    const attendeeName = typeof body.attendee?.name === 'string' ? body.attendee.name.trim() : ''
    const attendeeEmail = typeof body.attendee?.email === 'string' ? body.attendee.email.trim() : ''
    const attendeePhone = typeof body.attendee?.phone === 'string' ? body.attendee.phone.trim() : ''
    if (!attendeeName || !attendeeEmail || !attendeePhone) {
      return NextResponse.json({ error: 'Attendee name, email and phone are required' }, { status: 400 })
    }

    const items = mergeItems(body.items)
    if (!items) {
      return NextResponse.json({ error: 'Add at least one ticket with a valid quantity' }, { status: 400 })
    }

    const event = await db.event.findUnique({
      where: { id: eventId },
      include: { ticketTypes: true },
    })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 400 })
    if (event.status !== 'PUBLISHED' && event.status !== 'ONGOING') {
      return NextResponse.json({ error: 'Tickets for this event are not on sale' }, { status: 400 })
    }

    const now = Date.now()
    let subtotal = 0
    for (const item of items) {
      const tt = event.ticketTypes.find((t) => t.id === item.ticketTypeId)
      if (!tt) return NextResponse.json({ error: 'Invalid ticket type in order' }, { status: 400 })
      if (tt.salesStart && now < tt.salesStart.getTime()) {
        return NextResponse.json({ error: `Sales for "${tt.name}" have not started yet` }, { status: 400 })
      }
      if (tt.salesEnd && now > tt.salesEnd.getTime()) {
        return NextResponse.json({ error: `Sales for "${tt.name}" have ended` }, { status: 400 })
      }
      if (item.quantity > tt.maxPerOrder) {
        return NextResponse.json(
          { error: `Maximum ${tt.maxPerOrder} ticket(s) per order for "${tt.name}"` },
          { status: 400 }
        )
      }
      const available = tt.totalQuantity - tt.soldQuantity
      if (item.quantity > available) {
        return NextResponse.json(
          { error: `Only ${Math.max(available, 0)} ticket(s) left for "${tt.name}"` },
          { status: 400 }
        )
      }
      subtotal += tt.price * item.quantity
    }

    const platformFee = Math.round(subtotal * PLATFORM_FEE_RATE)
    const totalAmount = subtotal + platformFee

    // Order + pending payment. The pending Payment.transactionId carries the
    // canonical item list (server-side stash) until the gateway overwrites it
    // with the real SSLCOMMERZ transaction id on success.
    const itemsJson = JSON.stringify(items)
    let order: Order | null = null
    for (let attempt = 0; attempt < 3 && !order; attempt++) {
      try {
        order = await db.order.create({
          data: {
            orderNumber: generateOrderNumber(),
            userId: user.id,
            eventId,
            subtotal,
            platformFee,
            totalAmount,
            paymentStatus: 'PENDING',
            status: 'CREATED',
            payments: {
              create: {
                amount: totalAmount,
                provider: 'SSLCOMMERZ',
                status: 'PENDING',
                transactionId: itemsJson,
              },
            },
          },
        })
      } catch (err) {
        const isDup =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
        if (!isDup || attempt === 2) throw err
      }
    }

    if (!order) {
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
    }

    return NextResponse.json(
      {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          subtotal: order.subtotal,
          platformFee: order.platformFee,
          totalAmount: order.totalAmount,
          eventId: order.eventId,
          paymentStatus: order.paymentStatus,
        },
      },
      { status: 201 }
    )
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('POST /api/orders failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
  }
}
