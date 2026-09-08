'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CalendarX,
  ExternalLink,
  Lock,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  Ticket as TicketIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { CheckoutItem, View } from '@/lib/store'
import {
  categoryEmoji,
  categoryLabel,
  daysUntil,
  formatBDT,
  formatEventDate,
  formatTime,
} from '@/lib/format'
import { PLATFORM_FEE_RATE } from '@/lib/constants'
import type { EventDetail as EventDetailDTO } from '@/lib/types'
import { ticketWindow } from '@/lib/ticket-window'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/empty-state'
import { cn } from '@/lib/utils'
import { safeHttpUrl } from '@/lib/url'

/**
 * Tone for the countdown badge. Red is reserved for genuinely time-critical
 * events — a routine "12 days left" previously used the same alarm colour as a
 * cancelled ticket, which spent the urgency signal on nothing.
 */
type DateTone = 'ended' | 'live' | 'urgent' | 'neutral'

function dateTone(label: string): DateTone {
  if (label === 'Ended') return 'ended'
  if (label === 'Happening now') return 'live'
  if (label === 'Today' || label === 'Tomorrow') return 'urgent'
  return 'neutral'
}

const DATE_TONE_CLASS: Record<DateTone, string> = {
  ended: 'bg-muted text-muted-foreground hover:bg-muted',
  live: 'bg-primary text-primary-foreground hover:bg-primary',
  urgent: 'bg-destructive text-white hover:bg-destructive',
  neutral: 'bg-background/90 text-foreground backdrop-blur hover:bg-background/90',
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0 sm:border-t-0 sm:pt-0 sm:pl-6 sm:first:pl-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
        <dd className="mt-1 space-y-0.5">{children}</dd>
      </div>
    </div>
  )
}

