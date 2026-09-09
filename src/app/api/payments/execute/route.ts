import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { AuthError, generateQrToken, generateTicketCode, generateTransactionId, requireAuth } from '@/lib/auth'
import { paymentCapturedLines, postLedgerGroup } from '@/lib/ledger'
import { fromDbMinor } from '@/lib/money'

const VALID_METHODS = ['bKash', 'Nagad', 'CARD']

type FulfillItem = { ticketTypeId: string; quantity: number }

/**
 * Thrown inside the fulfillment transaction so it rolls back — undoing any
 * inventory already claimed for earlier items in the same order.
 */
class InsufficientInventoryError extends Error {}

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
      include: {
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        user: { select: { id: true, name: true } },
        event: { select: { organizerId: true, title: true, endDate: true } },
      },
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

    // Tickets are issued to the attendee captured at checkout. Orders created
    // before that field existed fall back to the buyer's own name.
    const attendeeName = order.attendeeName?.trim() || order.user.name

    let fulfilled: boolean
    try {
      await db.$transaction(async (tx) => {
        // Claim inventory with a conditional UPDATE: the availability check and
        // the increment happen in one statement, so two concurrent payments
        // cannot both pass the check and oversell the ticket type. Prisma cannot
        // express the column-to-column comparison in `where`, hence raw SQL.
        // 0 affected rows = not enough left (or a bad/foreign ticket type id).
        for (const item of items) {
          const claimed = await tx.$executeRaw`
            UPDATE "TicketType"
            SET "soldQuantity" = "soldQuantity" + ${item.quantity}
            WHERE "id" = ${item.ticketTypeId}
              AND "eventId" = ${order.eventId}
              AND "soldQuantity" + ${item.quantity} <= "totalQuantity"
          `
          if (claimed !== 1) throw new InsufficientInventoryError()
        }

        for (const item of items) {
          for (let i = 0; i < item.quantity; i++) {
            await tx.ticket.create({
              data: {
                orderId: order.id,
                eventId: order.eventId,
                ticketTypeId: item.ticketTypeId,
                userId: order.userId,
                attendeeName,
                ticketCode: await generateTicketCode(),
                qrToken: await generateQrToken(),
                status: 'ACTIVE',
              },
            })
          }
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

        // Book the money in the same transaction that confirms the order, so a
        // paid order can never exist without its ledger entries. The posting
        // splits the customer's payment into our commission and what the
        // organizer is owed, and `postLedgerGroup` refuses to write it unless
        // those sides balance against the total.
        //
        // A zero-total order (a free or fully discounted ticket) moves no money,
        // so there is nothing to book. It is skipped rather than posted as a
        // pair of zero lines, which the ledger rejects by design — without this
        // guard a free ticket would roll back its own fulfilment.
        if (fromDbMinor(order.totalMinor) > 0) {
          await postLedgerGroup(tx, {
            kind: 'PAYMENT_CAPTURED',
            lines: paymentCapturedLines({
              subtotalMinor: fromDbMinor(order.subtotalMinor),
              discountMinor: fromDbMinor(order.discountMinor),
              platformFeeMinor: fromDbMinor(order.platformFeeMinor),
              totalMinor: fromDbMinor(order.totalMinor),
            }),
            refs: {
              organizerId: order.event.organizerId,
              eventId: order.eventId,
              orderId: order.id,
              paymentId: payment.id,
            },
            description: `Ticket sales — ${order.event.title}`,
          })
        }
      })
      fulfilled = true
    } catch (err) {
      if (!(err instanceof InsufficientInventoryError)) throw err
      // The transaction rolled back, so no inventory was consumed. Record the
      // failure separately — transactionId keeps the item stash so the customer
      // can retry the payment.
      await db.$transaction([
        db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', method } }),
        db.order.update({ where: { id: order.id }, data: { paymentStatus: 'FAILED' } }),
      ])
      fulfilled = false
    }

    if (!fulfilled) {
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
