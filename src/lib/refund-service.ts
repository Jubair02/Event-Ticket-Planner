/**
 * The refund state machine and everything that touches the database.
 *
 * Design rules this file exists to enforce:
 *
 * - **Money is never taken from a request.** Callers name an order and,
 *   optionally, a subset of tickets. `planRefund` prices it from stored rows
 *   using the policy in `@/lib/refunds`. There is no parameter anywhere in this
 *   module through which an API client could state an amount.
 * - **A ticket can only be in one refund at a time.** The claim is a
 *   conditional `UPDATE ... WHERE "refundLockId" IS NULL`, so two admins
 *   clicking at once cannot both refund the same ticket - the same technique
 *   /api/payments/execute uses to avoid overselling.
 * - **Every status change is a compare-and-swap.** Updates are written as
 *   `updateMany({ where: { id, status: <expected> } })` and the affected-row
 *   count is checked, so a webhook and an operator racing each other cannot
 *   both apply the same settlement and double-count the money.
 * - **The gateway is never called inside a transaction.** Holding a database
 *   transaction open across an external HTTP call is how you get lock storms;
 *   worse, rolling back after the gateway has moved money would leave the
 *   database claiming a refund never happened.
 * - **Settlement posts to the ledger in the same transaction.** A completed
 *   refund and its `REFUND_COMPLETED` ledger group commit together or not at
 *   all, so the books can never describe money that did not move.
 * - **Everything is written down.** Each step appends to RefundAuditLog with
 *   the operator, the amount in play and the status edge it traversed.
 */

import { Prisma, PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'
import { fromDbMinor, toDbMinor, formatMinor, type Minor } from '@/lib/money'
import { postLedgerGroup, refundCompletedLines } from '@/lib/ledger'
import {
  RefundError,
  type RefundInitiator,
  type RefundPolicy,
  type RefundQuote,
  type RefundReasonCode,
  type RefundStatus,
  type RefundType,
  REFUND_REASON_CODES,
  assertOrderRefundable,
  assertTransition,
  isFullOrderRefund,
  isTicketRefundable,
  quoteRefund,
  resolveRefundPolicy,
} from '@/lib/refunds'
import {
  buildIdempotencyKey,
  parseWebhookPayload,
  submitGatewayRefund,
  type RefundWebhookPayload,
} from '@/lib/refund-gateway'

/** Anything that can run a query: the client or an interactive transaction. */
export type DbClient = PrismaClient | Prisma.TransactionClient

/**
 * Who is acting. Recorded on every audit row, so each individual step is
 * answerable to an operator and not just the refund as a whole.
 */
export type RefundActor = {
  /** Null for engine-driven steps: gateway callbacks and queue drains. */
  id: string | null
  name: string | null
  /** The acting user's role, or SYSTEM. */
  role: string
  ip?: string | null
}

/** The engine acting on its own behalf. */
export const SYSTEM_ACTOR: RefundActor = { id: null, name: 'Refund engine', role: 'SYSTEM' }

export function actorFromUser(
  user: { id: string; name: string; role: string },
  ip?: string | null
): RefundActor {
  return { id: user.id, name: user.name, role: user.role, ip: ip ?? null }
}

// ---------------------------------------------------------------- audit

export type RefundAuditAction =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'GATEWAY_SUBMITTED'
  | 'GATEWAY_SETTLED'
  | 'GATEWAY_FAILED'
  | 'RETRIED'
  | 'WEBHOOK_RECEIVED'
  | 'TICKETS_RELEASED'
  | 'INVENTORY_RELEASED'
  | 'LEDGER_POSTED'

async function writeAudit(
  client: DbClient,
  args: {
    refundId: string
    action: RefundAuditAction
    actor: RefundActor
    fromStatus?: string | null
    toStatus?: string | null
    amountMinor?: Minor | null
    note?: string | null
    metadata?: unknown
  }
): Promise<void> {
  await client.refundAuditLog.create({
    data: {
      refundId: args.refundId,
      action: args.action,
      fromStatus: args.fromStatus ?? null,
      toStatus: args.toStatus ?? null,
      actorId: args.actor.id,
      actorRole: args.actor.role,
      actorName: args.actor.name,
      amountMinor:
        args.amountMinor === undefined || args.amountMinor === null ? null : toDbMinor(args.amountMinor),
      note: args.note ?? null,
      metadata: args.metadata === undefined ? null : JSON.stringify(args.metadata),
      ip: args.actor.ip ?? null,
    },
  })
}

// ---------------------------------------------------------------- shapes

const ORDER_FOR_REFUND_INCLUDE = {
  event: {
    select: { id: true, title: true, status: true, startDate: true, organizerId: true },
  },
  tickets: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      status: true,
      refundLockId: true,
      ticketCode: true,
      ticketTypeId: true,
      ticketType: { select: { id: true, name: true, priceMinor: true } },
    },
  },
  payments: { orderBy: { createdAt: 'desc' as const } },
} as const

export const REFUND_DETAIL_INCLUDE = {
  order: {
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
    },
  },
  event: { select: { id: true, slug: true, title: true, status: true, startDate: true } },
  user: { select: { id: true, name: true, email: true } },
  payment: { select: { id: true, method: true, provider: true, transactionId: true, amountMinor: true } },
  requestedBy: { select: { id: true, name: true, role: true } },
  approvedBy: { select: { id: true, name: true, role: true } },
  processedBy: { select: { id: true, name: true, role: true } },
  items: {
    select: {
      id: true,
      ticketId: true,
      faceValueMinor: true,
      platformFeeShareMinor: true,
      processingFeeMinor: true,
      amountMinor: true,
      ticketStatusAtRefund: true,
      ticket: { select: { ticketCode: true, ticketType: { select: { name: true } } } },
    },
  },
  auditLogs: { orderBy: { createdAt: 'asc' as const } },
} as const

