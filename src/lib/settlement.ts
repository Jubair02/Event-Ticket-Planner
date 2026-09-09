import type { Prisma, PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'

/**
 * Organizer settlement rules — the one place money semantics are defined.
 *
 * ## Ledger
 * Balances are never stored. Every financial movement appends a `LedgerEntry`
 * with a signed integer `amount` (whole taka, credits positive), and each
 * balance is a SUM over those rows. Nothing can drift out of step with its own
 * history, and a disputed balance is always explainable by its entries.
 *
 * ## Maturation (pending -> available)
 * A ticket sale is money we are holding on the organizer's behalf for an event
 * that has not happened yet, so it is not withdrawable on the spot: sale
 * credits carry `availableAt = event end + PAYOUT_HOLD_DAYS`, which keeps a
 * refund window covered. Fees, payouts and adjustments have no hold.
 *
 * ## Payout reservation
 * A payout *request* is an intent, not a movement, so it writes no ledger
 * entry. Instead open requests (REQUESTED / APPROVED) reserve funds and are
 * subtracted from available. The `PAYOUT` debit is appended only when an admin
 * marks the transfer paid — the moment money actually leaves. A rejection
 * therefore needs no reversing entry.
 *
 * ## Adding automatic payouts later
 * Nothing here assumes a human. `Payout.initiatedBy` distinguishes MANUAL from
 * AUTOMATIC, and a scheduled runner would call `computeBalances` and
 * `createPayoutRequest` exactly as the organizer route does, then drive the
 * same `approvePayout` / `markPayoutPaid` transitions. Only the trigger differs.
 */

// ---------------------------------------------------------------- policy

/**
 * Days after an event ends before its sale proceeds become withdrawable.
 * Override with PAYOUT_HOLD_DAYS to match whatever the real refund policy is.
 */
export const PAYOUT_HOLD_DAYS = (() => {
  const raw = Number(process.env.PAYOUT_HOLD_DAYS)
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 7
})()

/** Smallest payout worth a manual bank transfer. */
export const MIN_PAYOUT_AMOUNT = (() => {
  const raw = Number(process.env.MIN_PAYOUT_AMOUNT)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 500
})()

export const LEDGER_TYPES = [
  'TICKET_SALE',
  'PLATFORM_FEE',
  'REFUND',
  'PAYOUT',
  'ADJUSTMENT',
] as const
export type LedgerType = (typeof LEDGER_TYPES)[number]

export const LEDGER_TYPE_LABELS: Record<LedgerType, string> = {
  TICKET_SALE: 'Ticket sale',
  PLATFORM_FEE: 'Platform fee',
  REFUND: 'Refund',
  PAYOUT: 'Payout',
  ADJUSTMENT: 'Adjustment',
}

export const PAYOUT_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED'] as const
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number]

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  REQUESTED: 'Awaiting review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
}

/** Statuses that hold funds back from `available` without a ledger entry. */
export const OPEN_PAYOUT_STATUSES: PayoutStatus[] = ['REQUESTED', 'APPROVED']

export const PAYOUT_METHOD_TYPES = ['BKASH', 'NAGAD', 'BANK'] as const
export type PayoutMethodType = (typeof PAYOUT_METHOD_TYPES)[number]

export const PAYOUT_METHOD_LABELS: Record<PayoutMethodType, string> = {
  BKASH: 'bKash',
  NAGAD: 'Nagad',
  BANK: 'Bank account',
}

/** Anything that can run a query: the client or an interactive transaction. */
export type DbClient = PrismaClient | Prisma.TransactionClient

/** Raised for rule violations the caller should surface as a 400. */
export class SettlementError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

// ---------------------------------------------------------------- money

/**
 * Money entering the ledger is rounded to whole taka once, here, so the same
 * order can never produce two different integers in two code paths.
 */
export function taka(amount: number): number {
  return Math.round(amount)
}

