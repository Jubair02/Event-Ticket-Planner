/**
 * Refund domain rules: statuses, the state machine, the policy table and all of
 * the arithmetic. Deliberately free of any Prisma or Next import so it can be
 * reasoned about (and unit tested) on its own; every database side effect lives
 * in src/lib/refund-service.ts.
 *
 * The one rule that shapes this whole module: **the client never supplies an
 * amount.** A request names an order and, for a partial refund, a subset of
 * ticket ids. Everything monetary is derived here from the stored order, the
 * stored ticket prices and the policy below. A partial refund is expressible
 * only as "these tickets", never as "this many taka", which is what makes the
 * calculation server-controlled rather than merely server-validated.
 *
 * All money is `Minor` (an integer count of paisa) throughout - see
 * src/lib/money.ts. Nothing here ever touches a Float.
 */

import { addMinor, assertMinor, rateOfMinor, type Minor } from '@/lib/money'

// ---------------------------------------------------------------- statuses

/**
 * The stored terminal success state is COMPLETED, matching the
 * `Refund_status_valid` CHECK constraint in prisma/sql/002-financial-constraints.sql
 * and the RefundStatus union in src/lib/types.ts.
 */
export const REFUND_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REJECTED',
] as const
export type RefundStatus = (typeof REFUND_STATUSES)[number]

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  PROCESSING: 'Processing',
  COMPLETED: 'Refunded',
  FAILED: 'Failed',
  REJECTED: 'Rejected',
}

/**
 * Allowed moves. FAILED is not terminal: a gateway failure is retried on the
 * same refund row - so the idempotency key is reused and the customer cannot be
 * paid twice - or abandoned into REJECTED, which releases its tickets.
 */
export const REFUND_TRANSITIONS: Record<RefundStatus, readonly RefundStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING', 'REJECTED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  FAILED: ['PROCESSING', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
}

/** Statuses no further transition can leave. */
export const TERMINAL_REFUND_STATUSES: readonly RefundStatus[] = ['COMPLETED', 'REJECTED']

/**
 * Statuses that still hold a claim on their tickets. A ticket in one of these
 * cannot be pulled into a second refund; REJECTED releases it for a retry.
 */
export const TICKET_HOLDING_STATUSES: readonly RefundStatus[] = [
  'REQUESTED',
  'APPROVED',
  'PROCESSING',
  'FAILED',
  'COMPLETED',
]

export const REFUND_TYPES = ['FULL', 'PARTIAL', 'EVENT_CANCELLATION'] as const
export type RefundType = (typeof REFUND_TYPES)[number]

export const REFUND_TYPE_LABELS: Record<RefundType, string> = {
  FULL: 'Full refund',
  PARTIAL: 'Partial refund',
  EVENT_CANCELLATION: 'Event cancellation',
}

export const REFUND_INITIATORS = ['CUSTOMER', 'ADMIN', 'SYSTEM'] as const
export type RefundInitiator = (typeof REFUND_INITIATORS)[number]

// ---------------------------------------------------------------- reasons

/**
 * `customerSelectable` is the security-relevant column: a customer may only
 * ever file CUSTOMER_REQUEST. Were they free to pick EVENT_CANCELLED they would
 * be choosing the 100% policy for themselves.
 */
export const REFUND_REASON_CODES = {
  CUSTOMER_REQUEST: { label: 'Customer request', customerSelectable: true },
  EVENT_CANCELLED: { label: 'Event cancelled', customerSelectable: false },
  EVENT_RESCHEDULED: { label: 'Event rescheduled', customerSelectable: false },
  DUPLICATE_ORDER: { label: 'Duplicate order', customerSelectable: false },
  PAYMENT_ERROR: { label: 'Payment or gateway error', customerSelectable: false },
  FRAUD: { label: 'Fraud or disputed payment', customerSelectable: false },
  GOODWILL: { label: 'Goodwill gesture', customerSelectable: false },
} as const

export type RefundReasonCode = keyof typeof REFUND_REASON_CODES

export function isRefundReasonCode(value: unknown): value is RefundReasonCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REFUND_REASON_CODES, value)
}

/** Reason codes a customer is allowed to file under. */
export function customerSelectableReasonCodes(): RefundReasonCode[] {
  return (Object.keys(REFUND_REASON_CODES) as RefundReasonCode[]).filter(
    (code) => REFUND_REASON_CODES[code].customerSelectable
  )
}

// ---------------------------------------------------------------- errors

/** Rule violation the caller should surface with `status` (400/403/404/409). */
export class RefundError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'REFUND_RULE') {
    super(message)
    this.name = 'RefundError'
    this.status = status
    this.code = code
  }
}