/** A refund with everything the admin views need. */
export type RefundDetail = Prisma.RefundGetPayload<{ include: typeof REFUND_DETAIL_INCLUDE }>

// ---------------------------------------------------------------- planning

export type PlannedTicket = {
  id: string
  status: string
  ticketCode: string
  ticketTypeId: string
  ticketTypeName: string
  faceValueMinor: Minor
}

export type RefundPlan = {
  order: Prisma.OrderGetPayload<{ include: typeof ORDER_FOR_REFUND_INCLUDE }>
  /** The capture to reverse; null when no settled payment row exists. */
  paymentId: string | null
  paymentProvider: string | null
  paymentTransactionId: string | null
  tickets: PlannedTicket[]
  policy: RefundPolicy
  quote: RefundQuote
  type: RefundType
}

/**
 * Chooses the capture to reverse: the most recent payment that actually
 * collected money and still has room left in it.
 */
function pickCapture(
  payments: Array<{
    id: string
    status: string
    amountMinor: bigint
    refundedMinor: bigint
    provider: string
    transactionId: string | null
  }>
) {
  return (
    payments.find(
      (p) =>
        (p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED') &&
        fromDbMinor(p.amountMinor) - fromDbMinor(p.refundedMinor) > 0
    ) ?? null
  )
}

/**
 * Works out exactly what a refund would consist of, and prices it. Used both to
 * answer a quote request and as the first step of creating one, so a preview can
 * never disagree with what actually gets written.
 */
export async function planRefund(
  client: DbClient,
  req: {
    orderId: string
    ticketIds?: string[] | null
    reasonCode: RefundReasonCode
    initiatedBy: RefundInitiator
    now?: Date
  }
): Promise<RefundPlan> {
  const order = await client.order.findUnique({
    where: { id: req.orderId },
    include: ORDER_FOR_REFUND_INCLUDE,
  })
  if (!order) throw new RefundError('Order not found.', 404, 'REFUND_ORDER_NOT_FOUND')

  const orderMoney = {
    subtotalMinor: fromDbMinor(order.subtotalMinor),
    discountMinor: fromDbMinor(order.discountMinor),
    platformFeeMinor: fromDbMinor(order.platformFeeMinor),
    totalMinor: fromDbMinor(order.totalMinor),
    refundedMinor: fromDbMinor(order.refundedMinor),
  }

  assertOrderRefundable({ paymentStatus: order.paymentStatus, ...orderMoney })

  const candidates = order.tickets.filter((t) => isTicketRefundable(t, req.initiatedBy))

  let selected = candidates
  if (req.ticketIds && req.ticketIds.length > 0) {
    const wanted = Array.from(new Set(req.ticketIds))
    selected = []
    for (const ticketId of wanted) {
      const ticket = order.tickets.find((t) => t.id === ticketId)
      if (!ticket) {
        throw new RefundError(
          'One of the selected tickets does not belong to this order.',
          400,
          'REFUND_TICKET_NOT_ON_ORDER'
        )
      }
      if (!isTicketRefundable(ticket, req.initiatedBy)) {
        throw new RefundError(
          ticket.refundLockId
            ? `Ticket ${ticket.ticketCode} is already part of another refund.`
            : `Ticket ${ticket.ticketCode} cannot be refunded (status ${ticket.status}).`,
          409,
          'REFUND_TICKET_NOT_REFUNDABLE'
        )
      }
      selected.push(ticket)
    }
  }

  if (selected.length === 0) {
    throw new RefundError('There are no refundable tickets left on this order.', 409, 'REFUND_NO_TICKETS')
  }

  const policy = resolveRefundPolicy({
    reasonCode: req.reasonCode,
    eventStartDate: order.event.startDate,
    eventStatus: order.event.status,
    now: req.now,
  })

  const tickets: PlannedTicket[] = selected.map((t) => ({
    id: t.id,
    status: t.status,
    ticketCode: t.ticketCode,
    ticketTypeId: t.ticketTypeId,
    ticketTypeName: t.ticketType.name,
    faceValueMinor: fromDbMinor(t.ticketType.priceMinor),
  }))

  const quote = quoteRefund({
    order: orderMoney,
    tickets: tickets.map((t) => ({ id: t.id, faceValueMinor: t.faceValueMinor, status: t.status })),
    policy,
  })

  // FULL only when this one refund covers the entire order and nothing on it
  // has ever been refunded before; anything narrower is PARTIAL.
  const anythingClaimed = order.tickets.some((t) => t.refundLockId)
  const type: RefundType =
    req.reasonCode === 'EVENT_CANCELLED'
      ? 'EVENT_CANCELLATION'
      : !anythingClaimed && selected.length === order.tickets.length
        ? 'FULL'
        : 'PARTIAL'

  const capture = pickCapture(order.payments)

  return {
    order,
    paymentId: capture?.id ?? null,
    paymentProvider: capture?.provider ?? null,
    paymentTransactionId: capture?.transactionId ?? null,
    tickets,
    policy,
    quote,
    type,
  }
}

/** Convenience wrapper for the quote endpoints. */
export function quoteRefundForOrder(req: {
  orderId: string
  ticketIds?: string[] | null
  reasonCode: RefundReasonCode
  initiatedBy: RefundInitiator
}): Promise<RefundPlan> {
  return planRefund(db, req)
}

// ---------------------------------------------------------------- creation

/** `RFD-<year>-<6 digits>`, sequential within the year. */
export async function nextRefundNumber(client: DbClient): Promise<string> {
  const year = new Date().getFullYear()
  const count = await client.refund.count({
    where: { refundNumber: { startsWith: `RFD-${year}-` } },
  })
  return `RFD-${year}-${String(count + 1).padStart(6, '0')}`
}

/**
 * Claims a ticket for a refund. The condition is the whole point: the check and
 * the write are one statement, so two concurrent refunds cannot both take the
 * same ticket. Prisma cannot express "only if this column is still null" in a
 * way that reports the affected-row count, hence raw SQL.
 */
async function claimTicket(
  tx: Prisma.TransactionClient,
  ticketId: string,
  orderId: string,
  refundId: string
): Promise<void> {
  const claimed = await tx.$executeRaw`
    UPDATE "Ticket"
    SET "refundLockId" = ${refundId}
    WHERE "id" = ${ticketId}
      AND "orderId" = ${orderId}
      AND "refundLockId" IS NULL
  `
  if (claimed !== 1) {
    throw new RefundError(
      'One of these tickets was just claimed by another refund. Nothing was charged back; review the order and try again.',
      409,
      'REFUND_TICKET_CONTENDED'
    )
  }
}

/** Hands the tickets of a rejected refund back, so a corrected one can be filed. */
async function releaseTickets(tx: Prisma.TransactionClient, refundId: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE "Ticket"
    SET "refundLockId" = NULL
    WHERE "refundLockId" = ${refundId}
  `
}

export type CreateRefundArgs = {
  orderId: string
  /** Subset of tickets for a partial refund; omit to take every refundable one. */
  ticketIds?: string[] | null
  reasonCode: RefundReasonCode
  reasonNote?: string | null
  initiatedBy: RefundInitiator
  actor: RefundActor
  /** Skip REQUESTED and land straight in APPROVED (admin and system paths). */
  autoApprove?: boolean
  /** Groups the refunds of one event cancellation. */
  batchId?: string | null
  now?: Date
}

/**
 * Files a refund. Priced, ticket-claimed and audited in a single transaction,
 * so either all of it happened or none of it did.
 */
export async function createRefund(args: CreateRefundArgs): Promise<RefundDetail> {
  // The reference number is derived from a count, so a genuine race surfaces as
  // a unique-constraint violation. Retry a couple of times before giving up -
  // the same approach POST /api/orders takes for order numbers.
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const plan = await planRefund(tx, {
          orderId: args.orderId,
          ticketIds: args.ticketIds,
          reasonCode: args.reasonCode,
          initiatedBy: args.initiatedBy,
          now: args.now,
        })

        const refundNumber = await nextRefundNumber(tx)
        const autoApprove = args.autoApprove === true
        const now = args.now ?? new Date()
        const status: RefundStatus = autoApprove ? 'APPROVED' : 'REQUESTED'
        const note = args.reasonNote?.trim() || REFUND_REASON_CODES[args.reasonCode].label

        const refund = await tx.refund.create({
          data: {
            refundNumber,
            orderId: plan.order.id,
            paymentId: plan.paymentId,
            eventId: plan.order.eventId,
            userId: plan.order.userId,
            type: plan.type,
            status,
            initiatedBy: args.initiatedBy,

            amountMinor: toDbMinor(plan.quote.amountMinor),
            organizerShareMinor: toDbMinor(plan.quote.organizerShareMinor),
            platformShareMinor: toDbMinor(plan.quote.platformShareMinor),
            ticketFaceValueMinor: toDbMinor(plan.quote.ticketFaceValueMinor),
            platformFeeRefundedMinor: toDbMinor(plan.quote.platformFeeRefundedMinor),
            processingFeeMinor: toDbMinor(plan.quote.processingFeeMinor),
            currency: plan.quote.currency,

            reason: note,
            reasonCode: args.reasonCode,
            policyCode: plan.policy.code,

            requestedById: args.actor.id,
            requestedAt: now,
            approvedById: autoApprove ? args.actor.id : null,
            approvedAt: autoApprove ? now : null,

            provider: plan.paymentProvider,
            idempotencyKey: buildIdempotencyKey(refundNumber),
            batchId: args.batchId ?? null,
          },
        })

        for (const ticket of plan.tickets) {
          await claimTicket(tx, ticket.id, plan.order.id, refund.id)
        }

        await tx.refundItem.createMany({
          data: plan.quote.lines.map((line) => ({
            refundId: refund.id,
            ticketId: line.ticketId,
            faceValueMinor: toDbMinor(line.faceValueMinor),
            platformFeeShareMinor: toDbMinor(line.platformFeeShareMinor),
            processingFeeMinor: toDbMinor(line.processingFeeMinor),
            amountMinor: toDbMinor(line.amountMinor),
            ticketStatusAtRefund: line.ticketStatusAtRefund,
          })),
        })

        await writeAudit(tx, {
          refundId: refund.id,
          action: 'REQUESTED',
          actor: args.actor,
          toStatus: 'REQUESTED',
          amountMinor: plan.quote.amountMinor,
          note: `${plan.type} refund filed under ${REFUND_REASON_CODES[args.reasonCode].label} (${plan.policy.code}).`,
          metadata: {
            policy: plan.policy,
            ticketIds: plan.tickets.map((t) => t.id),
            grossTicketValueMinor: plan.quote.grossTicketValueMinor,
            processingFeeMinor: plan.quote.processingFeeMinor,
          },
        })

        if (autoApprove) {
          await writeAudit(tx, {
            refundId: refund.id,
            action: 'APPROVED',
            actor: args.actor,
            fromStatus: 'REQUESTED',
            toStatus: 'APPROVED',
            amountMinor: plan.quote.amountMinor,
            note: 'Approved on creation.',
          })
        }

        return tx.refund.findUniqueOrThrow({
          where: { id: refund.id },
          include: REFUND_DETAIL_INCLUDE,
        })
      })
    } catch (err) {
      const isDuplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
      if (!isDuplicate || attempt >= 2) throw err
    }
  }
}

// ---------------------------------------------------------------- decisions

/**
 * Approve or reject a refund that is awaiting a decision.
 *
 * Rejection is what releases the tickets: until then they stay claimed, so a
 * customer cannot file a second request while the first is still open.
 */
export async function decideRefund(args: {
  refundId: string
  action: 'approve' | 'reject'
  actor: RefundActor
  note?: string | null
  rejectionReason?: string | null
}): Promise<RefundDetail> {
  const to: RefundStatus = args.action === 'approve' ? 'APPROVED' : 'REJECTED'

  return db.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({ where: { id: args.refundId } })
    if (!refund) throw new RefundError('Refund not found.', 404, 'REFUND_NOT_FOUND')

    const from = refund.status as RefundStatus
    assertTransition(from, to)

    const rejectionReason = args.rejectionReason?.trim()
    if (to === 'REJECTED' && !rejectionReason) {
      throw new RefundError('Give a reason for rejecting this refund.', 400, 'REFUND_REJECTION_REASON_REQUIRED')
    }

    const now = new Date()
    const updated = await tx.refund.updateMany({
      where: { id: refund.id, status: from },
      data:
        to === 'APPROVED'
          ? { status: 'APPROVED', approvedById: args.actor.id, approvedAt: now }
          : {
              status: 'REJECTED',
              rejectedAt: now,
              rejectionReason,
              approvedById: refund.approvedById ?? args.actor.id,
            },
    })
    if (updated.count !== 1) {
      throw new RefundError(
        'This refund was changed by someone else a moment ago. Reload it and try again.',
        409,
        'REFUND_CONCURRENT_UPDATE'
      )
    }

    await writeAudit(tx, {
      refundId: refund.id,
      action: to === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      actor: args.actor,
      fromStatus: from,
      toStatus: to,
      amountMinor: fromDbMinor(refund.amountMinor),
      note: to === 'REJECTED' ? rejectionReason : args.note?.trim() || null,
    })

    if (to === 'REJECTED') {
      const released = await releaseTickets(tx, refund.id)
      await writeAudit(tx, {
        refundId: refund.id,
        action: 'TICKETS_RELEASED',
        actor: args.actor,
        fromStatus: to,
        toStatus: to,
        note: `${released} ticket(s) released and refundable again.`,
      })
    }

    return tx.refund.findUniqueOrThrow({ where: { id: refund.id }, include: REFUND_DETAIL_INCLUDE })
  })
}

// ---------------------------------------------------------------- settlement

/**
 * Applies a settled refund to the rest of the system, exactly once.
 *
 * The compare-and-swap on the way in is what makes "exactly once" true: a
 * gateway webhook and an inline settlement can both arrive, and only the one
 * that wins the status change moves any money.
 */
async function applySettlement(
  tx: Prisma.TransactionClient,
  refundId: string,
  actor: RefundActor,
  gateway?: { gatewayStatus?: string | null; message?: string | null }
): Promise<boolean> {
  const now = new Date()

  const won = await tx.refund.updateMany({
    where: { id: refundId, status: 'PROCESSING' },
    data: {
      status: 'COMPLETED',
      completedAt: now,
      gatewayStatus: gateway?.gatewayStatus ?? undefined,
    },
  })
  if (won.count !== 1) return false

  const refund = await tx.refund.findUniqueOrThrow({
    where: { id: refundId },
    include: {
      items: { select: { ticketId: true } },
      order: {
        include: { event: { select: { id: true, title: true, status: true, organizerId: true } } },
      },
    },
  })
  const amountMinor = fromDbMinor(refund.amountMinor)

  // --- order: accumulate with an increment so concurrent settlements on the
  // same order cannot lose one another's amount, then re-read the total to
  // decide whether the order is now fully refunded.
  await tx.order.update({
    where: { id: refund.orderId },
    data: { refundedMinor: { increment: refund.amountMinor } },
  })
  const orderNow = await tx.order.findUniqueOrThrow({
    where: { id: refund.orderId },
    select: { totalMinor: true, refundedMinor: true },
  })
  const orderFullyRefunded = isFullOrderRefund({
    order: {
      totalMinor: fromDbMinor(orderNow.totalMinor),
      refundedMinor: fromDbMinor(orderNow.refundedMinor),
    },
    amountMinor: 0,
  })
  await tx.order.update({
    where: { id: refund.orderId },
    data: { paymentStatus: orderFullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
  })

  // --- payment: same treatment, so one capture is never over-reversed.
  if (refund.paymentId) {
    await tx.payment.update({
      where: { id: refund.paymentId },
      data: { refundedMinor: { increment: refund.amountMinor } },
    })
    const paymentNow = await tx.payment.findUniqueOrThrow({
      where: { id: refund.paymentId },
      select: { amountMinor: true, refundedMinor: true },
    })
    await tx.payment.update({
      where: { id: refund.paymentId },
      data: {
        status:
          fromDbMinor(paymentNow.refundedMinor) >= fromDbMinor(paymentNow.amountMinor)
            ? 'REFUNDED'
            : 'PARTIALLY_REFUNDED',
      },
    })
  }

  // --- tickets: refunded tickets are spent. The lock stays on them, which is
  // what stops a second refund from ever claiming them again.
  const ticketIds = refund.items.map((i) => i.ticketId)
  await tx.ticket.updateMany({ where: { id: { in: ticketIds } }, data: { status: 'REFUNDED' } })

  await releaseInventory(tx, refundId, ticketIds, refund.order.event.status, actor)

  // --- ledger: DEBIT the organizer's payable and the platform's revenue by
  // their shares, CREDIT the clearing account by the total. Posted in this
  // transaction so the books and the refund commit together.
  const { groupId } = await postLedgerGroup(tx, {
    kind: 'REFUND_COMPLETED',
    lines: refundCompletedLines({
      amountMinor,
      organizerShareMinor: fromDbMinor(refund.organizerShareMinor),
      platformShareMinor: fromDbMinor(refund.platformShareMinor),
    }),
    refs: {
      organizerId: refund.order.event.organizerId,
      eventId: refund.order.eventId,
      orderId: refund.orderId,
      paymentId: refund.paymentId,
      refundId: refund.id,
    },
    occurredAt: now,
    description: `Refund ${refund.refundNumber} - ${refund.order.event.title}`,
  })

  await writeAudit(tx, {
    refundId,
    action: 'LEDGER_POSTED',
    actor,
    amountMinor,
    note: `Posted a balanced REFUND_COMPLETED group: organizer ${formatMinor(
      fromDbMinor(refund.organizerShareMinor)
    )}, platform ${formatMinor(fromDbMinor(refund.platformShareMinor))}.`,
    metadata: { groupId },
  })

  await writeAudit(tx, {
    refundId,
    action: 'GATEWAY_SETTLED',
    actor,
    fromStatus: 'PROCESSING',
    toStatus: 'COMPLETED',
    amountMinor,
    note: gateway?.message ?? 'Refund settled.',
    metadata: {
      orderFullyRefunded,
      orderRefundedTotalMinor: fromDbMinor(orderNow.refundedMinor),
      ticketIds,
    },
  })

  return true
}

/**
 * Puts refunded seats back on sale.
 *
 * Only for events that can still sell: a cancelled or finished event has no
 * inventory worth reopening, and quietly inflating its availability would show
 * tickets for sale to an event nobody can attend. The decrement is conditional
 * so a soldQuantity that has already drifted cannot be pushed negative - if it
 * does not apply, the refund still stands and the audit row records that.
 */
async function releaseInventory(
  tx: Prisma.TransactionClient,
  refundId: string,
  ticketIds: string[],
  eventStatus: string,
  actor: RefundActor
): Promise<void> {
  if (eventStatus === 'CANCELLED' || eventStatus === 'COMPLETED') return
  if (ticketIds.length === 0) return

  const rows = await tx.ticket.findMany({
    where: { id: { in: ticketIds } },
    select: { ticketTypeId: true },
  })
  const perType = new Map<string, number>()
  for (const row of rows) perType.set(row.ticketTypeId, (perType.get(row.ticketTypeId) ?? 0) + 1)

  const released: Record<string, number> = {}
  for (const [ticketTypeId, quantity] of perType) {
    const applied = await tx.$executeRaw`
      UPDATE "TicketType"
      SET "soldQuantity" = "soldQuantity" - ${quantity}
      WHERE "id" = ${ticketTypeId}
        AND "soldQuantity" >= ${quantity}
    `
    released[ticketTypeId] = applied === 1 ? quantity : 0
  }

  await writeAudit(tx, {
    refundId,
    action: 'INVENTORY_RELEASED',
    actor,
    note: 'Refunded seats returned to the ticket types they came from.',
    metadata: { released },
  })
}

// ---------------------------------------------------------------- processing

export type ProcessResult = {
  refund: RefundDetail
  /** Terminal outcome of this attempt. */
  outcome: 'SETTLED' | 'AWAITING_GATEWAY' | 'FAILED'
  message: string
}

/**
 * Sends an approved (or previously failed) refund to the gateway.
 *
 * Split into three phases on purpose. The first claims the refund by moving it
 * to PROCESSING, which doubles as the lock: a second worker attempting the same
 * refund loses the compare-and-swap and stops. Only then is the gateway called,
 * outside any transaction. The third phase records what came back.
 */
export async function processRefund(args: { refundId: string; actor: RefundActor }): Promise<ProcessResult> {
  // --- phase 1: claim it.
  const claimed = await db.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({
      where: { id: args.refundId },
      include: { payment: { select: { transactionId: true, provider: true } } },
    })
    if (!refund) throw new RefundError('Refund not found.', 404, 'REFUND_NOT_FOUND')

    const from = refund.status as RefundStatus
    assertTransition(from, 'PROCESSING')

    const now = new Date()
    const won = await tx.refund.updateMany({
      where: { id: refund.id, status: from },
      data: {
        status: 'PROCESSING',
        processedAt: now,
        processedById: args.actor.id,
        gatewayAttempts: { increment: 1 },
        gatewayLastAttemptAt: now,
      },
    })
    if (won.count !== 1) {
      throw new RefundError(
        'This refund is already being processed. Reload it to see where it got to.',
        409,
        'REFUND_ALREADY_PROCESSING'
      )
    }

    await writeAudit(tx, {
      refundId: refund.id,
      action: from === 'FAILED' ? 'RETRIED' : 'GATEWAY_SUBMITTED',
      actor: args.actor,
      fromStatus: from,
      toStatus: 'PROCESSING',
      amountMinor: fromDbMinor(refund.amountMinor),
      note:
        from === 'FAILED'
          ? `Retrying attempt ${refund.gatewayAttempts + 1} with the original idempotency key.`
          : 'Submitted to the payment gateway.',
    })

    return refund
  })

  // --- phase 2: the external call, deliberately outside the transaction.
  const outcome = await submitGatewayRefund({
    idempotencyKey: claimed.idempotencyKey,
    provider: claimed.provider ?? claimed.payment?.provider ?? 'SSLCOMMERZ',
    originalTransactionId: claimed.payment?.transactionId ?? null,
    amountMinor: fromDbMinor(claimed.amountMinor),
    currency: claimed.currency,
    reason: claimed.reasonCode,
  })

  // --- phase 3: record it.
  return db.$transaction(async (tx) => {
    if (outcome.ok && outcome.settled) {
      await tx.refund.update({
        where: { id: claimed.id },
        data: { providerRefundId: outcome.gatewayRefundId, gatewayStatus: outcome.gatewayStatus },
      })
      const applied = await applySettlement(tx, claimed.id, args.actor, {
        gatewayStatus: outcome.gatewayStatus,
        message: outcome.message,
      })
      const refund = await tx.refund.findUniqueOrThrow({
        where: { id: claimed.id },
        include: REFUND_DETAIL_INCLUDE,
      })
      return {
        refund,
        outcome: 'SETTLED' as const,
        message: applied ? outcome.message : 'This refund had already been settled.',
      }
    }

    if (outcome.ok) {
      // Accepted but not yet settled: stays PROCESSING until the signed
      // callback arrives at /api/payments/refund-webhook.
      await tx.refund.update({
        where: { id: claimed.id },
        data: {
          providerRefundId: outcome.gatewayRefundId,
          gatewayStatus: outcome.gatewayStatus,
        },
      })
      await writeAudit(tx, {
        refundId: claimed.id,
        action: 'GATEWAY_SUBMITTED',
        actor: args.actor,
        fromStatus: 'PROCESSING',
        toStatus: 'PROCESSING',
        amountMinor: fromDbMinor(claimed.amountMinor),
        note: outcome.message,
        metadata: { providerRefundId: outcome.gatewayRefundId },
      })
      const refund = await tx.refund.findUniqueOrThrow({
        where: { id: claimed.id },
        include: REFUND_DETAIL_INCLUDE,
      })
      return { refund, outcome: 'AWAITING_GATEWAY' as const, message: outcome.message }
    }

    // Failed. The tickets stay claimed: the refund is retryable, and releasing
    // them here would let a second refund be filed for money that may yet move.
    const lost = await tx.refund.updateMany({
      where: { id: claimed.id, status: 'PROCESSING' },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        gatewayStatus: outcome.gatewayStatus,
        failureReason: outcome.message,
      },
    })
    if (lost.count === 1) {
      await writeAudit(tx, {
        refundId: claimed.id,
        action: 'GATEWAY_FAILED',
        actor: args.actor,
        fromStatus: 'PROCESSING',
        toStatus: 'FAILED',
        amountMinor: fromDbMinor(claimed.amountMinor),
        note: outcome.message,
        metadata: { retryable: outcome.retryable, gatewayStatus: outcome.gatewayStatus },
      })
    }
    const refund = await tx.refund.findUniqueOrThrow({
      where: { id: claimed.id },
      include: REFUND_DETAIL_INCLUDE,
    })
    return { refund, outcome: 'FAILED' as const, message: outcome.message }
  })
}

/**
 * Applies a gateway callback. Idempotent by design: gateways retry, and the
 * same settlement arriving twice must not move money twice.
 */
export async function settleFromWebhook(args: {
  payload: RefundWebhookPayload
  ip?: string | null
}): Promise<{ status: RefundStatus; refundNumber: string; changed: boolean }> {
  const actor: RefundActor = { ...SYSTEM_ACTOR, name: 'Payment gateway', ip: args.ip ?? null }

  return db.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({
      where: { providerRefundId: args.payload.gatewayRefundId },
      select: { id: true, status: true, amountMinor: true, refundNumber: true },
    })
    if (!refund) throw new RefundError('Unknown refund reference.', 404, 'REFUND_NOT_FOUND')

    // Logged whether or not it changes anything, so a duplicate or late
    // callback is visible in the trail rather than silently dropped.
    await writeAudit(tx, {
      refundId: refund.id,
      action: 'WEBHOOK_RECEIVED',
      actor,
      fromStatus: refund.status,
      amountMinor: fromDbMinor(refund.amountMinor),
      note: args.payload.message ?? `Gateway reported ${args.payload.status}.`,
      metadata: { payload: args.payload },
    })

    if (args.payload.status === 'SETTLED') {
      const changed = await applySettlement(tx, refund.id, actor, {
        gatewayStatus: 'SETTLED',
        message: args.payload.message ?? null,
      })
      return {
        status: (changed ? 'COMPLETED' : refund.status) as RefundStatus,
        refundNumber: refund.refundNumber,
        changed,
      }
    }

    const failed = await tx.refund.updateMany({
      where: { id: refund.id, status: 'PROCESSING' },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        gatewayStatus: 'FAILED',
        failureReason: args.payload.message ?? 'Gateway reported the refund failed.',
      },
    })
    if (failed.count === 1) {
      await writeAudit(tx, {
        refundId: refund.id,
        action: 'GATEWAY_FAILED',
        actor,
        fromStatus: 'PROCESSING',
        toStatus: 'FAILED',
        amountMinor: fromDbMinor(refund.amountMinor),
        note: args.payload.message ?? 'Gateway reported the refund failed.',
      })
    }
    return {
      status: (failed.count === 1 ? 'FAILED' : refund.status) as RefundStatus,
      refundNumber: refund.refundNumber,
      changed: failed.count === 1,
    }
  })
}

/** Parses and validates a callback body. Re-exported so the route stays thin. */
export { parseWebhookPayload }

// ---------------------------------------------------------------- queue

export type QueueSummary = {
  attempted: number
  settled: number
  awaitingGateway: number
  failed: number
  remaining: number
  errors: Array<{ refundId: string; message: string }>
}

/**
 * Drains approved refunds through the gateway, oldest first.
 *
 * Bounded rather than exhaustive so it fits inside a request on serverless
 * hosting; call it repeatedly (or from a cron) while `remaining` is above zero.
 * One refund failing does not stop the rest - a stuck refund would otherwise
 * block every refund queued behind it.
 */
export async function processRefundQueue(args: {
  actor: RefundActor
  limit?: number
  batchId?: string | null
}): Promise<QueueSummary> {
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100)
  const where: Prisma.RefundWhereInput = {
    status: 'APPROVED',
    ...(args.batchId ? { batchId: args.batchId } : {}),
  }

  const queue = await db.refund.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  })

  const summary: QueueSummary = {
    attempted: 0,
    settled: 0,
    awaitingGateway: 0,
    failed: 0,
    remaining: 0,
    errors: [],
  }

  for (const { id } of queue) {
    summary.attempted += 1
    try {
      const result = await processRefund({ refundId: id, actor: args.actor })
      if (result.outcome === 'SETTLED') summary.settled += 1
      else if (result.outcome === 'AWAITING_GATEWAY') summary.awaitingGateway += 1
      else summary.failed += 1
    } catch (err) {
      summary.failed += 1
      summary.errors.push({
        refundId: id,
        message: err instanceof RefundError ? err.message : 'Processing failed unexpectedly.',
      })
      if (!(err instanceof RefundError)) {
        console.error('processRefundQueue: refund', id, 'failed:', err instanceof Error ? err.message : err)
      }
    }
  }

  summary.remaining = await db.refund.count({ where })
  return summary
}

// ---------------------------------------------------------------- cancellation

export type CancellationSummary = {
  batchId: string
  eventId: string
  ordersConsidered: number
  refundsCreated: number
  totalAmountMinor: Minor
  skipped: Array<{ orderId: string; orderNumber: string; reason: string }>
  /** True when more paid orders remain than this call was allowed to handle. */
  hasMore: boolean
}

const CANCELLATION_BATCH_LIMIT = 200

/**
 * Cancels an event and files a full refund for every order still owed money.
 *
 * The event is cancelled first, in its own transaction, because the policy
 * resolver keys off the event being CANCELLED to grant 100% including fees.
 * Each order is then refunded in a transaction of its own: one problematic
 * order must not roll back the refunds of hundreds of other attendees, and a
 * re-run picks up where the last one stopped, because tickets already claimed
 * by a refund are skipped rather than refunded twice.
 *
 * Refunds are created APPROVED but not yet sent to the gateway. Draining them
 * is a separate, bounded step (`processRefundQueue`), so a cancellation with
 * thousands of orders cannot time out halfway through paying people.
 */
export async function cancelEventAndRefund(args: {
  eventId: string
  actor: RefundActor
  reasonNote?: string | null
  limit?: number
}): Promise<CancellationSummary> {
  const limit = Math.min(Math.max(args.limit ?? CANCELLATION_BATCH_LIMIT, 1), CANCELLATION_BATCH_LIMIT)
  const batchId = `evt_${args.eventId}`

  const event = await db.event.findUnique({
    where: { id: args.eventId },
    select: { id: true, status: true },
  })
  if (!event) throw new RefundError('Event not found.', 404, 'REFUND_EVENT_NOT_FOUND')

  // Idempotent: re-running against an already cancelled event is how a partly
  // completed batch is resumed.
  if (event.status !== 'CANCELLED') {
    await db.$transaction([
      db.event.update({ where: { id: event.id }, data: { status: 'CANCELLED' } }),
      db.ticket.updateMany({
        where: { eventId: event.id, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      }),
    ])
  }

  const orders = await db.order.findMany({
    where: { eventId: event.id, paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
    orderBy: { createdAt: 'asc' },
    take: limit + 1,
    select: { id: true, orderNumber: true },
  })
  const hasMore = orders.length > limit
  const batch = hasMore ? orders.slice(0, limit) : orders

  const summary: CancellationSummary = {
    batchId,
    eventId: event.id,
    ordersConsidered: batch.length,
    refundsCreated: 0,
    totalAmountMinor: 0,
    skipped: [],
    hasMore,
  }

  for (const order of batch) {
    try {
      const refund = await createRefund({
        orderId: order.id,
        reasonCode: 'EVENT_CANCELLED',
        reasonNote: args.reasonNote ?? 'Event cancelled.',
        initiatedBy: args.actor.role === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        actor: args.actor,
        autoApprove: true,
        batchId,
      })
      summary.refundsCreated += 1
      summary.totalAmountMinor += fromDbMinor(refund.amountMinor)
    } catch (err) {
      // Nothing left to refund on this order is the ordinary case on a re-run,
      // not an error worth failing the batch over.
      summary.skipped.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        reason: err instanceof RefundError ? err.message : 'Could not be refunded automatically.',
      })
      if (!(err instanceof RefundError)) {
        console.error(
          'cancelEventAndRefund: order',
          order.id,
          'failed:',
          err instanceof Error ? err.message : err
        )
      }
    }
  }

  return summary
}

// ---------------------------------------------------------------- serialising

/**
 * Audit actions a customer is allowed to see. Gateway internals and the
 * operator trail stay on the admin side.
 */
const CUSTOMER_VISIBLE_ACTIONS: RefundAuditAction[] = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'GATEWAY_SUBMITTED',
  'GATEWAY_SETTLED',
  'GATEWAY_FAILED',
]

const CUSTOMER_TIMELINE_COPY: Partial<Record<RefundAuditAction, string>> = {
  REQUESTED: 'Refund requested',
  APPROVED: 'Refund approved',
  REJECTED: 'Refund rejected',
  GATEWAY_SUBMITTED: 'Sent to your payment provider',
  GATEWAY_SETTLED: 'Refund completed',
  GATEWAY_FAILED: 'Refund attempt failed',
}

/**
 * The customer's view. Deliberately narrower than the admin's: it carries the
 * status, the money, the reason and a plain-language timeline, but never the
 * operator identities, the gateway payloads or the internal notes.
 */
export function serializeRefundForCustomer(refund: RefundDetail) {
  return {
    id: refund.id,
    refundNumber: refund.refundNumber,
    status: refund.status,
    type: refund.type,
    amountMinor: fromDbMinor(refund.amountMinor),
    currency: refund.currency,
    ticketFaceValueMinor: fromDbMinor(refund.ticketFaceValueMinor),
    platformFeeRefundedMinor: fromDbMinor(refund.platformFeeRefundedMinor),
    processingFeeMinor: fromDbMinor(refund.processingFeeMinor),
    reasonCode: refund.reasonCode,
    reasonLabel: REFUND_REASON_CODES[refund.reasonCode as RefundReasonCode]?.label ?? refund.reasonCode,
    rejectionReason: refund.rejectionReason,
    requestedAt: refund.requestedAt,
    approvedAt: refund.approvedAt,
    completedAt: refund.completedAt,
    failedAt: refund.failedAt,
    rejectedAt: refund.rejectedAt,
    order: { id: refund.order.id, orderNumber: refund.order.orderNumber },
    event: { id: refund.event.id, slug: refund.event.slug, title: refund.event.title },
    tickets: refund.items.map((item) => ({
      ticketId: item.ticketId,
      ticketCode: item.ticket.ticketCode,
      ticketTypeName: item.ticket.ticketType.name,
      amountMinor: fromDbMinor(item.amountMinor),
    })),
    timeline: refund.auditLogs
      .filter((log) => CUSTOMER_VISIBLE_ACTIONS.includes(log.action as RefundAuditAction))
      .map((log) => ({
        action: log.action,
        label: CUSTOMER_TIMELINE_COPY[log.action as RefundAuditAction] ?? log.action,
        at: log.createdAt,
        // Only a rejection reason is echoed back; other notes are internal.
        note: log.action === 'REJECTED' ? log.note : null,
      })),
  }
}

/**
 * The full record, for SUPER_ADMIN eyes. BigInt money columns are converted to
 * `Minor` numbers so the payload is JSON-serialisable.
 */
export function serializeRefundForAdmin(refund: RefundDetail) {
  return {
    id: refund.id,
    refundNumber: refund.refundNumber,
    status: refund.status,
    type: refund.type,
    initiatedBy: refund.initiatedBy,
    amountMinor: fromDbMinor(refund.amountMinor),
    organizerShareMinor: fromDbMinor(refund.organizerShareMinor),
    platformShareMinor: fromDbMinor(refund.platformShareMinor),
    ticketFaceValueMinor: fromDbMinor(refund.ticketFaceValueMinor),
    platformFeeRefundedMinor: fromDbMinor(refund.platformFeeRefundedMinor),
    processingFeeMinor: fromDbMinor(refund.processingFeeMinor),
    currency: refund.currency,
    reason: refund.reason,
    reasonCode: refund.reasonCode,
    reasonLabel: REFUND_REASON_CODES[refund.reasonCode as RefundReasonCode]?.label ?? refund.reasonCode,
    policyCode: refund.policyCode,
    rejectionReason: refund.rejectionReason,
    failureReason: refund.failureReason,
    provider: refund.provider,
    providerRefundId: refund.providerRefundId,
    gatewayStatus: refund.gatewayStatus,
    gatewayAttempts: refund.gatewayAttempts,
    gatewayLastAttemptAt: refund.gatewayLastAttemptAt,
    batchId: refund.batchId,
    requestedAt: refund.requestedAt,
    approvedAt: refund.approvedAt,
    processedAt: refund.processedAt,
    completedAt: refund.completedAt,
    failedAt: refund.failedAt,
    rejectedAt: refund.rejectedAt,
    createdAt: refund.createdAt,
    requestedBy: refund.requestedBy,
    approvedBy: refund.approvedBy,
    processedBy: refund.processedBy,
    order: {
      id: refund.order.id,
      orderNumber: refund.order.orderNumber,
      subtotalMinor: fromDbMinor(refund.order.subtotalMinor),
      discountMinor: fromDbMinor(refund.order.discountMinor),
      platformFeeMinor: fromDbMinor(refund.order.platformFeeMinor),
      totalMinor: fromDbMinor(refund.order.totalMinor),
      refundedMinor: fromDbMinor(refund.order.refundedMinor),
      paymentStatus: refund.order.paymentStatus,
      createdAt: refund.order.createdAt,
    },
    event: refund.event,
    customer: refund.user,
    payment: refund.payment
      ? {
          id: refund.payment.id,
          method: refund.payment.method,
          provider: refund.payment.provider,
          transactionId: refund.payment.transactionId,
          amountMinor: fromDbMinor(refund.payment.amountMinor),
        }
      : null,
    items: refund.items.map((item) => ({
      id: item.id,
      ticketId: item.ticketId,
      ticketCode: item.ticket.ticketCode,
      ticketTypeName: item.ticket.ticketType.name,
      ticketStatusAtRefund: item.ticketStatusAtRefund,
      faceValueMinor: fromDbMinor(item.faceValueMinor),
      platformFeeShareMinor: fromDbMinor(item.platformFeeShareMinor),
      processingFeeMinor: fromDbMinor(item.processingFeeMinor),
      amountMinor: fromDbMinor(item.amountMinor),
    })),
    auditTrail: refund.auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      fromStatus: log.fromStatus,
      toStatus: log.toStatus,
      actorId: log.actorId,
      actorName: log.actorName,
      actorRole: log.actorRole,
      amountMinor: log.amountMinor === null ? null : fromDbMinor(log.amountMinor),
      note: log.note,
      metadata: log.metadata,
      ip: log.ip,
      createdAt: log.createdAt,
    })),
  }
}
