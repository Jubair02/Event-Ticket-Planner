import { CATEGORY_LABELS } from '@/lib/constants'

/**
 * Money formatting lives in `@/lib/money` next to the arithmetic, and is
 * re-exported here so display code has one import for presentation helpers.
 *
 * `formatMinor` is meant to replace `formatBDT`, which takes taka as a float
 * and rounds on the way out — so a partial refund of ৳1,500.50 prints as
 * ৳1,501 and the missing 50 paisa are invisible. `formatMinor` takes paisa and
 * never rounds.
 */
export { formatMinor } from '@/lib/money'

/**
 * 1500 -> "৳1,500". Takes **taka**, not paisa.
 *
 * Kept because the minor-unit migration is only half applied: `schema.prisma`
 * declares `priceMinor`/`totalMinor` in paisa, but the live database and every
 * API response still carry taka floats (`"price": 1500`). Passing those to
 * `formatMinor` would render ৳15 — a hundredfold understatement on every price
 * in the product — so display code that reads today's API must keep using this.
 *
 * Retire it per call site as each endpoint starts returning `*Minor` fields,
 * not before. See docs/money-model.md.
 */
export function formatBDT(amount: number): string {
  return `৳${new Intl.NumberFormat('en-IN').format(Math.round(amount))}`
}

/** ISO date -> "Fri, 20 Feb 2026" */
export function formatEventDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** ISO date -> "20 Feb" */
export function formatDateShort(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** "18:00" -> "6:00 PM" */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** ISO datetime -> "6:45 PM" */
export function formatDateTimeTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat]?.label ?? cat
}

export function categoryEmoji(cat: string): string {
  return CATEGORY_LABELS[cat]?.emoji ?? '🎪'
}

/**
 * "2 days left" style label (or "Happening now" / "Ended").
 *
 * Pass `endIso` for events that can be in progress: between start and end the
 * label is "Happening now", because comparing against the start date alone
 * would call a live event "Ended".
 */
export function daysUntil(iso: string, endIso?: string | null): string {
  const now = Date.now()
  const start = new Date(iso).getTime()

  if (endIso) {
    const end = new Date(endIso).getTime()
    if (!Number.isNaN(end) && start <= now && now <= end) return 'Happening now'
  }

  const days = Math.ceil((start - now) / (1000 * 60 * 60 * 24))
  if (days < 0) return 'Ended'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `${days} days left`
}
