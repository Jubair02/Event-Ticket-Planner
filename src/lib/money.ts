/**
 * Money.
 *
 * ## The rule
 *
 * Money is NEVER a floating-point number in this codebase. Every amount is an
 * integer count of **minor units** — paisa, where `1 BDT = 100 paisa`.
 *
 *   ৳1,500.00  ->  150000
 *   ৳1,500.50  ->  150050
 *   ৳0.01      ->  1
 *
 * Floats cannot represent most decimal fractions exactly, so `0.1 + 0.2` is
 * `0.30000000000000004`. Summed across thousands of orders that drifts into
 * real money, and a platform fee computed from a drifted subtotal is wrong in a
 * way nobody notices until a payout is disputed.
 *
 * ## Where each unit appears
 *
 * - **Database**: `bigint` columns, all suffixed `Minor` (`priceMinor`,
 *   `totalMinor`, ...). `bigint` rather than `int4` because payouts and ledger
 *   balances accumulate across every order an organizer has ever sold, and
 *   `int4` tops out at ৳21,474,836.47 — reachable for a large organizer.
 * - **Over the wire**: plain JSON integers of paisa, same `Minor` field names.
 *   `Number` is exact up to 2^53 paisa (about ৳90 trillion), far beyond any
 *   real balance, so the conversion in `serialize.ts` is lossless.
 * - **In the UI**: paisa everywhere except the moment a human reads or types an
 *   amount. `formatMinor` renders, `toMinor` parses. Nothing else converts.
 *
 * Anything named `*Minor` is paisa. Anything named `taka` is a human-facing
 * decimal and may only exist at an input or an output edge.
 */

/** Paisa per taka. */
export const MINOR_PER_UNIT = 100

/** ISO 4217 code for every amount in the system today. */
export const CURRENCY = 'BDT'

/** Decimal places `CURRENCY` is quoted in. Kept in step with MINOR_PER_UNIT. */
export const CURRENCY_DECIMALS = 2

/**
 * An integer number of paisa.
 *
 * A type alias, not a branded type: branding would force every `qty * price` in
 * a React component through a helper, and that noise tends to get worked around
 * rather than followed. The guarantee is enforced instead by the `Minor`
 * field-name suffix, `assertMinor` at the trust boundaries, and CHECK
 * constraints in the database.
 */
export type Minor = number

/**
 * Largest amount representable exactly as a JS number, in paisa.
 * About ৳90 trillion — a ceiling for arithmetic safety, not a business limit.
 */
export const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER

/** Ceiling for a single ticket price: ৳1,000,000.00. */
export const MAX_TICKET_PRICE_MINOR = 1_000_000 * MINOR_PER_UNIT

/** Ceiling for one order line's quantity, so an order total stays sane. */
export const MAX_TICKETS_PER_ORDER_LINE = 20

/** Platform commission, as a fraction of the discounted subtotal. */
export const PLATFORM_FEE_RATE = 0.03

/** True when `v` is a safe integer count of paisa (negatives allowed). */
export function isMinor(v: unknown): v is Minor {
  return typeof v === 'number' && Number.isSafeInteger(v)
}

/**
 * Narrows `v` to `Minor` or throws. Use at trust boundaries — reading an amount
 * out of a request body, or back out of the database.
 */
export function assertMinor(v: unknown, label = 'amount'): Minor {
  if (!isMinor(v)) {
    throw new TypeError(`${label} must be an integer number of paisa, received ${String(v)}`)
  }
  return v
}

/**
 * Rounds half away from zero, the convention used for consumer prices here.
 *
 * `Math.round` rounds half toward +Infinity, so it would turn -0.5 into -0 and
 * quietly favour one side on refund credits.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/**
 * Only `.` separates the decimals, and a comma is rejected outright rather
 * than treated as either separator.
 *
 * Treating `,` as a decimal point looked harmless until "1,500" — a completely
 * natural way to write fifteen hundred taka here, where `,` groups thousands —
 * parsed as 1.50 and silently priced a ticket at ৳1.50. Guessing wrong about a
 * separator is a pricing error, so an ambiguous amount is refused and the
 * caller asks the person to retype it.
 */
const DECIMAL_INPUT = /^\s*(-)?(\d*)(?:\.(\d+))?\s*$/

/**
 * Parses a human-entered taka amount into paisa. Returns `null` when the input
 * is not a usable amount, so callers can reject with their own message.
 *
 *   toMinor('1500')    -> 150000
 *   toMinor('1500.5')  -> 150050
 *   toMinor('1,500')   -> null      (a comma is ambiguous, so it is refused)
 *   toMinor(1500.55)   -> 150055
 *   toMinor('')        -> null
 *
 * Strings are parsed digit by digit rather than multiplied, because
 * `1500.55 * 100` is `150054.99999999999`. Numbers go through their shortest
 * decimal representation first, which is exact for anything a form produces.
 */
