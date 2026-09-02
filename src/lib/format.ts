import { CATEGORY_LABELS } from '@/lib/constants'

/** 1500 -> "৳1,500" */
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

/** "2 days left" style label (or "Happening now" / "Ended") */
export function daysUntil(iso: string): string {
  const now = new Date()
  const d = new Date(iso)
  const diffMs = d.getTime() - now.getTime()
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (days < 0) return 'Ended'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `${days} days left`
}

export function isUpcoming(startDate: string): boolean {
  return new Date(startDate).getTime() >= Date.now()
}