export function assertTransition(from: RefundStatus, to: RefundStatus): void {
  if (!REFUND_TRANSITIONS[from]?.includes(to)) {
    throw new RefundError(
      `A refund that is ${REFUND_STATUS_LABELS[from]?.toLowerCase() ?? from} cannot become ${
        REFUND_STATUS_LABELS[to]?.toLowerCase() ?? to
      }`,
      409,
      'REFUND_BAD_TRANSITION'
    )
  }
}

export function canTransition(from: RefundStatus, to: RefundStatus): boolean {
  return REFUND_TRANSITIONS[from]?.includes(to) ?? false
}

export function isRefundStatus(value: unknown): value is RefundStatus {
  return typeof value === 'string' && (REFUND_STATUSES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------- allocation

/**
 * Splits `total` paisa across `weights` so the parts sum to exactly `total`.
 *
 * Largest-remainder: the paisa left over by flooring go to the lines with the
 * biggest fractional claim rather than vanishing. This is why a refund's item
 * rows always add up to its total, and why the organizer/platform split always
 * satisfies the `Refund_shares_add_up` CHECK constraint.
 */
export function allocateProportional(total: Minor, weights: number[]): Minor[] {
  assertMinor(total, 'allocation total')
  if (weights.length === 0) return []
  const sum = weights.reduce((a, b) => a + b, 0)

  if (sum <= 0) {
    // No meaningful weights (e.g. every ticket is free). Spread evenly.
    const base = Math.floor(total / weights.length)
    const out = weights.map(() => base)
    let rest = total - base * weights.length
    for (let i = 0; rest > 0; i++, rest--) out[i % out.length] += 1
    return out
  }

  const exact = weights.map((w) => (total * w) / sum)
  const out = exact.map((v) => Math.floor(v))
  const rest = total - out.reduce((a, b) => a + b, 0)
  const byRemainder = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; k < rest; k++) out[byRemainder[k % byRemainder.length].i] += 1
  return out
}

// ---------------------------------------------------------------- policy

export type RefundPolicy = {
  /** Stored on the refund so a past decision stays explainable. */
  code: string
  label: string
  /** Fraction of ticket face value returned, 0..1. */
  faceValueRate: number
  /** Whether the order's platform fee share is handed back too. */
  refundPlatformFee: boolean
  /** Fraction of the returned face value retained as a service charge. */
  processingFeeRate: number
}

/**
 * Voluntary-cancellation tiers, most generous first: cancel a week out and you
 * are whole, cancel the day before and you are not. Matched on the hours
 * between now and the event start.
 */
export const CUSTOMER_REFUND_TIERS = [
  {
    minHoursBeforeStart: 168,
    faceValueRate: 1,
    code: 'CUSTOMER_TIER_FULL',
    label: '7+ days before the event - 100% of ticket value',
  },
  {
    minHoursBeforeStart: 72,
    faceValueRate: 0.5,
    code: 'CUSTOMER_TIER_50',
    label: '3-7 days before the event - 50% of ticket value',
  },
  {
    minHoursBeforeStart: 24,
    faceValueRate: 0.25,
    code: 'CUSTOMER_TIER_25',
    label: '1-3 days before the event - 25% of ticket value',
  },
] as const

/** Inside this many hours of the start, a voluntary refund is refused outright. */
export const CUSTOMER_REFUND_CUTOFF_HOURS = 24

/**
 * Service charge retained on a voluntary cancellation, as a fraction of the
 * face value being returned. Retained against the organizer's payable, so the
 * customer receives 98% of what the policy tier grants.
 */
export const REFUND_PROCESSING_FEE_RATE = 0.02

/** The platform fee is never returned when the customer simply changed their mind. */
const VOLUNTARY_REFUNDS_PLATFORM_FEE = false

export function hoursUntil(date: Date, now: Date = new Date()): number {
  return (date.getTime() - now.getTime()) / 3_600_000
}

export type PolicyInput = {
  reasonCode: RefundReasonCode
  /** Event start, used for the voluntary tiers. */
  eventStartDate: Date
  /** Current event status - a cancelled event overrides everything below. */
  eventStatus: string
  now?: Date
}

/**
 * Decides what fraction of an order comes back. The order of precedence matters:
 *
 * 1. The event is cancelled - the customer is made whole no matter which reason
 *    code was filed or how close to the date it is. Checked first so a customer
 *    who files a plain request against a cancelled event still gets 100% rather
 *    than falling into the voluntary tiers.
 * 2. Any reason other than CUSTOMER_REQUEST is platform or organizer fault, so
 *    it is 100% including the platform fee, with nothing retained.
 * 3. CUSTOMER_REQUEST falls through the tiers; past the cutoff it is refused.
 */
export function resolveRefundPolicy(input: PolicyInput): RefundPolicy {
  const { reasonCode, eventStatus, eventStartDate } = input

  if (eventStatus === 'CANCELLED') {
    return {
      code: 'EVENT_CANCELLED_FULL',
      label: 'Event cancelled - full refund including fees',
      faceValueRate: 1,
      refundPlatformFee: true,
      processingFeeRate: 0,
    }
  }

  if (reasonCode !== 'CUSTOMER_REQUEST') {
    return {
      code: `PLATFORM_${reasonCode}`,
      label: `${REFUND_REASON_CODES[reasonCode].label} - full refund including fees`,
      faceValueRate: 1,
      refundPlatformFee: true,
      processingFeeRate: 0,
    }
  }

  const hours = hoursUntil(eventStartDate, input.now)
  const tier = CUSTOMER_REFUND_TIERS.find((t) => hours >= t.minHoursBeforeStart)
  if (!tier) {
    throw new RefundError(
      hours < 0
        ? 'This event has already started, so its tickets are no longer refundable.'
        : `Tickets are non-refundable within ${CUSTOMER_REFUND_CUTOFF_HOURS} hours of the event start.`,
      409,
      'REFUND_WINDOW_CLOSED'
    )
  }

  return {
    code: tier.code,
    label: tier.label,
    faceValueRate: tier.faceValueRate,
    refundPlatformFee: VOLUNTARY_REFUNDS_PLATFORM_FEE,
    processingFeeRate: REFUND_PROCESSING_FEE_RATE,
  }
}

// ---------------------------------------------------------------- eligibility

/**
 * Ticket statuses a refund may consume.
 *
 * - ACTIVE: the ordinary case.
 * - CANCELLED: the tickets of a cancelled event, which still owe their holder
 *   money.
 * - CHECKED_IN: the attendee already used the ticket, so this is an admin-only
 *   override; the item row records the status it was in.
 * - INVALID / REFUNDED: never.
 */
export function isTicketRefundable(
  ticket: { status: string; refundLockId?: string | null },
  initiatedBy: RefundInitiator
): boolean {
  if (ticket.refundLockId) return false
  if (ticket.status === 'ACTIVE' || ticket.status === 'CANCELLED') return true
  if (ticket.status === 'CHECKED_IN') return initiatedBy !== 'CUSTOMER'
  return false
}

/** Order-level gate: only a captured payment can be reversed. */
export function assertOrderRefundable(order: {
  paymentStatus: string
  totalMinor: Minor
  refundedMinor: Minor
}): void {
  if (order.paymentStatus === 'PAID' || order.paymentStatus === 'PARTIALLY_REFUNDED') {
    if (order.totalMinor - order.refundedMinor <= 0) {
      throw new RefundError('This order has already been refunded in full.', 409, 'REFUND_EXHAUSTED')
    }
    return
  }
  if (order.paymentStatus === 'REFUNDED') {
    throw new RefundError('This order has already been refunded in full.', 409, 'REFUND_EXHAUSTED')
  }
  throw new RefundError(
    'Only a paid order can be refunded. This order was never successfully paid.',
    409,
    'REFUND_ORDER_NOT_PAID'
  )
}

// ---------------------------------------------------------------- quote

export type QuoteTicket = {
  id: string
  /** Unit price stored on the ticket's type, in paisa - the server's number. */
  faceValueMinor: Minor
  status: string
}

export type RefundQuoteLine = {
  ticketId: string
  ticketStatusAtRefund: string
  faceValueMinor: Minor
  platformFeeShareMinor: Minor
  processingFeeMinor: Minor
  amountMinor: Minor
}

export type RefundQuote = {
  policy: RefundPolicy
  currency: string
  lines: RefundQuoteLine[]
  /** Face value actually returned, after the policy rate and any discount. */
  ticketFaceValueMinor: Minor
  platformFeeRefundedMinor: Minor
  /** Retained, not paid out. */
  processingFeeMinor: Minor
  /** What leaves the platform. Always the sum of the line amounts. */
  amountMinor: Minor
  /**
   * Funding split, as the Refund table requires:
   * `amountMinor = organizerShareMinor + platformShareMinor`, both >= 0.
   */
  organizerShareMinor: Minor
  platformShareMinor: Minor
  /** Face value of the selected tickets before any rate was applied. */
  grossTicketValueMinor: Minor
  /** How much of this order may still be refunded at all. */
  refundableRemainingMinor: Minor
}

export const REFUND_CURRENCY = 'BDT'

/**
 * Prices a refund. Every input is a stored server-side value; there is no
 * parameter through which a caller could name an amount.
 *
 * The parts are guaranteed to reconcile - line amounts sum to `amountMinor`,
 * and the two funding shares sum to it as well - because each total is split
 * across the lines with largest-remainder allocation rather than rounded line
 * by line. Both properties are CHECK constraints in the database, so a
 * disagreement here fails loudly rather than quietly unbalancing the ledger.
 */
export function quoteRefund(args: {
  order: {
    subtotalMinor: Minor
    discountMinor: Minor
    platformFeeMinor: Minor
    totalMinor: Minor
    refundedMinor: Minor
  }
  tickets: QuoteTicket[]
  policy: RefundPolicy
}): RefundQuote {
  const { order, tickets, policy } = args

  if (tickets.length === 0) {
    throw new RefundError('There are no refundable tickets on this order.', 409, 'REFUND_NO_TICKETS')
  }

  const faceWeights = tickets.map((t) => assertMinor(t.faceValueMinor, 'ticket price'))
  const grossFaceMinor = addMinor(...faceWeights)

  // A discount means the customer paid less than face value, so face value is
  // not what they are owed. Scale by the fraction of the subtotal they actually
  // paid. With no discount (the default) this is exactly the face value.
  const paidFraction =
    order.subtotalMinor > 0 ? (order.subtotalMinor - order.discountMinor) / order.subtotalMinor : 0
  const paidFaceMinor = rateOfMinor(grossFaceMinor, Math.max(0, Math.min(1, paidFraction)))

  const returnedFaceMinor = rateOfMinor(paidFaceMinor, policy.faceValueRate)

  // The fee share follows the selected tickets' weight in the order, not the
  // policy rate: a half refund of face value still hands back either all of
  // that share or none of it, per policy.refundPlatformFee.
  const feeMinor =
    policy.refundPlatformFee && order.subtotalMinor > 0
      ? Math.min(
          order.platformFeeMinor,
          rateOfMinor(order.platformFeeMinor, grossFaceMinor / order.subtotalMinor)
        )
      : 0

  const processingMinor = rateOfMinor(returnedFaceMinor, policy.processingFeeRate)
  const amountMinor = returnedFaceMinor + feeMinor - processingMinor

  const remainingMinor = order.totalMinor - order.refundedMinor

  if (amountMinor <= 0) {
    throw new RefundError(
      'The refund policy that applies here returns nothing, so there is no refund to create.',
      409,
      'REFUND_ZERO_AMOUNT'
    )
  }

  // A safety net rather than an expected path: tickets are claimed exclusively,
  // so their combined value should always fit inside what is left. If it does
  // not, the order's accounting is inconsistent and paying out anyway would
  // only make it worse.
  if (amountMinor > remainingMinor) {
    throw new RefundError(
      `This refund would come to ${amountMinor} paisa but only ${remainingMinor} paisa of this order is still refundable.`,
      409,
      'REFUND_EXCEEDS_REMAINING'
    )
  }

  // Split each total across the lines so the parts reconcile exactly.
  const lineFace = allocateProportional(returnedFaceMinor, faceWeights)
  const lineFee = allocateProportional(feeMinor, faceWeights)
  const lineProcessing = allocateProportional(processingMinor, faceWeights)

  const lines: RefundQuoteLine[] = tickets.map((t, i) => ({
    ticketId: t.id,
    ticketStatusAtRefund: t.status,
    faceValueMinor: lineFace[i],
    platformFeeShareMinor: lineFee[i],
    processingFeeMinor: lineProcessing[i],
    amountMinor: lineFace[i] + lineFee[i] - lineProcessing[i],
  }))

  // Who funds it. The retained service charge stays against the organizer's
  // payable, so their clawback is the net ticket money the customer received;
  // the platform gives up exactly the commission it hands back. Both are
  // non-negative by construction, which the ledger requires.
  const organizerShareMinor = returnedFaceMinor - processingMinor
  const platformShareMinor = feeMinor

  return {
    policy,
    currency: REFUND_CURRENCY,
    lines,
    ticketFaceValueMinor: returnedFaceMinor,
    platformFeeRefundedMinor: feeMinor,
    processingFeeMinor: processingMinor,
    amountMinor,
    organizerShareMinor,
    platformShareMinor,
    grossTicketValueMinor: grossFaceMinor,
    refundableRemainingMinor: remainingMinor,
  }
}

/**
 * Whether refunding this amount empties the order. Drives the order's
 * paymentStatus (REFUNDED vs PARTIALLY_REFUNDED).
 */
export function isFullOrderRefund(args: {
  order: { totalMinor: Minor; refundedMinor: Minor }
  amountMinor: Minor
}): boolean {
  return args.order.totalMinor - args.order.refundedMinor - args.amountMinor <= 0
}