export function EventDetail({ eventId }: { eventId: string }) {
  const { navigate, openAuth, user } = useAppStore()
  const [selected, setSelected] = useState<Record<string, number>>({})

  const query = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => apiGet<{ event: EventDetailDTO }>(`/api/events/${eventId}`),
  })
  const event = query.data?.event

  /**
   * Chosen tickets, clamped to what is still on sale. Clamping here (rather than
   * only in the +/- handler) keeps the totals honest if inventory shrinks under
   * a stale selection after a refetch.
   */
  const picked = useMemo(() => {
    if (!event) return []
    return event.ticketTypes
      .map((t) => {
        const win = ticketWindow(t)
        const qty = win.purchasable ? Math.min(selected[t.id] ?? 0, win.max) : 0
        return { t, qty }
      })
      .filter((row) => row.qty > 0)
  }, [event, selected])

  const totalQty = picked.reduce((acc, r) => acc + r.qty, 0)
  const subtotal = picked.reduce((acc, r) => acc + r.qty * r.t.price, 0)
  const fee = Math.round(subtotal * PLATFORM_FEE_RATE)
  const total = subtotal + fee

  function changeQty(typeId: string, delta: number) {
    if (!event) return
    const t = event.ticketTypes.find((x) => x.id === typeId)
    if (!t) return
    const win = ticketWindow(t)
    setSelected((prev) => {
      if (!win.purchasable) return { ...prev, [typeId]: 0 }
      const next = Math.min(Math.max(0, (prev[typeId] ?? 0) + delta), Math.max(0, win.max))
      return { ...prev, [typeId]: next }
    })
  }

  function handleBuy() {
    const items: CheckoutItem[] = picked.map((r) => ({ ticketTypeId: r.t.id, quantity: r.qty }))
    if (items.length === 0) return
    // Carry the selection through, so checkout shows what was actually chosen.
    const target: View = { name: 'checkout', eventId, items }
    if (!user) {
      // Come back here after signing in instead of landing on the homepage.
      openAuth('login', target)
      return
    }
    navigate(target)
  }

  if (query.isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <EmptyState
          icon={CalendarX}
          title="We couldn't load this event"
          description="It may have been removed, or the connection dropped on the way."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => query.refetch()} disabled={query.isFetching}>
                <RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />
                {query.isFetching ? 'Retrying…' : 'Try again'}
              </Button>
              <Button variant="outline" onClick={() => navigate({ name: 'home' })}>
                <ArrowLeft className="h-4 w-4" /> Back to events
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  if (query.isLoading || !event) {
    return (
      <div>
        <Skeleton className="h-[320px] w-full rounded-none sm:h-[380px]" />
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Skeleton className="relative z-10 -mt-10 h-28 w-full rounded-2xl sm:-mt-14 sm:h-32" />
          <div className="mt-8 grid gap-8 lg:grid-cols-3 lg:gap-10">
            <div className="space-y-6 lg:col-span-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
            <Skeleton className="h-80 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  const dateLabel = daysUntil(event.startDate, event.endDate)
  const tone = dateTone(dateLabel)
  const mapHref = safeHttpUrl(event.mapUrl)
  const hasTickets = event.ticketTypes.length > 0
  const ctaLabel = user ? 'Continue to checkout' : 'Sign in to continue'

  // Rendered twice (sticky on desktop, inline on mobile). Both copies use
  // display:none at the other breakpoint, so only one is ever exposed to AT.
  const summaryBody = (
    <>
      <h2 className="text-base font-semibold">Order summary</h2>
      {picked.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {hasTickets ? 'Pick a ticket above to see your total.' : 'No tickets are on sale yet.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {picked.map(({ t, qty }) => (
            <li key={t.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                <span className="tabular-nums">{qty}</span>
                <span className="text-muted-foreground"> × </span>
                {t.name}
              </span>
              <span className="shrink-0 font-medium tabular-nums">{formatBDT(qty * t.price)}</span>
            </li>
          ))}
        </ul>
      )}

      <Separator className="my-4" />

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">
            Tickets <span className="tabular-nums">({totalQty})</span>
          </dt>
          <dd className="tabular-nums">{formatBDT(subtotal)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Platform fee (3%)</dt>
          <dd className="tabular-nums">{formatBDT(fee)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd className="text-lg text-primary tabular-nums">{formatBDT(total)}</dd>
        </div>
      </dl>

      <Button
        className="mt-5 w-full transition-transform active:scale-[0.99] motion-reduce:transform-none"
        size="lg"
        onClick={handleBuy}
        disabled={totalQty === 0}
      >
        <TicketIcon className="h-4 w-4" /> {ctaLabel}
      </Button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5 shrink-0" /> Secure checkout via SSLCOMMERZ
      </p>
    </>
  )

  return (
    <div className="pb-32 lg:pb-16">
      {/* ---------- Banner ---------- */}
      <header className="relative min-h-[320px] w-full overflow-hidden bg-muted sm:min-h-[380px] sm:aspect-[16/7] sm:max-h-[420px]">
        {event.banner ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={event.banner}
            alt={`${event.title} event banner`}
            className="absolute inset-0 h-full w-full object-cover"
            decoding="async"
          />
        ) : (
          <div className="hero-pattern absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/40 via-primary/15 to-accent text-7xl">
            <span aria-hidden="true">{categoryEmoji(event.category)}</span>
          </div>
        )}
        {/* Heavier scrim than a decorative fade: the title sits on an arbitrary
            organizer-uploaded photo and has to stay legible on all of them. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-black/20" />

        <div className="absolute left-4 top-4 z-10 sm:left-6">
          <Button
            variant="secondary"
            size="icon"
            className="h-10 w-10 bg-background/85 backdrop-blur transition-colors hover:bg-background"
            onClick={() => navigate({ name: 'home' })}
            aria-label="Back to events"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-background/90 text-foreground backdrop-blur hover:bg-background/90">
              <span aria-hidden="true">{categoryEmoji(event.category)}</span> {categoryLabel(event.category)}
            </Badge>
            {event.featured && (
              <Badge className="bg-primary/95 text-primary-foreground backdrop-blur hover:bg-primary/95">
                Featured
              </Badge>
            )}
            <Badge className={DATE_TONE_CLASS[tone]}>
              {tone === 'live' && (
                <span className="relative mr-1.5 flex h-1.5 w-1.5" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-70 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                </span>
              )}
              {dateLabel}
            </Badge>
          </div>
          <h1 className="mt-3 max-w-3xl text-pretty text-3xl font-bold leading-[1.1] tracking-tight text-white drop-shadow-md sm:text-4xl lg:text-5xl">
            {event.title}
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* ---------- Facts strip, lifted over the banner for depth ---------- */}
        <section className="relative z-10 -mt-10 sm:-mt-14" aria-label="Event details">
          <div className="rounded-2xl border bg-card/95 p-5 shadow-lg shadow-primary/5 backdrop-blur sm:p-6">
            <dl className="grid gap-5 sm:grid-cols-3 sm:divide-x sm:divide-border">
              <Fact icon={CalendarDays} label="When">
                <p className="text-sm font-medium">{formatEventDate(event.startDate)}</p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {formatTime(event.startTime)}
                  {event.endTime ? ` – ${formatTime(event.endTime)}` : ''}
                </p>
              </Fact>

              <Fact icon={MapPin} label="Where">
                <p className="text-sm font-medium">{event.venue}</p>
                <p className="text-sm text-muted-foreground">
                  {event.address}, {event.city}
                </p>
                {mapHref && (
                  <a
                    href={mapHref}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    View on map <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </Fact>

              <Fact icon={Building2} label="Organizer">
                <p className="text-sm font-medium">{event.organizer.organizationName}</p>
                {event.organizer.user?.name && (
                  <p className="text-sm text-muted-foreground">Hosted by {event.organizer.user.name}</p>
                )}
              </Fact>
            </dl>
          </div>
        </section>

        <div className="mt-10 grid gap-10 lg:grid-cols-3 lg:gap-10">
          {/* ---------- Main column ---------- */}
          <div className="space-y-10 lg:col-span-2">
            <section aria-labelledby="about-heading">
              <h2 id="about-heading" className="text-xl font-semibold tracking-tight">
                About this event
              </h2>
              <div className="mt-3 max-w-[65ch] space-y-3 text-[15px] leading-relaxed text-muted-foreground">
                {event.description
                  .split('\n')
                  .filter((p) => p.trim().length > 0)
                  .map((p, i) => (
                    <p key={i} className="text-pretty">
                      {p}
                    </p>
                  ))}
              </div>
            </section>

            <section aria-labelledby="tickets-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="tickets-heading" className="text-xl font-semibold tracking-tight">
                  Tickets
                </h2>
                {hasTickets && (
                  <p className="text-sm text-muted-foreground">Prices include VAT where applicable</p>
                )}
              </div>

              {!hasTickets ? (
                <p className="mt-3 rounded-2xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
                  The organizer hasn&apos;t put tickets on sale yet. Check back soon.
                </p>
              ) : (
                /* One grouped surface with dividers rather than a stack of
                   identical cards, so the ticket list reads as a single
                   priced menu and stays distinct from the facts panel. */
                <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border bg-card">
                  {event.ticketTypes.map((t) => {
                    const win = ticketWindow(t)
                    const qty = selected[t.id] ?? 0
                    const pct =
                      t.totalQuantity > 0
                        ? Math.min(100, Math.round((t.soldQuantity / t.totalQuantity) * 100))
                        : 0
                    const lowStock =
                      win.available > 0 && win.available <= Math.max(5, Math.ceil(t.totalQuantity * 0.1))
                    const atMax = qty >= win.max && win.max > 0

                    return (
                      <li
                        key={t.id}
                        className={cn(
                          'relative p-4 transition-colors sm:p-5',
                          qty > 0 && 'bg-primary/[0.04]',
                          !win.purchasable && 'opacity-70',
                        )}
                      >
                        {/* Selected marker: not colour-only, paired with the
                            row's line total and the summary list. */}
                        {qty > 0 && (
                          <span
                            className="absolute inset-y-0 left-0 w-[3px] bg-primary"
                            aria-hidden="true"
                          />
                        )}
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold">{t.name}</h3>
                              {win.soldOut ? (
                                <Badge variant="secondary">Sold out</Badge>
                              ) : win.closed ? (
                                <Badge variant="secondary">Sales closed</Badge>
                              ) : win.notOpen ? (
                                <Badge variant="secondary">Not yet on sale</Badge>
                              ) : null}
                            </div>

                            {t.description && (
                              <p className="max-w-prose text-sm text-muted-foreground">{t.description}</p>
                            )}

                            {t.totalQuantity > 0 && (
                              <div className="flex items-center gap-2.5">
                                <Progress value={pct} className="h-1.5 w-24" aria-hidden="true" />
                                <span
                                  className={cn(
                                    'text-xs tabular-nums',
                                    lowStock ? 'font-medium text-destructive' : 'text-muted-foreground',
                                  )}
                                >
                                  {win.soldOut
                                    ? 'Sold out'
                                    : lowStock
                                      ? `Only ${win.available} left`
                                      : `${win.available} of ${t.totalQuantity} left`}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-end justify-between gap-4 sm:min-w-[164px] sm:flex-col sm:items-end">
                            <div className="sm:text-right">
                              <p className="text-lg font-semibold tabular-nums">{formatBDT(t.price)}</p>
                              {qty > 0 && (
                                <p className="text-xs text-muted-foreground tabular-nums">
                                  {qty} × {formatBDT(t.price)} = {formatBDT(qty * t.price)}
                                </p>
                              )}
                            </div>

                            {win.purchasable && (
                              <div className="flex flex-col items-end gap-1.5">
                                <div className="flex items-center gap-1.5">
                                  {/* 44px targets on touch, tightened on pointer
                                      devices — these controls change the price. */}
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-11 w-11 transition-transform active:scale-95 motion-reduce:transform-none sm:h-9 sm:w-9"
                                    disabled={qty === 0}
                                    onClick={() => changeQty(t.id, -1)}
                                    aria-label={`Remove one ${t.name} ticket (currently ${qty})`}
                                  >
                                    <Minus className="h-4 w-4" />
                                  </Button>
                                  <span className="w-8 text-center text-base font-semibold tabular-nums">
                                    {qty}
                                  </span>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-11 w-11 transition-transform active:scale-95 motion-reduce:transform-none sm:h-9 sm:w-9"
                                    disabled={atMax}
                                    onClick={() => changeQty(t.id, 1)}
                                    aria-label={`Add one ${t.name} ticket (currently ${qty})`}
                                  >
                                    <Plus className="h-4 w-4" />
                                  </Button>
                                </div>
                                {/* Always visible: this was hidden below sm, so
                                    on a phone the + button simply stopped
                                    responding with no explanation. */}
                                <p className="text-xs text-muted-foreground tabular-nums">
                                  {atMax ? `Limit ${win.max} per order` : `Up to ${win.max} per order`}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* Single live region for the whole page, so quantity changes are
                announced as a meaningful total rather than a bare number. */}
            <p className="sr-only" role="status" aria-live="polite">
              {totalQty === 0
                ? 'No tickets selected.'
                : `${totalQty} ticket${totalQty === 1 ? '' : 's'} selected. Total ${formatBDT(total)}.`}
            </p>

            {/* Mobile summary: the fee breakdown used to be desktop-only */}
            {hasTickets && (
              <Card className="p-5 lg:hidden" aria-label="Order summary">
                {summaryBody}
              </Card>
            )}
          </div>

          {/* ---------- Desktop sticky summary ---------- */}
          <aside className="hidden lg:block" aria-label="Order summary">
            <Card className="sticky top-24 p-6 shadow-lg shadow-primary/5">{summaryBody}</Card>
          </aside>
        </div>
      </div>

      {/* ---------- Mobile sticky bar ---------- */}
      {hasTickets && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tabular-nums">
                {totalQty > 0 ? formatBDT(total) : 'No tickets selected'}
              </p>
              <p className="truncate text-xs text-muted-foreground tabular-nums">
                {totalQty > 0
                  ? `${totalQty} ticket${totalQty === 1 ? '' : 's'} · incl. ${formatBDT(fee)} fee`
                  : 'Choose a ticket to continue'}
              </p>
            </div>
            <Button
              size="lg"
              className="h-12 shrink-0 transition-transform active:scale-[0.98] motion-reduce:transform-none"
              onClick={handleBuy}
              disabled={totalQty === 0}
            >
              <TicketIcon className="h-4 w-4" /> {user ? 'Checkout' : 'Sign in'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
