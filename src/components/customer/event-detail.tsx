'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CalendarX,
  ExternalLink,
  MapPin,
  Minus,
  Plus,
  ShieldCheck,
  Ticket as TicketIcon,
  Users,
} from 'lucide-react'
import { apiGet } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import {
  categoryEmoji,
  categoryLabel,
  daysUntil,
  formatBDT,
  formatEventDate,
  formatTime,
} from '@/lib/format'
import { PLATFORM_FEE_RATE } from '@/lib/constants'
import type { EventDetail as EventDetailDTO, TicketTypeDTO } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/empty-state'
import { cn } from '@/lib/utils'
import { safeHttpUrl } from '@/lib/url'

interface TicketWindow {
  available: number
  soldOut: boolean
  closed: boolean
  notOpen: boolean
  max: number
  purchasable: boolean
}

function ticketWindow(t: TicketTypeDTO): TicketWindow {
  const now = Date.now()
  const available = Math.max(0, t.totalQuantity - t.soldQuantity)
  const closed = t.salesEnd ? new Date(t.salesEnd).getTime() < now : false
  const notOpen = t.salesStart ? new Date(t.salesStart).getTime() > now : false
  const max = Math.min(t.maxPerOrder, available)
  return {
    available,
    soldOut: available <= 0,
    closed,
    notOpen,
    max,
    purchasable: available > 0 && !closed && !notOpen,
  }
}