/** When an event's proceeds mature. */
export function maturityDate(eventEnd: Date): Date {
  const d = new Date(eventEnd)
  d.setDate(d.getDate() + PAYOUT_HOLD_DAYS)
  return d
}

// ---------------------------------------------------------------- entries

type SaleOrder = {
  id: string
  eventId: string
  subtotal: number
  totalAmount: number
  event: { organizerId: string; title: string; endDate: Date }
}

/**
 * Appends the two entries a paid order produces: the gross collected, and the
 * platform's cut taken back out.
 *
 * The fee is derived as `gross - net` rather than rounded independently, so the
 * pair always nets to exactly what the organizer is owed even when the raw
 * floats round in opposite directions.
 *
 * Idempotent: the unique index on (organizerId, type, orderId) means a replayed
 * payment callback cannot credit the same sale twice, so this is safe to call
 * from any fulfilment path.
 */
export async function recordSale(client: DbClient, order: SaleOrder): Promise<void> {
  const gross = taka(order.totalAmount)
  const net = taka(order.subtotal)
  const fee = gross - net
  const availableAt = maturityDate(order.event.endDate)

  const rows: Prisma.LedgerEntryCreateManyInput[] = [
    {
      organizerId: order.event.organizerId,
      type: 'TICKET_SALE',
      amount: gross,
      availableAt,
      description: `Ticket sales — ${order.event.title}`,
      orderId: order.id,
      eventId: order.eventId,
    },
  ]
  if (fee !== 0) {
    rows.push({
      organizerId: order.event.organizerId,
      type: 'PLATFORM_FEE',
      amount: -Math.abs(fee),
      availableAt,
      description: `Platform fee — ${order.event.title}`,
      orderId: order.id,
      eventId: order.eventId,
    })
  }

  await client.ledgerEntry.createMany({ data: rows, skipDuplicates: true })
}

/**
 * Reverses an organizer's share of an order that is being refunded to the
 * customer. Debits the organizer's net (the platform fee entry stays, matching
 * the sale it belongs to; waive it with an ADJUSTMENT if policy says so).
 *
 * Idempotent per order, so cancelling an already-cancelled event is harmless.
 */
export async function recordRefund(
  client: DbClient,
  order: { id: string; eventId: string; subtotal: number; event: { organizerId: string; title: string } },
): Promise<void> {
  const net = taka(order.subtotal)
  if (net === 0) return
  await client.ledgerEntry.createMany({
    data: [
      {
        organizerId: order.event.organizerId,
        type: 'REFUND',
        amount: -Math.abs(net),
        availableAt: null,
        description: `Refund — ${order.event.title}`,
        orderId: order.id,
        eventId: order.eventId,
      },
    ],
    skipDuplicates: true,
  })
}

// ---------------------------------------------------------------- balances

export interface Balances {
  /** Matured, not reserved by an open request. What can be requested now. */
  available: number
  /** Matured but held against open payout requests. */
  reserved: number
  /** Not yet matured — sales for events still inside their hold window. */
  pending: number
  /** Settled out via PAYOUT entries. */
  paid: number
  /** Lifetime gross collected (TICKET_SALE credits). */
  grossSales: number
  /** Lifetime platform fees, as a positive number. */
  platformFees: number
  /** Lifetime refunds, as a positive number. */
  refunds: number
  /** Lifetime manual adjustments, signed. */
  adjustments: number
  /** available + reserved + pending. Everything not yet paid out. */
  balance: number
  /** Earliest maturity date among pending entries, if any. */
  nextMaturityAt: string | null
}

function sumOf(rows: { type: string; sum: number }[], type: LedgerType): number {
  return rows.find((r) => r.type === type)?.sum ?? 0
}

/**
 * Every balance an organizer wallet shows, from one pass over their entries.
 *
 * `available` can legitimately be negative: a refund on an event whose funds
 * were already paid out leaves the organizer owing the platform. That is
 * reported truthfully rather than clamped, so an admin can see it and settle
 * with an ADJUSTMENT.
 */