export function toMinor(taka: unknown): Minor | null {
  if (typeof taka === 'number') {
    if (!Number.isFinite(taka)) return null
    return toMinor(String(taka))
  }
  if (typeof taka !== 'string') return null

  const m = DECIMAL_INPUT.exec(taka)
  if (!m) return null

  const [, sign, whole = '', fraction] = m
  if (!whole && !fraction) return null

  const negative = sign === '-'
  const wholeMinor = whole ? Number(whole) * MINOR_PER_UNIT : 0
  if (!Number.isSafeInteger(wholeMinor)) return null

  let fractionMinor = 0
  if (fraction) {
    // Keep CURRENCY_DECIMALS digits; the next digit decides the rounding.
    const kept = fraction.slice(0, CURRENCY_DECIMALS).padEnd(CURRENCY_DECIMALS, '0')
    fractionMinor = Number(kept)
    const rest = fraction.slice(CURRENCY_DECIMALS)
    if (rest && Number(rest[0]) >= 5) fractionMinor += 1
  }

  const total = wholeMinor + fractionMinor
  if (!Number.isSafeInteger(total)) return null
  return negative ? -total : total
}

/**
 * Paisa back to a decimal taka number.
 *
 * Only for places that require a decimal by contract — a schema.org offer, a
 * CSV export, a gateway field. Never for arithmetic, and never stored.
 */
export function fromMinor(minor: Minor): number {
  return assertMinor(minor) / MINOR_PER_UNIT
}

/**
 * Renders paisa for a reader: `৳1,500` or `৳1,500.50`.
 *
 * Whole taka print without decimals because that is how prices are written in
 * Bangladesh; a non-zero paisa remainder always prints, so a partial refund is
 * never silently rounded away on screen. Grouping follows the Indian numbering
 * system (1,50,000), which is what `en-IN` gives and what BD readers expect.
 */
export function formatMinor(
  minor: Minor,
  { showDecimals }: { showDecimals?: boolean } = {}
): string {
  assertMinor(minor)
  const withDecimals = showDecimals ?? minor % MINOR_PER_UNIT !== 0
  const digits = withDecimals ? CURRENCY_DECIMALS : 0
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(minor) / MINOR_PER_UNIT)
  return `${minor < 0 ? '-' : ''}৳${formatted}`
}

/** Sum of paisa amounts. Throws rather than drift out of the exact range. */
export function addMinor(...amounts: Minor[]): Minor {
  let total = 0
  for (const a of amounts) total += assertMinor(a)
  return assertMinor(total, 'sum')
}

/** `minor` times a whole quantity. */
export function mulMinor(minor: Minor, quantity: number): Minor {
  assertMinor(minor, 'price')
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new TypeError(`quantity must be a non-negative integer, received ${String(quantity)}`)
  }
  return assertMinor(minor * quantity, 'line total')
}

/**
 * Splits `minor` by a rate, rounding half away from zero.
 * The single place a percentage ever touches money.
 */
export function rateOfMinor(minor: Minor, rate: number): Minor {
  assertMinor(minor)
  if (!Number.isFinite(rate) || rate < 0) {
    throw new TypeError(`rate must be a non-negative finite number, received ${String(rate)}`)
  }
  return assertMinor(roundHalfAwayFromZero(minor * rate), 'rated amount')
}

/**
 * The platform fee for a discounted subtotal — the one definition, shared by
 * the checkout preview, order creation and the ledger, so the number the
 * customer is quoted is the number that gets booked.
 */
export function platformFeeMinor(discountedSubtotalMinor: Minor): Minor {
  return rateOfMinor(discountedSubtotalMinor, PLATFORM_FEE_RATE)
}

/** The money side of an order, derived in one place from the line items. */
export interface OrderTotals {
  subtotalMinor: Minor
  discountMinor: Minor
  platformFeeMinor: Minor
  totalMinor: Minor
}

/**
 * Builds an order's totals so every caller agrees on the arithmetic:
 * `total = subtotal - discount + fee`, with the fee charged on the amount the
 * customer actually pays for tickets. That identity is also a CHECK constraint
 * on the `Order` table, so a disagreeing writer fails loudly.
 */
export function orderTotals(
  lines: Array<{ unitPriceMinor: Minor; quantity: number }>,
  discountMinor: Minor = 0
): OrderTotals {
  const subtotalMinor = addMinor(...lines.map((l) => mulMinor(l.unitPriceMinor, l.quantity)))
  assertMinor(discountMinor, 'discount')
  if (discountMinor < 0) throw new TypeError('discount cannot be negative')
  // A discount can never exceed what is being discounted, or the total would go
  // negative and the platform would owe the customer money.
  const cappedDiscount = Math.min(discountMinor, subtotalMinor)
  const discounted = subtotalMinor - cappedDiscount
  const fee = platformFeeMinor(discounted)
  return {
    subtotalMinor,
    discountMinor: cappedDiscount,
    platformFeeMinor: fee,
    totalMinor: addMinor(discounted, fee),
  }
}

/** Paisa -> the `bigint` the database column holds. */
export function toDbMinor(minor: Minor): bigint {
  return BigInt(assertMinor(minor))
}

/**
 * A `bigint` money column back to paisa.
 * Throws instead of silently losing precision above 2^53.
 */
export function fromDbMinor(value: bigint | number | null | undefined): Minor {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return assertMinor(value)
  if (value > BigInt(MAX_SAFE_MINOR) || value < -BigInt(MAX_SAFE_MINOR)) {
    throw new RangeError(`money value ${value.toString()} exceeds the exact JSON integer range`)
  }
  return Number(value)
}
