'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Ban,
  CalendarDays,
  Clock,
  History,
  MapPin,
  QrCode,
  Ticket,
  WifiOff,
} from 'lucide-react'
import { apiGet } from '@/lib/api'
import { paths } from '@/lib/routes'
import { categoryLabel, daysUntil, formatEventDate, formatMinor, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { OrderDTO, TicketDTO } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/app/empty-state'
import { CategoryIcon } from '@/components/app/category-icon'
import { useUrlQuery } from '@/components/dashboard/use-url-query'
import {
  TICKET_TONE_ICON,
  ticketStatusMeta,
  ticketTone,
  type TicketTone,
} from '@/components/customer/ticket-status-badge'

/**
 * My Tickets — the wallet.
 *
 * Its job is not browsing. Someone opening this screen is either about to walk
 * into a venue or checking that a purchase landed, so the page leads with the
 * one ticket they are most likely to need — the next event starting — and
 * relegates everything else to a scannable list.
 *
 * The e-ticket itself (`ticket-detail.tsx`) remains the gate document; this is
 * the index that gets you to it in one tap.
 */

type TabKey = 'upcoming' | 'past' | 'cancelled'

interface TicketRow {
  order: OrderDTO
  ticket: TicketDTO
  event: NonNullable<OrderDTO['event']>
}

/** Rows switch to a filter input past this many, not before. */
const FILTER_THRESHOLD = 6

function isCancelledRow(r: TicketRow): boolean {
  return r.ticket.status === 'CANCELLED' || r.ticket.status === 'INVALID' || r.event.status === 'CANCELLED'
}

/** The left rail: a second, non-colour-dependent carrier of the ticket's state. */
const RAIL: Record<TicketTone, string> = {
  valid: 'bg-primary',
  used: 'bg-primary/40',
  void: 'bg-destructive',
}

const CHIP: Record<TicketTone, string> = {
  valid: 'border-primary/30 bg-primary/10 text-primary',
  used: 'border-border bg-muted text-muted-foreground',
  void: 'border-destructive/30 bg-destructive/10 text-destructive',
}

function EventThumb({
  event,
  className,
  dim,
}: {
  event: TicketRow['event']
  className?: string
  dim?: boolean
}) {
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-xl bg-muted', className)}>
      {event.banner ? (
        <img
          src={event.banner}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className={cn('h-full w-full object-cover', dim && 'grayscale')}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-accent text-primary/70"
          aria-hidden="true"
        >
          <CategoryIcon category={event.category} className="size-5" />
        </div>
      )}
    </div>
  )
}

/**
 * The next ticket the holder will need, given the full treatment.
 *
 * This replaces a permanent "show the QR at the venue" instruction banner that
 * sat above the list on every visit. The advice only matters next to the ticket
 * it applies to, so it lives here instead — said once, where it is actionable.
 */
function NextUpCard({ row }: { row: TicketRow }) {
  const { ticket, event } = row
  const tone = ticketTone(ticket.status)
  const ToneIcon = TICKET_TONE_ICON[tone]
  const meta = ticketStatusMeta(ticket.status)
  const dateLabel = daysUntil(event.startDate, event.endDate)

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-3xl border border-border/70 bg-card',
        'shadow-2xl shadow-primary/[0.07] ring-1 ring-inset ring-white/40 dark:ring-white/5',
      )}
      aria-labelledby="next-up-title"
    >
      <div className="relative h-40 w-full overflow-hidden bg-muted sm:h-48">
        {event.banner ? (
            <img
            src={event.banner}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 via-primary/10 to-accent text-primary/60"
            aria-hidden="true"
          >
            <CategoryIcon category={event.category} className="size-12" />
          </div>
        )}
        {/* Two scrims: vertical for the copy, horizontal for the left edge. The
            banner is an arbitrary upload, so every chip carries its own backing
            and never inherits a page token. */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-black/55 to-transparent"
          aria-hidden="true"
        />

        <div className="absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/12 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
            <CategoryIcon category={event.category} className="size-3.5" />
            {categoryLabel(event.category)}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
              dateLabel === 'Happening now'
                ? 'border-white/25 bg-white/90 text-neutral-900'
                : 'border-white/20 bg-white/12 text-white backdrop-blur-md',
            )}
          >
            <Clock className="size-3.5" aria-hidden="true" />
            {dateLabel}
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-white/70 uppercase">
            Next up
          </p>
          <h2
            id="next-up-title"
            className="mt-1 line-clamp-2 text-xl font-semibold tracking-tight text-balance text-white sm:text-2xl"
          >
            {event.title}
          </h2>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-2.5">
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                When
              </dt>
              <dd className="text-sm">
                {formatEventDate(event.startDate)} · {formatTime(event.startTime)}
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Where
              </dt>
              <dd className="truncate text-sm">
                {event.venue}, {event.city}
              </dd>
            </div>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
              CHIP[tone],
            )}
          >
            <ToneIcon className="size-3.5" aria-hidden="true" />
            {meta.label}
          </span>
          {ticket.ticketType && <Badge variant="outline">{ticket.ticketType.name}</Badge>}
          <span className="font-mono text-xs tracking-tight text-muted-foreground tabular-nums">
            {ticket.ticketCode}
          </span>
        </div>

        <Button
          asChild
          size="lg"
          className="mt-4 h-12 w-full active:scale-[0.99] motion-reduce:transform-none"
        >
          <Link href={paths.ticket(ticket.id)}>
            <QrCode /> Show QR at the gate
          </Link>
        </Button>

        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <WifiOff className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          The QR is generated on your device, so it still scans without a signal.
        </p>
      </div>
    </article>
  )
}

