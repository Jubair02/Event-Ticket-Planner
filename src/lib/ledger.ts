import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import {
  CURRENCY,
  addMinor,
  assertMinor,
  toDbMinor,
  type Minor,
} from '@/lib/money'

/**
 * Double-entry ledger.
 *
 * Order rows, Payment rows and `soldQuantity` counters answer "what happened to
 * this order". They cannot answer "how much do we owe organizers right now",
 * "how much of that is still sitting at the gateway", or "does the money we
 * think we hold match the money we say we owe" — those need a ledger, and
 * deriving them by re-aggregating orders means every fee-rate or refund-policy
 * change silently rewrites history.
 *
 * So every financial event posts a balanced **group** of entries here. Debits
 * equal credits within a group, always, which makes any account balance a `SUM`
 * over one table and any inconsistency a query rather than an investigation.
 *
 * Entries are append-only. Nothing in this module updates or deletes one; a
 * mistake is corrected by posting a reversing group, the way books work.
 */

/**
 * Chart of accounts, each with the side that increases it.
 *
 * - `GATEWAY_CLEARING` — captured from customers, not yet paid out to us by the
 *   gateway. Rises on capture, falls when the gateway settles.
 * - `CASH` — our own bank balance.
 * - `PLATFORM_REVENUE` — the commission we have earned.
 * - `ORGANIZER_PAYABLE` — what we owe organizers. The number a payout run pays.
 * - `GATEWAY_FEES` — what the payment provider keeps.
 * - `ADJUSTMENTS` — manual corrections, so they never hide inside a real
 *   account and can always be listed for review.
 */
export const LEDGER_ACCOUNTS = {
  GATEWAY_CLEARING: 'DEBIT',
  CASH: 'DEBIT',
  GATEWAY_FEES: 'DEBIT',
  PLATFORM_REVENUE: 'CREDIT',
  ORGANIZER_PAYABLE: 'CREDIT',
  ADJUSTMENTS: 'CREDIT',
} as const

export type LedgerAccount = keyof typeof LEDGER_ACCOUNTS
export type LedgerDirection = 'DEBIT' | 'CREDIT'

/** Business events that can post a group. */
export const LEDGER_KINDS = [
  'PAYMENT_CAPTURED',
  'REFUND_COMPLETED',
  'PAYOUT_PAID',
  'GATEWAY_SETTLED',
  'ADJUSTMENT',
] as const
export type LedgerKind = (typeof LEDGER_KINDS)[number]

/** One side of a posting. `amountMinor` is always positive. */
export interface LedgerLine {
  account: LedgerAccount
  direction: LedgerDirection
  amountMinor: Minor
  description?: string
}

/** Ids the group hangs off, for later reconciliation and drill-down. */
export interface LedgerRefs {
  organizerId?: string | null
  eventId?: string | null
  orderId?: string | null
  paymentId?: string | null
  refundId?: string | null
  payoutId?: string | null
  settlementId?: string | null
}

export interface PostGroupInput {
  kind: LedgerKind
  lines: LedgerLine[]
  refs?: LedgerRefs
  /** When the money moved. Defaults to now. */
  occurredAt?: Date
  description?: string
  /**
   * When an organizer-payable credit becomes withdrawable. Applied only to the
   * `ORGANIZER_PAYABLE` line: the platform's own revenue and the cash at the
   * gateway are not held back, so dating them would misreport both.
   */
  availableAt?: Date | null
  /** The admin behind a manual posting. Null for anything the system posts. */
  createdById?: string | null
}

/** Raised when a posting would not balance, so it is never written. */
export class LedgerImbalanceError extends Error {
  constructor(debitMinor: Minor, creditMinor: Minor) {
    super(
      `Ledger group does not balance: debits ${debitMinor} paisa vs credits ${creditMinor} paisa`
    )
    this.name = 'LedgerImbalanceError'
  }
}

/**
 * Checks a set of lines and returns the totals. Exported so a caller can
 * validate a posting it has built without touching the database — the unit
 * tests use this, and so does anything assembling lines dynamically.
 */