export async function computeBalances(client: DbClient, organizerId: string): Promise<Balances> {
  const now = new Date()

  const [matured, unmatured, byType, openPayouts, nextMaturity] = await Promise.all([
    client.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { organizerId, OR: [{ availableAt: null }, { availableAt: { lte: now } }] },
    }),
    client.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { organizerId, availableAt: { gt: now } },
    }),
    client.ledgerEntry.groupBy({
      by: ['type'],
      _sum: { amount: true },
      where: { organizerId },
    }),
    client.payout.aggregate({
      _sum: { amount: true },
      where: { organizerId, status: { in: OPEN_PAYOUT_STATUSES } },
    }),
    client.ledgerEntry.findFirst({
      where: { organizerId, availableAt: { gt: now } },
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    }),
  ])

  const totals = byType.map((r) => ({ type: r.type, sum: r._sum.amount ?? 0 }))

  const maturedSum = matured._sum.amount ?? 0
  const pending = unmatured._sum.amount ?? 0
  const reserved = openPayouts._sum.amount ?? 0

  return {
    available: maturedSum - reserved,
    reserved,
    pending,
    paid: Math.abs(sumOf(totals, 'PAYOUT')),
    grossSales: sumOf(totals, 'TICKET_SALE'),
    platformFees: Math.abs(sumOf(totals, 'PLATFORM_FEE')),
    refunds: Math.abs(sumOf(totals, 'REFUND')),
    adjustments: sumOf(totals, 'ADJUSTMENT'),
    balance: maturedSum + pending,
    nextMaturityAt: nextMaturity?.availableAt?.toISOString() ?? null,
  }
}

// ---------------------------------------------------------------- payouts

/**
 * `PO-<year>-<6 digits>`, sequential within the year.
 *
 * Derived from the current row count rather than a DB sequence, so it is
 * generated inside the same transaction as the insert to keep the unique
 * constraint meaningful under concurrency; a collision surfaces as P2002 and
 * the caller retries.
 */
export async function nextPayoutReference(client: DbClient): Promise<string> {
  const year = new Date().getFullYear()
  const count = await client.payout.count({
    where: { reference: { startsWith: `PO-${year}-` } },
  })
  return `PO-${year}-${String(count + 1).padStart(6, '0')}`
}

/**
 * Creates a payout request after re-checking the balance inside a transaction,
 * so two concurrent requests cannot both pass an `available` check and overdraw.
 */
export async function createPayoutRequest(args: {
  organizerId: string
  methodId: string
  amount: number
  note?: string | null
  initiatedBy?: 'MANUAL' | 'AUTOMATIC'
}) {
  const amount = taka(args.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new SettlementError('Enter a payout amount greater than zero.')
  }
  if (amount < MIN_PAYOUT_AMOUNT) {
    throw new SettlementError(`The smallest payout is ৳${MIN_PAYOUT_AMOUNT}.`)
  }

  return db.$transaction(async (tx) => {
    const method = await tx.payoutMethod.findUnique({ where: { id: args.methodId } })
    if (!method || method.organizerId !== args.organizerId) {
      throw new SettlementError('Payout method not found.', 404)
    }
    if (method.archivedAt) {
      throw new SettlementError('That payout method has been removed. Pick another one.')
    }

    const balances = await computeBalances(tx, args.organizerId)
    if (amount > balances.available) {
      throw new SettlementError(
        `Only ৳${Math.max(balances.available, 0)} is available right now.`,
      )
    }

    return tx.payout.create({
      data: {
        reference: await nextPayoutReference(tx),
        organizerId: args.organizerId,
        methodId: args.methodId,
        amount,
        note: args.note?.trim() || null,
        initiatedBy: args.initiatedBy ?? 'MANUAL',
        status: 'REQUESTED',
      },
      include: { method: true },
    })
  })
}

