'use client'

import type { EventListItem } from '@/lib/types'
import { formatBDT, formatEventDate, categoryLabel, categoryEmoji, daysUntil } from '@/lib/format'
import Link from 'next/link'
import { paths } from '@/lib/routes'
import { Badge } from '@/components/ui/badge'
import { CalendarDays, MapPin, Users } from 'lucide-react'

function fromPrice(event: EventListItem): number | null {
  if (!event.ticketTypes?.length) return null
  return Math.min(...event.ticketTypes.map((t) => t.price))
}

function totalSold(event: EventListItem): number {
  return (event.ticketTypes || []).reduce((acc, t) => acc + t.soldQuantity, 0)
}

function totalQty(event: EventListItem): number {
  return (event.ticketTypes || []).reduce((acc, t) => acc + t.totalQuantity, 0)
}

export function EventCard({ event }: { event: EventListItem }) {
  const min = fromPrice(event)
  const sold = totalSold(event)
  const qty = totalQty(event)
  const pct = qty > 0 ? Math.min(100, Math.round((sold / qty) * 100)) : 0
  const dateLabel = daysUntil(event.startDate, event.endDate)

  return (
    /* A real link now, so the card is crawlable, middle-clickable and prefetched. */
    <Link
      href={paths.event(event)}
      className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`View event ${event.title}`}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
        {event.banner ? (
           
          <img
            src={event.banner}
            alt={`${event.title} banner`}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-accent text-5xl">
            {categoryEmoji(event.category)}
          </div>
        )}
        <div className="absolute left-3 top-3 flex gap-2">
          <Badge className="bg-background/90 text-foreground backdrop-blur hover:bg-background/90">
            {categoryEmoji(event.category)} {categoryLabel(event.category)}
          </Badge>
          {event.featured && (
            <Badge className="bg-primary/95 text-primary-foreground backdrop-blur hover:bg-primary/95">★ Featured</Badge>
          )}
        </div>
        <div className="absolute right-3 top-3">
          <Badge
            className={
              dateLabel === 'Ended'
                ? 'bg-muted text-muted-foreground hover:bg-muted'
                : 'bg-destructive text-white hover:bg-destructive'
            }
          >
            {dateLabel}
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 font-semibold leading-snug group-hover:text-primary">{event.title}</h3>
        <div className="mt-auto space-y-1.5 text-sm text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {formatEventDate(event.startDate)} · {event.startTime}
          </p>
          <p className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-1">{event.venue}, {event.city}</span>
          </p>
        </div>
        <div className="flex items-center justify-between border-t pt-3">
          <div>
            {min !== null ? (
              <p className="text-sm">
                <span className="text-xs text-muted-foreground">From</span>{' '}
                <span className="font-bold text-primary">{formatBDT(min)}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Tickets TBA</p>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {sold} sold
          </div>
        </div>
      </div>
    </Link>
  )
}