export function validateLines(lines: LedgerLine[]): { debitMinor: Minor; creditMinor: Minor } {
  if (lines.length < 2) {
    throw new Error('A ledger group needs at least two lines; one side cannot balance')
  }

  let debitMinor = 0
  let creditMinor = 0
  for (const line of lines) {
    if (!(line.account in LEDGER_ACCOUNTS)) {
      throw new Error(`Unknown ledger account: ${String(line.account)}`)
    }
    if (line.direction !== 'DEBIT' && line.direction !== 'CREDIT') {
      throw new Error(`Unknown ledger direction: ${String(line.direction)}`)
    }
    assertMinor(line.amountMinor, `${line.account} amount`)
    // Zero lines are noise and negative ones mean the caller tried to encode
    // direction in the sign, which would break every balance query.
    if (line.amountMinor <= 0) {
      throw new Error(
        `Ledger amounts must be positive; use direction to express the sign (${line.account} got ${line.amountMinor})`
      )
    }
    if (line.direction === 'DEBIT') debitMinor = addMinor(debitMinor, line.amountMinor)
    else creditMinor = addMinor(creditMinor, line.amountMinor)
  }

  if (debitMinor !== creditMinor) throw new LedgerImbalanceError(debitMinor, creditMinor)
  return { debitMinor, creditMinor }
}

/**
 * Writes one balanced group.
 *
 * Takes a transaction client rather than the global one on purpose: a posting
 * must commit or roll back with the business change that caused it, or the
 * books end up describing money that never moved.
 */
export async function postLedgerGroup(
  tx: Prisma.TransactionClient,
  {
    kind,
    lines,
    refs = {},
    occurredAt,
    description,
    availableAt,
    createdById,
  }: PostGroupInput
): Promise<{ groupId: string; debitMinor: Minor }> {
  if (!LEDGER_KINDS.includes(kind)) throw new Error(`Unknown ledger kind: ${String(kind)}`)
  const { debitMinor } = validateLines(lines)

  const groupId = randomUUID()
  const when = occurredAt ?? new Date()

  await tx.ledgerEntry.createMany({
    data: lines.map((line) => ({
      groupId,
      kind,
      account: line.account,
      direction: line.direction,
      amountMinor: toDbMinor(line.amountMinor),
      currency: CURRENCY,
      description: line.description ?? description ?? null,
      availableAt: line.account === 'ORGANIZER_PAYABLE' ? (availableAt ?? null) : null,
      createdById: createdById ?? null,
      organizerId: refs.organizerId ?? null,
      eventId: refs.eventId ?? null,
      orderId: refs.orderId ?? null,
      paymentId: refs.paymentId ?? null,
      refundId: refs.refundId ?? null,
      payoutId: refs.payoutId ?? null,
      settlementId: refs.settlementId ?? null,
      occurredAt: when,
    })),
  })

  return { groupId, debitMinor }
}

// ---------------------------------------------------------------------------
// Line builders — one per business event.
//
// Kept as pure functions so the arithmetic can be tested without a database,
// and so the shape of each posting is readable in one place instead of being
// spread through route handlers.
// ---------------------------------------------------------------------------

/**
 * A customer's payment lands at the gateway.
 *
 * The customer paid `total`. Of that, the commission is ours and the rest is
 * owed to the organizer:
 *
 *   DEBIT  GATEWAY_CLEARING   total          (an asset we now hold)
 *   CREDIT PLATFORM_REVENUE   fee            (income earned)
 *   CREDIT ORGANIZER_PAYABLE  subtotal - discount
 *
 * Balances because `total = subtotal - discount + fee`, the same identity the
 * `Order` table enforces.
 */
export function paymentCapturedLines(order: {
  subtotalMinor: Minor
  discountMinor: Minor
  platformFeeMinor: Minor
  totalMinor: Minor
}): LedgerLine[] {
  const netTickets = assertMinor(order.subtotalMinor) - assertMinor(order.discountMinor)
  if (netTickets < 0) throw new Error('Discount exceeds subtotal; order totals are invalid')

  const expectedTotal = addMinor(netTickets, order.platformFeeMinor)
  if (expectedTotal !== assertMinor(order.totalMinor)) {
    throw new Error(
      `Order total ${order.totalMinor} does not equal subtotal - discount + fee (${expectedTotal})`
    )
  }

  const lines: LedgerLine[] = [
    { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amountMinor: order.totalMinor },
  ]
  // A free or fully discounted order books no revenue and no payable, and a
  // zero line is rejected — so only add the sides that actually carry money.
  if (order.platformFeeMinor > 0) {
    lines.push({
      account: 'PLATFORM_REVENUE',
      direction: 'CREDIT',
      amountMinor: order.platformFeeMinor,
    })
  }
  if (netTickets > 0) {
    lines.push({ account: 'ORGANIZER_PAYABLE', direction: 'CREDIT', amountMinor: netTickets })
  }
  return lines
}

