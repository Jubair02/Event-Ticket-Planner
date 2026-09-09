import { MAX_SAFE_MINOR } from '@/lib/money'

/**
 * `JSON.stringify` throws on `bigint` ("Do not know how to serialize a
 * BigInt"), and every money column in this schema is a `bigint` of paisa. So a
 * route that returns a Prisma row containing money must pass it through here
 * first.
 *
 * The conversion is lossless for money: paisa stays exact as a JSON number all
 * the way to 2^53 (about ৳90 trillion). Anything larger is a bug — a corrupted
 * column or a runaway sum — so it throws rather than round.
 *
 * Only `bigint` is rewritten. `Date` is left alone for `NextResponse.json` to
 * turn into an ISO string, which is what every DTO type already expects.
 */
export function jsonSafe<T>(value: T): JsonSafe<T> {
  return convert(value) as JsonSafe<T>
}

/** `bigint` fields become `number`; everything else keeps its shape. */
export type JsonSafe<T> = T extends bigint
  ? number
  : T extends Date
    ? Date
    : T extends (infer U)[]
      ? JsonSafe<U>[]
      : T extends object
        ? { [K in keyof T]: JsonSafe<T[K]> }
        : T

function convert(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value > BigInt(MAX_SAFE_MINOR) || value < -BigInt(MAX_SAFE_MINOR)) {
      throw new RangeError(
        `Refusing to serialize ${value.toString()}: outside the exact JSON integer range`
      )
    }
    return Number(value)
  }

  if (value === null || typeof value !== 'object') return value

  // Dates serialize themselves. Buffers and other exotic objects are passed
  // through untouched rather than being flattened into index maps.
  if (value instanceof Date) return value
  if (Array.isArray(value)) return value.map(convert)
  if (Object.getPrototypeOf(value) !== Object.prototype) return value

  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) out[key] = convert(v)
  return out
}
