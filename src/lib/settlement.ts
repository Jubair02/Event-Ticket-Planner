import type { Prisma, PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'
import {
  MINOR_PER_UNIT,
  addMinor,
  formatMinor,
  fromDbMinor,
  toDbMinor,
  type Minor,
} from '@/lib/money'
import {
  adjustmentLines,
  paymentCapturedLines,
  payoutPaidLines,
  postLedgerGroup,
  refundCompletedLines,
  type LedgerAccount,
  type LedgerKind,
} from '@/lib/ledger'

/**
 * Organizer settlement rules — the one place money semantics are defined.
 *
 * ## Ledger
 * Balances are never stored. Every financial movement appends to `LedgerEntry`
 * and each balance is a SUM over those rows, so nothing can drift out of step
 * with its own history and a disputed balance is always explainable by its
 * entries.
 *
 * The entries are **double-entry**: a movement writes a balanced group of
 * positive `amountMinor` rows, each with an `account` and a `direction`, rather
 * than one signed row. An organizer's wallet is therefore the net of their
 * `ORGANIZER_PAYABLE` lines, and the platform's own revenue and cash live in
 * the same table instead of being implied by what is missing from it. See
 * `src/lib/ledger.ts` for the chart of accounts, and docs/money-model.md.
 *
 * All amounts here are **paisa** (`1 BDT = 100 paisa`). There is no rounding
 * step: money arrives as an integer and stays one.
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
 * subtracted from available. The `PAYOUT_PAID` group is posted only when an
 * admin marks the transfer paid — the moment money actually leaves. A rejection
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

/**
 * Smallest payout worth a manual bank transfer, in paisa.
 *
 * The environment variable stays in whole taka, because that is how an operator
 * thinks about it; it is converted once, here.
 */
export const MIN_PAYOUT_MINOR: Minor = (() => {
  const raw = Number(process.env.MIN_PAYOUT_AMOUNT)
  const taka = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 500
  return taka * MINOR_PER_UNIT
})()

/**
 * The movement vocabulary the wallet and statements are presented in.
 *
 * These are not stored. The ledger records `kind`, `account` and `direction`;
 * `ledgerEntryType` below derives one of these labels from that triple for
 * display. Keeping the presentation vocabulary separate from the storage model
 * is what lets an organizer see "Platform fee" while the books record a credit
 * to platform revenue.
 */
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

/** When an event's proceeds mature. */
export function maturityDate(eventEnd: Date): Date {
  const d = new Date(eventEnd)
  d.setDate(d.getDate() + PAYOUT_HOLD_DAYS)
  return d
}

/**
 * The presentation label for a stored entry.
 *
 * Derived rather than stored so the two can never disagree: a group's `kind`
 * plus the account it touched already says what happened.
 */
export function ledgerEntryType(entry: {
  kind: string
  account: string
  direction: string
}): LedgerType {
  if (entry.kind === 'PAYOUT_PAID') return 'PAYOUT'
  if (entry.kind === 'ADJUSTMENT') return 'ADJUSTMENT'
  if (entry.kind === 'REFUND_COMPLETED') return 'REFUND'
  if (entry.account === 'PLATFORM_REVENUE') return 'PLATFORM_FEE'
  return 'TICKET_SALE'
}

/**
 * The `where` fragment that selects the rows a ledger listing should show.
 *
 * An organizer's statement must list their own movements only. A capture writes
 * three lines — the gateway asset, our commission and their payable — and
 * showing more than the payable line would double-count the fee against them,
 * so the default is `ORGANIZER_PAYABLE` alone. Asking for `PLATFORM_FEE`
 * switches to the revenue line, which is what an admin looking at the platform
 * side wants.
 */
export function ledgerTypeFilter(type?: LedgerType | null): {
  account?: LedgerAccount
  kind?: LedgerKind
} {
  switch (type) {
    case 'TICKET_SALE':
      return { account: 'ORGANIZER_PAYABLE', kind: 'PAYMENT_CAPTURED' }
    case 'PLATFORM_FEE':
      return { account: 'PLATFORM_REVENUE' }
    case 'REFUND':
      return { account: 'ORGANIZER_PAYABLE', kind: 'REFUND_COMPLETED' }
    case 'PAYOUT':
      return { account: 'ORGANIZER_PAYABLE', kind: 'PAYOUT_PAID' }
    case 'ADJUSTMENT':
      return { account: 'ORGANIZER_PAYABLE', kind: 'ADJUSTMENT' }
    default:
      return { account: 'ORGANIZER_PAYABLE' }
  }
}

// ---------------------------------------------------------------- entries

type SaleOrder = {
  id: string
  eventId: string
  subtotalMinor: bigint | number
  discountMinor: bigint | number
  platformFeeMinor: bigint | number
  totalMinor: bigint | number
  event: { organizerId: string; title: string; endDate: Date }
}

/**
 * Books a paid order: the customer's money lands at the gateway, our
 * commission becomes revenue, and the rest becomes payable to the organizer.
 *
 * The organizer's credit carries the maturity date, so the hold policy lives
 * here and nowhere else — the payment route just calls this.
 *
 * Idempotent by check rather than by unique index: a partial refund can produce
 * several REFUND_COMPLETED groups for one order, so there is no
 * (order, account, kind) key that would be unique for refunds as well as sales.
 * The check is enough because the only caller runs inside the fulfilment
 * transaction, which already refuses to run twice for a paid payment, and the
 * backfill is sequential.
 */
export async function recordSale(client: DbClient, order: SaleOrder): Promise<void> {
  const totalMinor = fromDbMinor(order.totalMinor)
  // A free or fully discounted order moves no money, so there is nothing to
  // book. Posting zero lines is rejected by the ledger by design.
  if (totalMinor <= 0) return

  const already = await client.ledgerEntry.count({
    where: { orderId: order.id, kind: 'PAYMENT_CAPTURED' },
  })
  if (already > 0) return

  await postLedgerGroup(client as Prisma.TransactionClient, {
    kind: 'PAYMENT_CAPTURED',
    lines: paymentCapturedLines({
      subtotalMinor: fromDbMinor(order.subtotalMinor),
      discountMinor: fromDbMinor(order.discountMinor),
      platformFeeMinor: fromDbMinor(order.platformFeeMinor),
      totalMinor,
    }),
    refs: {
      organizerId: order.event.organizerId,
      eventId: order.eventId,
      orderId: order.id,
    },
    description: `Ticket sales — ${order.event.title}`,
    availableAt: maturityDate(order.event.endDate),
  })
}

/**
 * Reverses an order that is being refunded to the customer.
 *
 * The organizer gives back their net and the platform gives back the
 * commission it charged, which is what makes the customer whole for the full
 * amount they paid. Splitting it this way rather than clawing back only the
 * organizer's share is what keeps `GATEWAY_CLEARING` reconcilable against what
 * the gateway actually returns.
 *
 * Idempotent per order for a full refund; a partial refund should post its own
 * group through `postLedgerGroup` with the amount actually returned.
 */
export async function recordRefund(
  client: DbClient,
  order: {
    id: string
    eventId: string
    subtotalMinor: bigint | number
    discountMinor: bigint | number
    platformFeeMinor: bigint | number
    totalMinor: bigint | number
    event: { organizerId: string; title: string }
  }
): Promise<void> {
  const organizerShareMinor =
    fromDbMinor(order.subtotalMinor) - fromDbMinor(order.discountMinor)
  const platformShareMinor = fromDbMinor(order.platformFeeMinor)
  const amountMinor = addMinor(organizerShareMinor, platformShareMinor)
  if (amountMinor <= 0) return

  const already = await client.ledgerEntry.count({
    where: { orderId: order.id, kind: 'REFUND_COMPLETED' },
  })
  if (already > 0) return

  await postLedgerGroup(client as Prisma.TransactionClient, {
    kind: 'REFUND_COMPLETED',
    lines: refundCompletedLines({ amountMinor, organizerShareMinor, platformShareMinor }),
    refs: {
      organizerId: order.event.organizerId,
      eventId: order.eventId,
      orderId: order.id,
    },
    description: `Refund — ${order.event.title}`,
  })
}

// ---------------------------------------------------------------- balances

export interface Balances {
  /** Matured, not reserved by an open request. What can be requested now. */
  availableMinor: Minor
  /** Matured but held against open payout requests. */
  reservedMinor: Minor
  /** Not yet matured — sales for events still inside their hold window. */
  pendingMinor: Minor
  /** Settled out via PAYOUT_PAID groups. */
  paidMinor: Minor
  /** Lifetime gross collected from customers, fee included. */
  grossSalesMinor: Minor
  /** Lifetime platform fees, as a positive number. */
  platformFeesMinor: Minor
  /** Lifetime refunds of the organizer's share, as a positive number. */
  refundsMinor: Minor
  /** Lifetime manual adjustments, signed. */
  adjustmentsMinor: Minor
  /** available + reserved + pending. Everything not yet paid out. */
  balanceMinor: Minor
  /** Earliest maturity date among pending entries, if any. */
  nextMaturityAt: string | null
}

type GroupRow = {
  kind: string
  account: string
  direction: string
  _sum: { amountMinor: bigint | null }
}

/** Net of a set of rows for a credit-normal account: credits minus debits. */
function netCredit(rows: GroupRow[], match: (r: GroupRow) => boolean): Minor {
  return rows.filter(match).reduce((sum, r) => {
    const amount = fromDbMinor(r._sum.amountMinor)
    return sum + (r.direction === 'CREDIT' ? amount : -amount)
  }, 0)
}

/** Total of rows on one side, unsigned. */
function sideTotal(
  rows: GroupRow[],
  account: LedgerAccount,
  direction: 'DEBIT' | 'CREDIT',
  kind?: LedgerKind
): Minor {
  return rows
    .filter(
      (r) => r.account === account && r.direction === direction && (!kind || r.kind === kind)
    )
    .reduce((sum, r) => sum + fromDbMinor(r._sum.amountMinor), 0)
}

/**
 * Every balance an organizer wallet shows, from one pass over their entries.
 *
 * `availableMinor` can legitimately be negative: a refund on an event whose
 * funds were already paid out leaves the organizer owing the platform. That is
 * reported truthfully rather than clamped, so an admin can see it and settle
 * with an adjustment.
 */
export async function computeBalances(
  client: DbClient,
  organizerId: string
): Promise<Balances> {
  const now = new Date()
  const payable = { organizerId, account: 'ORGANIZER_PAYABLE' as const }

  const [lifetime, maturedRows, pendingRows, openPayouts, nextMaturity] = await Promise.all([
    client.ledgerEntry.groupBy({
      by: ['kind', 'account', 'direction'],
      _sum: { amountMinor: true },
      where: { organizerId },
    }),
    client.ledgerEntry.groupBy({
      by: ['kind', 'account', 'direction'],
      _sum: { amountMinor: true },
      // Null means "already matured", which is how fees, payouts and
      // adjustments are stored, so they must be included here.
      where: { ...payable, OR: [{ availableAt: null }, { availableAt: { lte: now } }] },
    }),
    client.ledgerEntry.groupBy({
      by: ['kind', 'account', 'direction'],
      _sum: { amountMinor: true },
      where: { ...payable, availableAt: { gt: now } },
    }),
    client.payout.aggregate({
      _sum: { amountMinor: true },
      where: { organizerId, status: { in: OPEN_PAYOUT_STATUSES } },
    }),
    client.ledgerEntry.findFirst({
      where: { ...payable, availableAt: { gt: now } },
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    }),
  ])

  const all = lifetime as GroupRow[]
  const maturedMinor = netCredit(maturedRows as GroupRow[], () => true)
  const pendingMinor = netCredit(pendingRows as GroupRow[], () => true)
  const reservedMinor = fromDbMinor(openPayouts._sum.amountMinor)

  return {
    availableMinor: maturedMinor - reservedMinor,
    reservedMinor,
    pendingMinor,
    paidMinor: sideTotal(all, 'ORGANIZER_PAYABLE', 'DEBIT', 'PAYOUT_PAID'),
    // What customers actually paid, which is the gateway side of a capture.
    grossSalesMinor: sideTotal(all, 'GATEWAY_CLEARING', 'DEBIT', 'PAYMENT_CAPTURED'),
    platformFeesMinor: netCredit(all, (r) => r.account === 'PLATFORM_REVENUE'),
    refundsMinor: sideTotal(all, 'ORGANIZER_PAYABLE', 'DEBIT', 'REFUND_COMPLETED'),
    adjustmentsMinor: netCredit(
      all,
      (r) => r.account === 'ORGANIZER_PAYABLE' && r.kind === 'ADJUSTMENT'
    ),
    balanceMinor: maturedMinor + pendingMinor,
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
    where: { payoutNumber: { startsWith: `PO-${year}-` } },
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
  amountMinor: Minor
  note?: string | null
  initiatedBy?: 'MANUAL' | 'AUTOMATIC'
}) {
  const amountMinor = args.amountMinor
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new SettlementError('Enter a payout amount greater than zero.')
  }
  if (amountMinor < MIN_PAYOUT_MINOR) {
    throw new SettlementError(`The smallest payout is ${formatMinor(MIN_PAYOUT_MINOR)}.`)
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
    if (amountMinor > balances.availableMinor) {
      throw new SettlementError(
        `Only ${formatMinor(Math.max(balances.availableMinor, 0))} is available right now.`
      )
    }

    return tx.payout.create({
      data: {
        payoutNumber: await nextPayoutReference(tx),
        organizerId: args.organizerId,
        payoutMethodId: args.methodId,
        amountMinor: toDbMinor(amountMinor),
        note: args.note?.trim() || null,
        initiatedBy: args.initiatedBy ?? 'MANUAL',
        status: 'REQUESTED',
      },
      include: { payoutMethod: true },
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
 * `mark_paid` is the only branch that touches money: it posts the PAYOUT_PAID
 * group in the same transaction as the status change, so a payout can never be
 * marked paid without its ledger entries (or vice versa). It also re-checks the
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
      throw new SettlementError(
        `This payout is ${label.toLowerCase()} and cannot be ${args.action.replace('_', ' ')}.`
      )
    }

    const note = args.note?.trim() || null

    if (args.action === 'approve' || args.action === 'reject') {
      return tx.payout.update({
        where: { id: payout.id },
        data: {
          status: args.action === 'approve' ? 'APPROVED' : 'REJECTED',
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

    const amountMinor = fromDbMinor(payout.amountMinor)

    // The reservation is released by this same update, so measure available
    // with this payout's own hold excluded to avoid double-counting it.
    const balances = await computeBalances(tx, payout.organizerId)
    const availableIgnoringThis = balances.availableMinor + amountMinor
    if (amountMinor > availableIgnoringThis) {
      throw new SettlementError(
        `The organizer's balance has fallen to ${formatMinor(
          Math.max(availableIgnoringThis, 0)
        )} since this was approved. Reject it and ask for a new request.`
      )
    }

    const paidAt = new Date()
    await postLedgerGroup(tx, {
      kind: 'PAYOUT_PAID',
      lines: payoutPaidLines({ amountMinor }),
      refs: { organizerId: payout.organizerId, payoutId: payout.id },
      description: `Payout ${payout.payoutNumber} — ref ${transferRef}`,
      createdById: args.adminId,
      occurredAt: paidAt,
    })

    return tx.payout.update({
      where: { id: payout.id },
      data: {
        status: 'PAID',
        reference: transferRef,
        paidAt,
        reviewedById: args.adminId,
        reviewedAt: payout.reviewedAt ?? paidAt,
        reviewNote: note ?? payout.reviewNote,
      },
    })
  })
}

/**
 * Admin-authored manual correction. The only way to write an arbitrary entry.
 *
 * The organizer's payable moves and the balancing side lands in `ADJUSTMENTS`,
 * so a correction is never mistaken for a sale, a fee or a refund.
 */
export async function recordAdjustment(args: {
  organizerId: string
  amountMinor: Minor
  description: string
  adminId: string
}) {
  const amountMinor = args.amountMinor
  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0) {
    throw new SettlementError('An adjustment must be a non-zero amount.')
  }
  const description = args.description.trim()
  if (!description) {
    throw new SettlementError('Explain what this adjustment is for.')
  }

  return db.$transaction(async (tx) => {
    const { groupId } = await postLedgerGroup(tx, {
      kind: 'ADJUSTMENT',
      lines: adjustmentLines({
        account: 'ORGANIZER_PAYABLE',
        // A positive adjustment credits the organizer, which is what "we owe
        // you more" means for a liability account.
        direction: amountMinor > 0 ? 'CREDIT' : 'DEBIT',
        amountMinor: Math.abs(amountMinor),
        reason: description,
      }),
      refs: { organizerId: args.organizerId },
      description,
      createdById: args.adminId,
    })

    // The caller shows the organizer what changed, so hand back their side of
    // the group rather than the ADJUSTMENTS counter-line.
    return tx.ledgerEntry.findFirstOrThrow({
      where: { groupId, account: 'ORGANIZER_PAYABLE' },
    })
  })
}

// ---------------------------------------------------------------- statements

export interface StatementPeriod {
  /** `YYYY-MM` */
  period: string
  grossSalesMinor: Minor
  platformFeesMinor: Minor
  refundsMinor: Minor
  payoutsMinor: Minor
  adjustmentsMinor: Minor
  /** Net movement in the organizer's payable across the month. */
  netMinor: Minor
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
    {
      period: string
      kind: string
      account: string
      direction: string
      total: bigint
      entries: bigint
    }[]
  >`
    SELECT to_char("occurredAt", 'YYYY-MM') AS period,
           "kind",
           "account",
           "direction",
           SUM("amountMinor")::bigint AS total,
           COUNT(*)::bigint           AS entries
    FROM "LedgerEntry"
    WHERE "organizerId" = ${organizerId}
    GROUP BY period, "kind", "account", "direction"
    ORDER BY period DESC
  `

  const byPeriod = new Map<string, StatementPeriod>()
  for (const row of rows) {
    let s = byPeriod.get(row.period)
    if (!s) {
      s = {
        period: row.period,
        grossSalesMinor: 0,
        platformFeesMinor: 0,
        refundsMinor: 0,
        payoutsMinor: 0,
        adjustmentsMinor: 0,
        netMinor: 0,
        entryCount: 0,
      }
      byPeriod.set(row.period, s)
    }
    const total = Number(row.total)
    s.entryCount += Number(row.entries)

    // Only the organizer's own payable moves the net; the gateway and revenue
    // sides of the same group belong to the platform's books, not theirs.
    if (row.account === 'ORGANIZER_PAYABLE') {
      s.netMinor += row.direction === 'CREDIT' ? total : -total
      if (row.kind === 'REFUND_COMPLETED' && row.direction === 'DEBIT') s.refundsMinor += total
      if (row.kind === 'PAYOUT_PAID' && row.direction === 'DEBIT') s.payoutsMinor += total
      if (row.kind === 'ADJUSTMENT') {
        s.adjustmentsMinor += row.direction === 'CREDIT' ? total : -total
      }
    }
    if (row.account === 'GATEWAY_CLEARING' && row.kind === 'PAYMENT_CAPTURED' && row.direction === 'DEBIT') {
      s.grossSalesMinor += total
    }
    if (row.account === 'PLATFORM_REVENUE') {
      s.platformFeesMinor += row.direction === 'CREDIT' ? total : -total
    }
  }

  return Array.from(byPeriod.values())
}

// ---------------------------------------------------------------- serialising

/** Shapes a method for the wire, dropping anything that identifies the account. */
export function safePayoutMethod(m: {
  id: string
  type: string
  accountName: string
  accountLast4: string
  bankName: string | null
  branchName: string | null
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
    branch: m.branchName,
    isDefault: m.isDefault,
    archived: m.archivedAt !== null,
    createdAt: m.createdAt.toISOString(),
  }
}

// ---------------------------------------------------------------- backfill

const ORDER_MONEY_SELECT = {
  id: true,
  eventId: true,
  subtotalMinor: true,
  discountMinor: true,
  platformFeeMinor: true,
  totalMinor: true,
  event: { select: { organizerId: true, title: true, endDate: true } },
} as const

/**
 * Writes the ledger entries that orders paid before this system existed never
 * got, and repairs any gap left by a partial failure.
 *
 * Safe to re-run: `recordSale` and `recordRefund` both check for an existing
 * group for the order first, so a second run adds nothing.
 */
export async function backfillLedger(
  client: DbClient
): Promise<{ orders: number; refunded: number }> {
  const paid = await client.order.findMany({
    where: { paymentStatus: 'PAID' },
    select: ORDER_MONEY_SELECT,
  })
  for (const order of paid) await recordSale(client, order)

  // Orders on cancelled events that were paid then refunded need the reversal
  // too, otherwise the backfill would credit sales that were given back.
  const refunded = await client.order.findMany({
    where: { paymentStatus: 'REFUNDED' },
    select: ORDER_MONEY_SELECT,
  })
  for (const order of refunded) {
    await recordSale(client, order)
    await recordRefund(client, order)
  }

  return { orders: paid.length, refunded: refunded.length }
}