/**
 * A refund reaches the customer.
 *
 *   DEBIT  ORGANIZER_PAYABLE  organizerShare   (we owe the organizer less)
 *   DEBIT  PLATFORM_REVENUE   platformShare    (we give up commission)
 *   CREDIT GATEWAY_CLEARING   amount           (the money leaves)
 *
 * The split is stored on the `Refund` row rather than derived, because a
 * goodwill refund can be entirely platform-funded and a fee-rate change must
 * not retroactively alter an old refund's split.
 */
export function refundCompletedLines(refund: {
  amountMinor: Minor
  organizerShareMinor: Minor
  platformShareMinor: Minor
}): LedgerLine[] {
  assertMinor(refund.amountMinor, 'refund amount')
  assertMinor(refund.organizerShareMinor, 'organizer share')
  assertMinor(refund.platformShareMinor, 'platform share')
  if (refund.amountMinor <= 0) throw new Error('A refund must be for a positive amount')
  if (refund.organizerShareMinor < 0 || refund.platformShareMinor < 0) {
    throw new Error('Refund shares cannot be negative')
  }
  if (addMinor(refund.organizerShareMinor, refund.platformShareMinor) !== refund.amountMinor) {
    throw new Error('Refund shares must add up to the refund amount')
  }

  const lines: LedgerLine[] = []
  if (refund.organizerShareMinor > 0) {
    lines.push({
      account: 'ORGANIZER_PAYABLE',
      direction: 'DEBIT',
      amountMinor: refund.organizerShareMinor,
    })
  }
  if (refund.platformShareMinor > 0) {
    lines.push({
      account: 'PLATFORM_REVENUE',
      direction: 'DEBIT',
      amountMinor: refund.platformShareMinor,
    })
  }
  lines.push({ account: 'GATEWAY_CLEARING', direction: 'CREDIT', amountMinor: refund.amountMinor })
  return lines
}

/**
 * The gateway pays us out: cash arrives, the provider keeps its fee, and the
 * clearing account drops by the gross.
 *
 *   DEBIT  CASH              net
 *   DEBIT  GATEWAY_FEES      fee
 *   CREDIT GATEWAY_CLEARING  net + fee
 */
export function gatewaySettledLines(input: {
  netCashMinor: Minor
  gatewayFeeMinor: Minor
}): LedgerLine[] {
  assertMinor(input.netCashMinor, 'net cash')
  assertMinor(input.gatewayFeeMinor, 'gateway fee')
  if (input.netCashMinor <= 0) throw new Error('A gateway settlement must bring in positive cash')
  if (input.gatewayFeeMinor < 0) throw new Error('Gateway fee cannot be negative')

  const lines: LedgerLine[] = [
    { account: 'CASH', direction: 'DEBIT', amountMinor: input.netCashMinor },
  ]
  if (input.gatewayFeeMinor > 0) {
    lines.push({ account: 'GATEWAY_FEES', direction: 'DEBIT', amountMinor: input.gatewayFeeMinor })
  }
  lines.push({
    account: 'GATEWAY_CLEARING',
    direction: 'CREDIT',
    amountMinor: addMinor(input.netCashMinor, input.gatewayFeeMinor),
  })
  return lines
}

/**
 * A payout settles what we owe an organizer.
 *
 *   DEBIT  ORGANIZER_PAYABLE  amount   (the debt is discharged)
 *   CREDIT CASH               amount   (our bank balance drops)
 */
export function payoutPaidLines(input: { amountMinor: Minor }): LedgerLine[] {
  assertMinor(input.amountMinor, 'payout amount')
  if (input.amountMinor <= 0) throw new Error('A payout must be for a positive amount')
  return [
    { account: 'ORGANIZER_PAYABLE', direction: 'DEBIT', amountMinor: input.amountMinor },
    { account: 'CASH', direction: 'CREDIT', amountMinor: input.amountMinor },
  ]
}