export function EventDetail({ eventId }: { eventId: string }) {
  const { navigate, openAuth, user } = useAppStore()
  const [selected, setSelected] = useState<Record<string, number>>({})

  const query = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => apiGet<{ event: EventDetailDTO }>(`/api/events/${eventId}`),
  })
  const event = query.data?.event

  const totalQty = useMemo(
    () => (event ? event.ticketTypes.reduce((acc, t) => acc + (selected[t.id] ?? 0), 0) : 0),
    [event, selected],
  )
  const subtotal = useMemo(
    () => (event ? event.ticketTypes.reduce((acc, t) => acc + (selected[t.id] ?? 0) * t.price, 0) : 0),
    [event, selected],
  )
  const fee = Math.round(subtotal * PLATFORM_FEE_RATE)

  function changeQty(t: TicketTypeDTO, delta: number) {
    const win = ticketWindow(t)
    setSelected((prev) => {
      if (!win.purchasable) return { ...prev, [t.id]: 0 }
      const next = Math.min(Math.max(0, (prev[t.id] ?? 0) + delta), Math.max(0, win.max))
      return { ...prev, [t.id]: next }
    })
  }

  function handleBuy() {
    if (totalQty === 0) return
    if (!user) {
      openAuth('login')
      return
    }
    navigate({ name: 'checkout', eventId })
  }

  if (query.isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <EmptyState
          icon={CalendarX}
          title="Event not found"
          description="This event may have been removed or is no longer available."
          action={
            <Button onClick={() => navigate({ name: 'home' })}>
              <ArrowLeft className="h-4 w-4" /> Back to Events
            </Button>
          }
        />
      </div>
    )
  }

  if (query.isLoading || !event) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <Skeleton className="aspect-[16/7] max-h-[420px] w-full rounded-2xl" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-44 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  const selectedRows = event.ticketTypes.filter((t) => (selected[t.id] ?? 0) > 0)
  const dateLabel = daysUntil(event.startDate, event.endDate)

  return (
    <div className="pb-28 lg:pb-10">
      {/* Banner */}
      <div className="relative aspect-[16/7] max-h-[420px] w-full overflow-hidden bg-muted">
        {event.banner ? (
           
          <img src={event.banner} alt={`${event.title} banner`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 via-primary/10 to-accent text-7xl">
            {categoryEmoji(event.category)}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/10" />

        <div className="absolute left-4 top-4 z-10">
          <Button
            variant="secondary"
            size="icon"
            className="bg-background/80 backdrop-blur hover:bg-background"
            onClick={() => navigate({ name: 'home' })}
            aria-label="Back to events"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 mx-auto w-full max-w-7xl px-4 pb-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-background/90 text-foreground backdrop-blur hover:bg-background/90">
              {categoryEmoji(event.category)} {categoryLabel(event.category)}
            </Badge>
            {event.featured && (
              <Badge className="bg-primary/95 text-primary-foreground backdrop-blur hover:bg-primary/95">
                ★ Featured
              </Badge>
            )}
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
          <h1 className="mt-3 max-w-3xl text-2xl font-bold text-white drop-shadow-sm sm:text-3xl lg:text-4xl">
            {event.title}
          </h1>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main column */}
          <div className="space-y-6 lg:col-span-2">
            {/* Meta card */}
            <Card className="p-4 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">{formatEventDate(event.startDate)}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatTime(event.startTime)}
                      {event.endTime ? ` – ${formatTime(event.endTime)}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <MapPin className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{event.venue}</p>
                    <p className="text-sm text-muted-foreground">
                      {event.address}, {event.city}
                    </p>
                    {safeHttpUrl(event.mapUrl) && (
                      <a
                        href={safeHttpUrl(event.mapUrl) as string}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        Open in Google Maps <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-3 sm:col-span-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Building2 className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">Organized by {event.organizer.organizationName}</p>
                    {event.organizer.user?.name && (
                      <p className="text-sm text-muted-foreground">Host: {event.organizer.user.name}</p>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            {/* About */}
            <section aria-label="About event">
              <h2 className="mb-3 text-lg font-semibold">About Event</h2>
              <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
                {event.description
                  .split('\n')
                  .filter((p) => p.trim().length > 0)
                  .map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
              </div>
            </section>

            {/* Tickets */}
            <section aria-label="Tickets">
              <h2 className="mb-3 text-lg font-semibold">Tickets</h2>
              {event.ticketTypes.length === 0 && (
                <p className="rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  No ticket types are available for this event yet.
                </p>
              )}
              <div className="space-y-4">
                {event.ticketTypes.map((t) => {
                  const win = ticketWindow(t)
                  const qty = selected[t.id] ?? 0
                  const pct =
                    t.totalQuantity > 0
                      ? Math.min(100, Math.round((t.soldQuantity / t.totalQuantity) * 100))
                      : 100
                  return (
                    <Card key={t.id} className={cn('p-4', !win.purchasable && 'opacity-80')}>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{t.name}</h3>
                            {win.soldOut ? (
                              <Badge variant="destructive">Sold out</Badge>
                            ) : win.closed ? (
                              <Badge variant="secondary">Sales closed</Badge>
                            ) : win.notOpen ? (
                              <Badge variant="secondary">Sales start soon</Badge>
                            ) : null}
                          </div>
                          {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                          <div className="flex items-center gap-2">
                            <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <Progress value={pct} className="h-2 w-28" aria-label={`${pct}% sold`} />
                            <span className="text-xs text-muted-foreground">
                              {win.soldOut ? 'Sold out' : `${win.available} left`}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-end justify-between gap-4 sm:flex-col sm:items-end">
                          <p className="text-lg font-bold text-primary">
                            {t.price === 0 ? 'Free' : formatBDT(t.price)}
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              disabled={!win.purchasable || qty === 0}
                              onClick={() => changeQty(t, -1)}
                              aria-label={`Remove one ${t.name} ticket`}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                              {qty}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              disabled={!win.purchasable || qty >= win.max}
                              onClick={() => changeQty(t, 1)}
                              aria-label={`Add one ${t.name} ticket`}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                          {win.purchasable && win.max > 0 && (
                            <p className="hidden text-xs text-muted-foreground sm:block">Max {win.max} per order</p>
                          )}
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </section>
          </div>

          {/* Desktop summary */}
          <aside className="hidden lg:block">
            <Card className="sticky top-24 p-6">
              <h2 className="font-semibold">Order Summary</h2>
              {selectedRows.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Select tickets to continue.</p>
              ) : (
                <div className="mt-3 space-y-1.5 text-sm">
                  {selectedRows.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {t.name} × {selected[t.id]}
                      </span>
                      <span className="shrink-0 font-medium">{formatBDT((selected[t.id] ?? 0) * t.price)}</span>
                    </div>
                  ))}
                </div>
              )}
              <Separator className="my-4" />
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tickets ({totalQty})</span>
                  <span>{formatBDT(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Platform fee (3%)</span>
                  <span>{formatBDT(fee)}</span>
                </div>
                <div className="flex justify-between text-base font-bold">
                  <span>Total</span>
                  <span className="text-primary">{formatBDT(subtotal + fee)}</span>
                </div>
              </div>
              <Button className="mt-4 w-full" size="lg" onClick={handleBuy} disabled={totalQty === 0}>
                <TicketIcon className="h-4 w-4" /> Buy Ticket
              </Button>
              <p className="mt-3 flex items-center justify-center gap-1 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> Secure checkout via SSLCOMMERZ
              </p>
            </Card>
          </aside>
        </div>
      </div>

      {/* Mobile sticky buy bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-4 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {totalQty > 0
                ? `${totalQty} ticket${totalQty > 1 ? 's' : ''} · ${formatBDT(subtotal + fee)}`
                : 'No tickets selected'}
            </p>
            <p className="text-xs text-muted-foreground">
              {totalQty > 0 ? `Incl. ${formatBDT(fee)} platform fee` : 'Pick a quantity above'}
            </p>
          </div>
          <Button size="lg" className="shrink-0" onClick={handleBuy} disabled={totalQty === 0}>
            <TicketIcon className="h-4 w-4" /> Buy Ticket
          </Button>
        </div>
      </div>
    </div>
  )
}