/** Which statuses each admin transition may be applied from. */
export const PAYOUT_TRANSITIONS: Record<string, PayoutStatus[]> = {
  approve: ['REQUESTED'],
  reject: ['REQUESTED', 'APPROVED'],
  mark_paid: ['APPROVED'],
}

/**
 * Applies an admin decision.
 *
 * `mark_paid` is the only branch that touches money: it appends the PAYOUT
 * debit in the same transaction as the status change, so a payout can never be
 * marked paid without its ledger entry (or vice versa). It also re-checks the
 * balance, because refunds may have landed since approval.
 */
export async function decidePayout(args: {
  payoutId: string
  action: 'approve' | 'reject' | 'mark_paid'
  adminId: string
  note?: string | null
  transferRef?: string | null
}) {
  const allowedFrom = PAYOUT_TRANSITIONS[args.action]
  if (!allowedFrom) throw new SettlementError('Unknown payout action.')

  return db.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({
      where: { id: args.payoutId },
      include: { organizer: { select: { id: true, organizationName: true } } },
    })
    if (!payout) throw new SettlementError('Payout not found.', 404)

    if (!allowedFrom.includes(payout.status as PayoutStatus)) {
      const label = PAYOUT_STATUS_LABELS[payout.status as PayoutStatus] ?? payout.status
      throw new SettlementError(`This payout is ${label.toLowerCase()} and cannot be ${args.action.replace('_', ' ')}.`)
    }

    const note = args.note?.trim() || null

    if (args.action === 'approve') {
      return tx.payout.update({
        where: { id: payout.id },
        data: {
          status: 'APPROVED',
          reviewedById: args.adminId,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      })
    }

    if (args.action === 'reject') {
      return tx.payout.update({
        where: { id: payout.id },
        data: {
          status: 'REJECTED',
          reviewedById: args.adminId,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      })
    }

    // mark_paid
    const transferRef = args.transferRef?.trim()
    if (!transferRef) {
      throw new SettlementError('A transfer reference is required when marking a payout paid.')
    }

    // The reservation is released by this same update, so measure available
    // with this payout's own hold excluded to avoid double-counting it.
    const balances = await computeBalances(tx, payout.organizerId)
    const availableIgnoringThis = balances.available + payout.amount
    if (payout.amount > availableIgnoringThis) {
      throw new SettlementError(
        `The organizer's balance has fallen to ৳${Math.max(availableIgnoringThis, 0)} since this was approved. Reject it and ask for a new request.`,
      )
    }

    const paidAt = new Date()
    await tx.ledgerEntry.create({
      data: {
        organizerId: payout.organizerId,
        type: 'PAYOUT',
        amount: -Math.abs(payout.amount),
        availableAt: null,
        description: `Payout ${payout.reference} — ref ${transferRef}`,
        payoutId: payout.id,
        createdById: args.adminId,
      },
    })

    return tx.payout.update({
      where: { id: payout.id },
      data: {
        status: 'PAID',
        transferRef,
        paidAt,
        reviewedById: args.adminId,
        reviewedAt: payout.reviewedAt ?? paidAt,
        reviewNote: note ?? payout.reviewNote,
      },
    })
  })
}

/** Admin-authored manual correction. The only way to write an arbitrary entry. */
export async function recordAdjustment(args: {
  organizerId: string
  amount: number
  description: string
  adminId: string
}) {
  const amount = taka(args.amount)
  if (!Number.isFinite(amount) || amount === 0) {
    throw new SettlementError('An adjustment must be a non-zero amount.')
  }
  const description = args.description.trim()
  if (!description) {
    throw new SettlementError('Explain what this adjustment is for.')
  }
  return db.ledgerEntry.create({
    data: {
      organizerId: args.organizerId,
      type: 'ADJUSTMENT',
      amount,
      availableAt: null,
      description,
      createdById: args.adminId,
    },
  })
}

// ---------------------------------------------------------------- statements