function TicketListRow({
  row,
  demoted,
  style,
}: {
  row: TicketRow
  demoted?: boolean
  style?: React.CSSProperties
}) {
  const { ticket, event } = row
  const tone = ticketTone(ticket.status)
  const ToneIcon = TICKET_TONE_ICON[tone]
  const meta = ticketStatusMeta(ticket.status)

  return (
    <li
      className="animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards duration-300 motion-reduce:animate-none"
      style={style}
    >
      {/* The whole row is the target. Previously the title and a "View Ticket"
          button competed for the same intent, and neither covered the row. */}
      <Link
        href={paths.ticket(ticket.id)}
        className={cn(
          'group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border/70 bg-card p-3 pl-4',
          'shadow-sm transition-all duration-200 sm:gap-4',
          'hover:border-primary/30 hover:shadow-md hover:shadow-primary/[0.06]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'motion-reduce:transition-none',
        )}
      >
        <span
          className={cn('absolute inset-y-0 left-0 w-1', RAIL[tone])}
          aria-hidden="true"
        />

        <EventThumb event={event} dim={demoted} className="h-16 w-20 sm:h-18 sm:w-24" />

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'truncate font-medium transition-colors group-hover:text-primary',
              demoted && 'text-muted-foreground',
            )}
          >
            {event.title}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {formatEventDate(event.startDate)} · {formatTime(event.startTime)}
            </span>
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {event.venue}, {event.city}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                CHIP[tone],
              )}
            >
              <ToneIcon className="size-3" aria-hidden="true" />
              {meta.label}
            </span>
            {ticket.ticketType && (
              <span className="text-[11px] text-muted-foreground">
                {ticket.ticketType.name}
                {ticket.ticketType.priceMinor > 0 && (
                  <span className="tabular-nums"> · {formatMinor(ticket.ticketType.priceMinor)}</span>
                )}
              </span>
            )}
            <span className="font-mono text-[11px] text-muted-foreground/80 tabular-nums">
              {ticket.ticketCode}
            </span>
          </div>
        </div>

        <ArrowRight
          className="hidden size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none sm:block"
          aria-hidden="true"
        />
      </Link>
    </li>
  )
}

