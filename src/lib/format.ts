import { CATEGORY_LABELS } from '@/lib/constants'

/**
 * Money formatting lives in `@/lib/money` next to the arithmetic, and is
 * re-exported here so display code has one import for presentation helpers.
 *
 * It replaced `formatBDT`, which took taka as a float and rounded on the way
 * out, so a partial refund of ৳1,500.50 printed as ৳1,501 and the missing 50
 * paisa were invisible. `formatMinor` takes paisa and never rounds. Every call
 * site now reads a `*Minor` field, so the taka version is gone.
 */
export { formatMinor } from '@/lib/money'

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

/*
 * `categoryEmoji` was removed once the last call site moved to `<CategoryIcon>`.
 * The emoji values stay in `CATEGORY_LABELS` as data, but nothing renders them
 * as an icon — see the anti-pattern list in the design system.
 */

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
