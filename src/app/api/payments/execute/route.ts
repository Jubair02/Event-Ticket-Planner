import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { AuthError, generateQrToken, generateTicketCode, generateTransactionId, requireAuth } from '@/lib/auth'

const VALID_METHODS = ['bKash', 'Nagad', 'CARD']

type FulfillItem = { ticketTypeId: string; quantity: number }

/**
 * Reads the canonical item list stashed on the pending Payment row
 * (Payment.transactionId holds the items JSON until the gateway overwrites it
 * with the real transaction id on success). Server-side only — the frontend is
 * never trusted for what should be fulfilled.
 */
function parseStashedItems(raw: string | null): FulfillItem[] | null {
  if (!raw) return null
  try {
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr) || arr.length === 0) return null
    const merged = new Map<string, number>()
    for (const it of arr) {
      const ticketTypeId =
        it && typeof it === 'object' && typeof (it as { ticketTypeId?: unknown }).ticketTypeId === 'string'
          ? ((it as { ticketTypeId: string }).ticketTypeId || '').trim()
          : ''
      const quantity = it && typeof it === 'object' ? Number((it as { quantity?: unknown }).quantity) : NaN
      if (!ticketTypeId || !Number.isInteger(quantity) || quantity < 1) return null
      merged.set(ticketTypeId, (merged.get(ticketTypeId) || 0) + quantity)
    }
    return Array.from(merged.entries()).map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }))
  } catch {
    return null
  }
}

/**
 * POST /api/payments/execute
 * Simulates the SSLCOMMERZ gateway completing AND the IPN hitting our backend.
 * All verification happens here, server-side: inventory is re-checked and
 * tickets are generated ONLY inside this transaction — never from the client.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = (await req.json().catch(() => null)) as {
      orderId?: unknown
      method?: unknown
      outcome?: unknown
    } | null
    if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const orderId = typeof body.orderId === 'string' ? body.orderId : ''
    const method = typeof body.method === 'string' ? body.method : ''
    const outcome = body.outcome === 'FAILED' ? 'FAILED' : 'SUCCESS'

    if (!orderId) return NextResponse.json({ error: 'Order is required' }, { status: 400 })
    if (!VALID_METHODS.includes(method)) {
      return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 })
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 }, user: { select: { id: true, name: true } } },
    })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'You do not have permission to pay for this order' }, { status: 403 })
    }

    const payment = order.payments[0]
    if (!payment) return NextResponse.json({ error: 'Payment not found for this order' }, { status: 404 })

    // Idempotency: already fulfilled.
    if (payment.status === 'PAID' || order.paymentStatus === 'PAID') {
      return NextResponse.json({ status: 'PAID', orderId })
    }

    // Gateway reported failure → mark payment + order FAILED.
    if (outcome === 'FAILED') {
      await db.$transaction([
        db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', method } }),
        db.order.update({ where: { id: order.id }, data: { paymentStatus: 'FAILED' } }),
      ])
      return NextResponse.json({ status: 'FAILED', orderId })
    }

    // Success path — the security-critical transaction.
    const items = parseStashedItems(payment.transactionId)
    if (!items) {
      return NextResponse.json({ error: 'Order has no fulfillable item data' }, { status: 400 })
    }

    const result = await db.$transaction(async (tx) => {
      // Fresh inventory read inside the transaction.
      const ticketTypes = await tx.ticketType.findMany({
        where: { id: { in: items.map((i) => i.ticketTypeId) } },
      })

      let insufficient = false
      for (const item of items) {
        const tt = ticketTypes.find((t) => t.id === item.ticketTypeId)
        if (!tt || tt.eventId !== order.eventId || tt.soldQuantity + item.quantity > tt.totalQuantity) {
          insufficient = true
        }
      }

      if (insufficient) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', method } })
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'FAILED' } })
        return { fulfilled: false as const }
      }

      for (const item of items) {
        for (let i = 0; i < item.quantity; i++) {
          await tx.ticket.create({
            data: {
              orderId: order.id,
              eventId: order.eventId,
              ticketTypeId: item.ticketTypeId,
              userId: order.userId,
              attendeeName: order.user.name,
              ticketCode: await generateTicketCode(),
              qrToken: await generateQrToken(),
              status: 'ACTIVE',
            },
          })
        }
        // Atomic increment of sold inventory.
        await tx.ticketType.update({
          where: { id: item.ticketTypeId },
          data: { soldQuantity: { increment: item.quantity } },
        })
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PAID',
          method,
          transactionId: generateTransactionId(),
          paidAt: new Date(),
        },
      })
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'PAID', status: 'CONFIRMED' },
      })
      return { fulfilled: true as const }
    })

    if (!result.fulfilled) {
      return NextResponse.json({ status: 'FAILED', orderId, error: 'Insufficient tickets' })
    }
    return NextResponse.json({ status: 'PAID', orderId })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // Ultra-rare ticket code/QR collision — safe to retry the request.
      return NextResponse.json({ error: 'Collision while issuing tickets. Please retry.' }, { status: 500 })
    }
    console.error('POST /api/payments/execute failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Payment execution failed' }, { status: 500 })
  }
}