/** Shown only once a tab is long enough that scanning it stops working. */
function RowFilter({
  value,
  onChange,
  count,
}: {
  value: string
  onChange: (v: string) => void
  count: number
}) {
  return (
    <div className="relative">
      <Ticket className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Search ${count} tickets by event, venue or code`}
        aria-label="Filter tickets"
        className="pl-9"
      />
    </div>
  )
}

function TicketList({
  rows,
  demoted,
  emptyState,
}: {
  rows: TicketRow[]
  demoted?: boolean
  emptyState: React.ReactNode
}) {
  const [filter, setFilter] = useState('')
  const showFilter = rows.length > FILTER_THRESHOLD
  const q = filter.trim().toLowerCase()
  const visible = q
    ? rows.filter((r) =>
        [r.event.title, r.event.venue, r.event.city, r.ticket.ticketCode]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    : rows

  if (rows.length === 0) return <>{emptyState}</>

  return (
    <div className="space-y-3">
      {showFilter && <RowFilter value={filter} onChange={setFilter} count={rows.length} />}
      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing matches “{filter}”.
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((r, i) => (
            <TicketListRow
              key={r.ticket.id}
              row={r}
              demoted={demoted}
              /* Small per-item delay, capped: past ~8 rows a longer stagger
                 stops feeling responsive and starts feeling slow. */
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export function MyTickets({ initialTab }: { initialTab?: TabKey }) {
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'upcoming')
  // Mirrors the tab into the address bar, so a refresh or a shared link reopens
  // the same one — the same idiom the dashboard sections use.
  useUrlQuery(paths.tickets(tab))

  const query = useQuery({
    queryKey: ['orders', 'mine'],
    queryFn: () => apiGet<{ orders: OrderDTO[] }>('/api/orders/mine'),
  })

  const groups = useMemo(() => {
    const now = Date.now()
    const rows: TicketRow[] = []
    for (const order of query.data?.orders ?? []) {
      if (!order.event) continue
      for (const ticket of order.tickets ?? []) rows.push({ order, ticket, event: order.event })
    }
    const cancelled = rows.filter(isCancelledRow)
    // An event is over when it *ends*, not when it starts. Splitting on
    // startDate filed a multi-day festival under "Past" from its second day
    // onward — while the customer was still attending it and still needed the
    // QR code to get back in. endDate falls back to startDate for the older
    // rows that predate it.
    const endsAt = (r: TicketRow) => new Date(r.event.endDate ?? r.event.startDate).getTime()
    const upcoming = rows
      .filter(
        (r) =>
          !isCancelledRow(r) &&
          r.order.paymentStatus === 'PAID' &&
          (r.ticket.status === 'ACTIVE' || r.ticket.status === 'CHECKED_IN') &&
          endsAt(r) >= now,
      )
      .sort((a, b) => new Date(a.event.startDate).getTime() - new Date(b.event.startDate).getTime())
    const past = rows
      .filter((r) => !isCancelledRow(r) && r.order.paymentStatus === 'PAID' && endsAt(r) < now)
      .sort((a, b) => new Date(b.event.startDate).getTime() - new Date(a.event.startDate).getTime())
    const cancelledSorted = [...cancelled].sort(
      (a, b) => new Date(b.event.startDate).getTime() - new Date(a.event.startDate).getTime(),
    )
    return { upcoming, past, cancelled: cancelledSorted }
  }, [query.data])

  // The soonest upcoming ticket is promoted out of the list into its own card,
  // so the list below never repeats it.
  const [nextUp, ...restUpcoming] = groups.upcoming
  const total = groups.upcoming.length + groups.past.length + groups.cancelled.length

  const TABS: { value: TabKey; label: string; count: number }[] = [
    { value: 'upcoming', label: 'Upcoming', count: groups.upcoming.length },
    { value: 'past', label: 'Past', count: groups.past.length },
    { value: 'cancelled', label: 'Cancelled', count: groups.cancelled.length },
  ]

  return (
    <div className="pb-16">
      {/* Same textured band as the organizer and admin shells: every signed-in
          surface of the app should read as one place. */}
      <header className="identity-band border-b border-border/70">
        <div className="mx-auto max-w-5xl px-4 pt-8 pb-6 sm:px-6 sm:pt-10">
          <p className="text-[11px] font-medium tracking-[0.14em] text-primary uppercase">
            Your wallet
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-pretty sm:text-4xl">
            My tickets
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {query.isLoading
              ? 'Loading your tickets…'
              : total === 0
                ? 'Nothing here yet — your tickets appear the moment a booking is confirmed.'
                : `${total} ticket${total === 1 ? '' : 's'}. Open one to show its QR at the entrance.`}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {query.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-9 w-full max-w-sm rounded-lg" />
            <Skeleton className="h-72 w-full rounded-3xl" />
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList className="w-full max-w-md sm:w-auto">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="cursor-pointer">
                  {t.label}
                  {t.count > 0 && <span className="ml-1.5 tabular-nums opacity-70">{t.count}</span>}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="upcoming" className="mt-5 space-y-5">
              {nextUp && <NextUpCard row={nextUp} />}
              {restUpcoming.length > 0 && (
                <section aria-labelledby="later-heading" className="space-y-3">
                  <h3
                    id="later-heading"
                    className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
                  >
                    Also coming up
                  </h3>
                  <TicketList rows={restUpcoming} emptyState={null} />
                </section>
              )}
              {groups.upcoming.length === 0 && (
                <EmptyState
                  icon={Ticket}
                  title="No upcoming tickets"
                  description="When you book an event, its ticket shows up here straight away."
                  action={
                    <Button asChild>
                      <Link href={paths.events()}>Browse events</Link>
                    </Button>
                  }
                />
              )}
            </TabsContent>

            <TabsContent value="past" className="mt-5">
              <TicketList
                rows={groups.past}
                demoted
                emptyState={
                  <EmptyState
                    icon={History}
                    title="No past tickets"
                    description="Tickets from events you have attended will be kept here."
                  />
                }
              />
            </TabsContent>

            <TabsContent value="cancelled" className="mt-5">
              <TicketList
                rows={groups.cancelled}
                demoted
                emptyState={
                  <EmptyState
                    icon={Ban}
                    title="No cancelled tickets"
                    description="Every ticket you hold is still valid."
                  />
                }
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