export interface StatementPeriod {
  /** `YYYY-MM` */
  period: string
  grossSales: number
  platformFees: number
  refunds: number
  payouts: number
  adjustments: number
  /** Net movement across the month. */
  net: number
  entryCount: number
}

/**
 * Monthly statement summaries, newest first.
 *
 * Grouped in SQL: pulling every entry into the process to bucket by month would
 * scale with an organizer's lifetime sales rather than with the answer.
 */
export async function monthlyStatements(organizerId: string): Promise<StatementPeriod[]> {
  const rows = await db.$queryRaw<
    { period: string; type: string; total: bigint; entries: bigint }[]
  >`
    SELECT to_char("createdAt", 'YYYY-MM') AS period,
           "type",
           SUM("amount")::bigint          AS total,
           COUNT(*)::bigint               AS entries
    FROM "LedgerEntry"
    WHERE "organizerId" = ${organizerId}
    GROUP BY period, "type"
    ORDER BY period DESC
  `

  const byPeriod = new Map<string, StatementPeriod>()
  for (const row of rows) {
    let s = byPeriod.get(row.period)
    if (!s) {
      s = {
        period: row.period,
        grossSales: 0,
        platformFees: 0,
        refunds: 0,
        payouts: 0,
        adjustments: 0,
        net: 0,
        entryCount: 0,
      }
      byPeriod.set(row.period, s)
    }
    const total = Number(row.total)
    s.entryCount += Number(row.entries)
    s.net += total
    switch (row.type) {
      case 'TICKET_SALE':
        s.grossSales += total
        break
      case 'PLATFORM_FEE':
        s.platformFees += Math.abs(total)
        break
      case 'REFUND':
        s.refunds += Math.abs(total)
        break
      case 'PAYOUT':
        s.payouts += Math.abs(total)
        break
      case 'ADJUSTMENT':
        s.adjustments += total
        break
    }
  }

  return Array.from(byPeriod.values())
}

// ---------------------------------------------------------------- serialising

/** Shapes a method for the wire, dropping the full account number. */
export function safePayoutMethod(m: {
  id: string
  type: string
  accountName: string
  accountLast4: string
  bankName: string | null
  branch: string | null
  isDefault: boolean
  archivedAt: Date | null
  createdAt: Date
}) {
  return {
    id: m.id,
    type: m.type,
    typeLabel: PAYOUT_METHOD_LABELS[m.type as PayoutMethodType] ?? m.type,
    accountName: m.accountName,
    accountLast4: m.accountLast4,
    bankName: m.bankName,
    branch: m.branch,
    isDefault: m.isDefault,
    archived: m.archivedAt !== null,
    createdAt: m.createdAt.toISOString(),
  }
}

// ---------------------------------------------------------------- backfill

/**
 * Writes the ledger entries that orders paid before this system existed never
 * got, and repairs any gap left by a partial failure.
 *
 * Safe to re-run: every entry it writes is keyed by (organizerId, type,
 * orderId), so duplicates are skipped rather than doubled.
 */
export async function backfillLedger(
  client: DbClient,
): Promise<{ orders: number; refunded: number }> {
  const paid = await client.order.findMany({
    where: { paymentStatus: 'PAID' },
    select: {
      id: true,
      eventId: true,
      subtotal: true,
      totalAmount: true,
      event: { select: { organizerId: true, title: true, endDate: true } },
    },
  })
  for (const order of paid) await recordSale(client, order)

  // Orders on cancelled events that were paid then refunded need the reversal
  // too, otherwise the backfill would credit sales that were given back.
  const refunded = await client.order.findMany({
    where: { paymentStatus: 'REFUNDED' },
    select: {
      id: true,
      eventId: true,
      subtotal: true,
      totalAmount: true,
      event: { select: { organizerId: true, title: true, endDate: true } },
    },
  })
  for (const order of refunded) {
    await recordSale(client, order)
    await recordRefund(client, order)
  }

  return { orders: paid.length, refunded: refunded.length }
}