/**
 * A manual correction. `account` is the real account being corrected; the
 * balancing side always lands in `ADJUSTMENTS`, so every correction stays
 * listable and nothing can be quietly moved between real accounts.
 */
export function adjustmentLines(input: {
  account: Exclude<LedgerAccount, 'ADJUSTMENTS'>
  direction: LedgerDirection
  amountMinor: Minor
  reason: string
}): LedgerLine[] {
  assertMinor(input.amountMinor, 'adjustment amount')
  if (input.amountMinor <= 0) throw new Error('An adjustment must be for a positive amount')
  if (!input.reason.trim()) throw new Error('An adjustment needs a reason')
  const opposite: LedgerDirection = input.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT'
  return [
    {
      account: input.account,
      direction: input.direction,
      amountMinor: input.amountMinor,
      description: input.reason,
    },
    {
      account: 'ADJUSTMENTS',
      direction: opposite,
      amountMinor: input.amountMinor,
      description: input.reason,
    },
  ]
}

// ---------------------------------------------------------------------------
// Reading the books
// ---------------------------------------------------------------------------

/** Where a balance can be scoped to. */
export interface BalanceScope {
  organizerId?: string
  eventId?: string
  /** Inclusive lower bound on `occurredAt`. */
  from?: Date
  /** Exclusive upper bound on `occurredAt`. */
  until?: Date
}

/**
 * Balance of one account, in paisa, signed so that a positive number means
 * "more of what this account is for": a positive `ORGANIZER_PAYABLE` is money
 * owed, a positive `CASH` is money held.
 */
export async function accountBalanceMinor(
  client: Prisma.TransactionClient,
  account: LedgerAccount,
  scope: BalanceScope = {}
): Promise<Minor> {
  const where = {
    account,
    ...(scope.organizerId ? { organizerId: scope.organizerId } : {}),
    ...(scope.eventId ? { eventId: scope.eventId } : {}),
    ...(scope.from || scope.until
      ? {
          occurredAt: {
            ...(scope.from ? { gte: scope.from } : {}),
            ...(scope.until ? { lt: scope.until } : {}),
          },
        }
      : {}),
  }

  const [debits, credits] = await Promise.all([
    client.ledgerEntry.aggregate({ _sum: { amountMinor: true }, where: { ...where, direction: 'DEBIT' } }),
    client.ledgerEntry.aggregate({ _sum: { amountMinor: true }, where: { ...where, direction: 'CREDIT' } }),
  ])

  // `?? 0` rather than `?? 0n`: this file has to compile under the project's
  // pre-ES2020 target, where a BigInt literal is a syntax error. Number()
  // accepts either type.
  const debitMinor = Number(debits._sum.amountMinor ?? 0)
  const creditMinor = Number(credits._sum.amountMinor ?? 0)
  const signed = LEDGER_ACCOUNTS[account] === 'DEBIT' ? debitMinor - creditMinor : creditMinor - debitMinor
  return assertMinor(signed, `${account} balance`)
}

/**
 * Every group whose debits do not equal its credits.
 *
 * Should always be empty: `postLedgerGroup` refuses to write an unbalanced
 * group and a CHECK constraint blocks a stray raw insert. Worth running anyway
 * — as a test assertion and as an operational check — because a ledger nobody
 * verifies is a ledger nobody can trust.
 */
export async function findUnbalancedGroups(
  client: Prisma.TransactionClient
): Promise<Array<{ groupId: string; differenceMinor: Minor }>> {
  const rows = await client.$queryRaw<Array<{ groupId: string; difference: bigint }>>`
    SELECT "groupId",
           SUM(CASE WHEN "direction" = 'DEBIT' THEN "amountMinor" ELSE -"amountMinor" END) AS difference
      FROM "LedgerEntry"
     GROUP BY "groupId"
    HAVING SUM(CASE WHEN "direction" = 'DEBIT' THEN "amountMinor" ELSE -"amountMinor" END) <> 0
  `
  return rows.map((r) => ({ groupId: r.groupId, differenceMinor: Number(r.difference) }))
}
