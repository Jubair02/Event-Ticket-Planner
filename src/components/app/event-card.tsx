'use client'

import Link from 'next/link'
import { CalendarDays, MapPin } from 'lucide-react'
import type { EventListItem } from '@/lib/types'
import { formatMinor, formatEventDate, categoryLabel, daysUntil, formatTime } from '@/lib/format'
import { CategoryIcon } from '@/components/app/category-icon'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'

function fromPrice(event: EventListItem): number | null {
  if (!event.ticketTypes?.length) return null
  return Math.min(...event.ticketTypes.map((t) => t.priceMinor))
}

function totalSold(event: EventListItem): number {
  return (event.ticketTypes || []).reduce((acc, t) => acc + t.soldQuantity, 0)
}

function totalQty(event: EventListItem): number {
  return (event.ticketTypes || []).reduce((acc, t) => acc + t.totalQuantity, 0)
}

/**
 * Urgency, in one line, derived from what is actually left.
 *
 * Only says something when it is worth saying: a card that shouts on every
 * event teaches people to ignore the shout.
 */
function scarcity(sold: number, qty: number): { label: string; tone: 'urgent' | 'warm' } | null {
  if (qty <= 0) return null
  const left = qty - sold
  if (left <= 0) return { label: 'Sold out', tone: 'urgent' }
  if (left <= 10) return { label: `Only ${left} left`, tone: 'urgent' }
  if (sold / qty >= 0.8) return { label: 'Almost gone', tone: 'warm' }
  return null
}

export function EventCard({ event }: { event: EventListItem }) {
  const min = fromPrice(event)
  const sold = totalSold(event)
  const qty = totalQty(event)
  const pct = qty > 0 ? Math.min(100, Math.round((sold / qty) * 100)) : 0
  const dateLabel = daysUntil(event.startDate, event.endDate)
  const ended = dateLabel === 'Ended'
  const urgency = ended ? null : scarcity(sold, qty)

  return (
    /* A real link, so the card is crawlable, middle-clickable and prefetched. */
    <Link
      href={paths.event(event)}
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card text-left',
        'shadow-sm transition-all duration-300',
        'hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/10',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
      )}
      aria-label={`View event ${event.title}`}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
        {event.banner ? (
           
          <img
            src={event.banner}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className={cn(
              'h-full w-full object-cover transition-transform duration-500',
              'group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100',
              ended && 'grayscale',
            )}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-accent text-primary/70"
            aria-hidden="true"
          >
            <CategoryIcon category={event.category} className="size-10" />
          </div>
        )}

        {/* Keeps the top badges legible over a bright banner. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/45 to-transparent"
        />

        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <span className="rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm ring-1 ring-inset ring-white/20">
            {categoryLabel(event.category)}
          </span>
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm',
              ended
                ? 'bg-black/35 text-white/70 ring-1 ring-inset ring-white/20'
                : 'bg-white/90 text-foreground',
            )}
          >
            {dateLabel}
          </span>
        </div>

        {urgency && (
          <span
            className={cn(
              'absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              urgency.tone === 'urgent'
                ? 'bg-destructive text-white'
                : 'bg-chart-5 text-foreground',
            )}
          >
            {urgency.label}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <h3 className="line-clamp-2 text-pretty font-semibold leading-snug tracking-tight transition-colors duration-200 group-hover:text-primary">
          {event.title}
        </h3>

        <div className="mt-auto space-y-1.5 text-sm text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {formatEventDate(event.startDate)} · {formatTime(event.startTime)}
            </span>
          </p>
          <p className="flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="line-clamp-1">
              {event.venue}, {event.city}
            </span>
          </p>
        </div>

        {/* A hairline sales bar reads faster than "29 sold" and takes less room. */}
        {qty > 0 && (
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${pct}% of tickets sold`}
          >
            <div
              className={cn('h-full rounded-full', pct >= 80 ? 'bg-chart-5' : 'bg-primary/70')}
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
        )}

        <div className="flex items-baseline justify-between gap-2 border-t border-border/70 pt-3">
          {min !== null ? (
            <p className="flex items-baseline gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">From</span>
              <span className="text-base font-semibold tracking-tight text-foreground tabular-nums">
                {formatMinor(min)}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Tickets TBA</p>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">{sold} sold</span>
        </div>
      </div>
    </Link>
  )
}
