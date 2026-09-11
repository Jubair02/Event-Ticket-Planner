'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Copy,
  Download,
  ExternalLink,
  Info,
  Mail,
  Receipt,
  Ticket,
} from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatDateShort, formatDateTimeTime, formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import { PAYMENT_STATUS_LABELS } from '@/lib/constants'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { EmptyState } from '@/components/app/empty-state'
import {
  Eyebrow,
  FilterChips,
  HeroMetric,
  MetricGroup,
  Panel,
  SearchBox,
  SectionHeading,
  entrance,
  type FilterOption,
} from '@/components/dashboard/primitives'
import { PaymentStatusBadge } from '@/components/dashboard/status-badges'
import { useUrlQuery } from '@/components/dashboard/use-url-query'
import { useDebounced } from '@/components/admin/shared'

/**
 * The organizer's order ledger.
 *
 * This is not a report — `/organizer` and `/organizer/analytics` already own
 * that. Somebody opens this page to **find one order**: a buyer has emailed
 * asking where their ticket is, or claims to have paid twice, or wants their
 * money back. So it is built as a lookup surface:
 *
 *  - narrowing comes first and stays visible (search, event, payment state),
 *  - one row per order, scannable by order number, with the states an operator
 *    may have to chase made visually distinct from the ones they cannot,
 *  - a detail panel per order carrying the full money split, because "what did
 *    they actually pay and how much has gone back" is the question a support
 *    reply needs answered.
 *
 * It leads with **collected from buyers**, not with earnings. That figure sums
 * what buyers were charged, platform fee included, so it is labelled as
 * exactly that: net earnings live on the overview, and two pages disagreeing
 * about a number called "net" is worse than one page not showing it.
 */

interface OrderRow {
  id: string
  orderNumber: string
  subtotalMinor: number
  discountMinor: number
  platformFeeMinor: number
  totalMinor: number
  refundedMinor: number
  paymentStatus: string
  createdAt: string
  attendeeName: string
  attendeeEmail: string
  buyerName: string
  event: { id: string; slug: string | null; title: string; startDate: string }
  ticketCount: number
}

interface OrdersResponse {
  orders: OrderRow[]
  counts: Record<string, number>
  grossMinor: number
  refundedMinor: number
  truncated: boolean
}

/** Only the slice of `/api/organizer/analytics` the event picker needs. */
interface EventsResponse {
  events: { id: string; title: string; startDate: string }[]
}

/**
 * Payment states in the order money moves through them — also the order the
 * distribution bar stacks in, so the bar always reads left to right as
 * "settled, waiting, returned, lost".
 */
const STATUSES = [
  'PAID',
  'PENDING',
  'PROCESSING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'FAILED',
  'CANCELLED',
] as const

/**
 * Segment fills for the distribution bar, restricted to tokens that keep their
 * meaning in both themes: emerald is money in, amber is money owed, red is
 * money lost, neutral steps are money returned or never taken. The same
 * swatches label the filter chips below the bar, and that is what stops the
 * bar carrying its meaning by colour alone.
 */
const STATUS_FILL: Record<string, string> = {
  PAID: 'bg-primary',
  PENDING: 'bg-warning',
  PROCESSING: 'bg-warning/50',
  PARTIALLY_REFUNDED: 'bg-muted-foreground/55',
  REFUNDED: 'bg-muted-foreground/40',
  FAILED: 'bg-destructive',
  CANCELLED: 'bg-muted-foreground/25',
}

const statusLabel = (status: string) => PAYMENT_STATUS_LABELS[status] ?? status

type SortKey = 'createdAt' | 'totalMinor' | 'ticketCount'

interface Sort {
  key: SortKey
  dir: 'asc' | 'desc'
}

const SORT_CHOICES: { value: string; label: string }[] = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'totalMinor:desc', label: 'Highest value' },
  { value: 'totalMinor:asc', label: 'Lowest value' },
  { value: 'ticketCount:desc', label: 'Most tickets' },
]

const SORT_SENTENCE: Record<string, string> = {
  'createdAt:desc': 'newest first',
  'createdAt:asc': 'oldest first',
  'totalMinor:desc': 'highest value first',
  'totalMinor:asc': 'lowest value first',
  'ticketCount:desc': 'most tickets first',
  'ticketCount:asc': 'fewest tickets first',
}

/** "Ayesha Rahman" -> "AR". Two letters at most, so the tile never reflows. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

/**
 * One CSV cell.
 *
 * Strings are quoted and, when they open with a character Excel and Sheets
 * read as the start of a formula, prefixed with an apostrophe — attendee names
 * and event titles are user input, and a spreadsheet is a program. Numbers go
 * out bare so the spreadsheet can add them up.
 */
function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value)
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

/**
 * Byte-order mark. Without it Excel opens a UTF-8 export as Latin-1 and every
 * taka sign in the file turns into mojibake.
 */
const BOM = '﻿'

/** Exports what is on screen, in the order it is on screen. */
function exportCsv(rows: OrderRow[]) {
  const taka = (minor: number) => minor / 100
  const table: (string | number)[][] = [
    [
      'Order',
      'Placed',
      'Attendee',
      'Attendee email',
      'Bought by',
      'Event',
      'Event date',
      'Tickets',
      'Tickets subtotal',
      'Discount',
      'Platform fee',
      'Buyer paid',
      'Refunded',
      'Status',
    ],
    ...rows.map((o) => [
      o.orderNumber,
      new Date(o.createdAt).toISOString(),
      o.attendeeName,
      o.attendeeEmail,
      o.buyerName,
      o.event.title,
      new Date(o.event.startDate).toISOString().slice(0, 10),
      o.ticketCount,
      taka(o.subtotalMinor),
      taka(o.discountMinor),
      taka(o.platformFeeMinor),
      taka(o.totalMinor),
      taka(o.refundedMinor),
      statusLabel(o.paymentStatus),
    ]),
  ]
  const csv = table.map((row) => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `ticketbd-orders-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast.success(`${rows.length} order${rows.length === 1 ? '' : 's'} exported`)
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    // Clipboard access is refused outside a secure context and in some
    // embedded webviews. Say so rather than appearing to succeed.
    toast.error('Could not reach the clipboard — copy it by hand')
  }
}

// ------------------------------------------------------------ distribution

/**
 * How the orders in scope are spread across payment states.
 *
 * A stacked bar rather than another row of figures, because the useful reading
 * here is a proportion — "essentially everything is paid" against "a fifth are
 * stuck" — and that is a shape. The numbers themselves are on the chips below.
 */
function StatusDistribution({
  counts,
  total,
}: {
  counts: Record<string, number>
  total: number
}) {
  const present = STATUSES.filter((s) => (counts[s] ?? 0) > 0)
  if (total === 0 || present.length === 0) return null

  return (
    <div className="relative mt-6">
      <Eyebrow>Order states</Eyebrow>
      <div
        className="mt-2 flex h-2 gap-0.5"
        role="img"
        aria-label={`${total} orders in total: ${present
          .map((s) => `${counts[s]} ${statusLabel(s).toLowerCase()}`)
          .join(', ')}`}
      >
        {present.map((s) => (
          <span
            key={s}
            title={`${statusLabel(s)}: ${counts[s]}`}
            className={cn(
              'h-full min-w-[3px] rounded-full transition-[width] duration-500 motion-reduce:transition-none',
              STATUS_FILL[s],
            )}
            style={{ width: `${(counts[s] / total) * 100}%` }}
          />
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ sorting

function SortHeader({
  children,
  sortKey,
  sort,
  onSort,
  className,
}: {
  children: React.ReactNode
  sortKey: SortKey
  sort: Sort
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = sort.key === sortKey
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-4 py-2.5 font-medium', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'group/sort inline-flex cursor-pointer items-center gap-1 rounded transition-colors',
          'hover:text-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          active && 'text-foreground',
        )}
      >
        {children}
        <Icon
          className={cn(
            'size-3 transition-opacity',
            active ? 'opacity-100' : 'opacity-0 group-hover/sort:opacity-60',
          )}
          aria-hidden="true"
        />
      </button>
    </th>
  )
}

// ------------------------------------------------------------------- detail

function MoneyLine({
  label,
  value,
  hint,
  strong,
}: {
  label: string
  value: string
  hint?: string
  strong?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-2',
        strong && 'border-border/70 border-t pt-2.5',
      )}
    >
      <dt className={cn('text-sm', strong ? 'font-medium' : 'text-muted-foreground')}>
        {label}
        {hint && <span className="text-muted-foreground mt-0.5 block text-xs">{hint}</span>}
      </dt>
      <dd className={cn('shrink-0 text-sm tabular-nums', strong && 'font-semibold')}>{value}</dd>
    </div>
  )
}

/**
 * Everything known about one order, from the row already in hand — no second
 * request. The money block is the point of the panel: a support reply needs the
 * exact split, and these lines are the identity the `Order` table enforces
 * (`total = subtotal - discount + fee`) rather than a fresh re-derivation.
 */
function OrderDetail({ order }: { order: OrderRow }) {
  // What this order is worth to the organizer: the ticket money, with the
  // platform fee stripped out because that fee was never theirs. Whether a
  // refund came out of their share or ours is recorded against the refund, not
  // the order — so this is stated before refunds, and the refund gets its own
  // line rather than being netted off with a number nobody can verify here.
  const shareMinor = order.subtotalMinor - order.discountMinor
  const differentBuyer = Boolean(order.buyerName) && order.buyerName !== order.attendeeName

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6">
      <div className="flex flex-wrap items-center gap-2">
        <PaymentStatusBadge status={order.paymentStatus} />
        <Badge variant="outline" className="font-normal tabular-nums">
          {order.ticketCount} {order.ticketCount === 1 ? 'ticket' : 'tickets'}
        </Badge>
      </div>

      <p className="text-muted-foreground mt-3 text-xs tabular-nums">
        Placed {formatEventDate(order.createdAt)} at {formatDateTimeTime(order.createdAt)}
      </p>

      {/* ------------------------------------------------------------ money */}
      <section aria-labelledby="od-money" className="mt-6">
        <Eyebrow id="od-money">The money</Eyebrow>
        <dl className="mt-2">
          <MoneyLine label="Tickets" value={formatMinor(order.subtotalMinor)} />
          {order.discountMinor > 0 && (
            <MoneyLine label="Discount" value={`−${formatMinor(order.discountMinor)}`} />
          )}
          <MoneyLine
            label="Platform fee"
            hint="3%, added at checkout and paid by the buyer"
            value={`+${formatMinor(order.platformFeeMinor)}`}
          />
          <MoneyLine label="Buyer paid" value={formatMinor(order.totalMinor)} strong />
        </dl>

        <div className="bg-primary/[0.07] mt-4 rounded-xl p-4">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-sm font-medium">Your share</p>
            <p className="text-base font-semibold tabular-nums">{formatMinor(shareMinor)}</p>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {order.paymentStatus === 'PAID'
              ? 'Ticket money less any discount, before refunds.'
              : 'Nothing is owed to you until this order is paid.'}
          </p>
        </div>

        {order.refundedMinor > 0 && (
          <div className="border-border/70 mt-2 rounded-xl border p-4">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-sm font-medium">Refunded to buyer</p>
              <p className="text-base font-semibold tabular-nums">
                −{formatMinor(order.refundedMinor)}
              </p>
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              How much of this came out of your share is held against the refund itself, not the
              order.
            </p>
          </div>
        )}
      </section>

      {/* --------------------------------------------------------- attendee */}
      <section aria-labelledby="od-who" className="mt-6">
        <Eyebrow id="od-who">Who it is for</Eyebrow>
        <div className="mt-2 flex items-center gap-3">
          <span
            className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-semibold"
            aria-hidden="true"
          >
            {initials(order.attendeeName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{order.attendeeName}</p>
            <a
              href={`mailto:${order.attendeeEmail}`}
              className="text-muted-foreground hover:text-primary block truncate text-xs transition-colors hover:underline"
            >
              {order.attendeeEmail}
            </a>
          </div>
        </div>
        {differentBuyer && (
          <p className="text-muted-foreground mt-2.5 text-xs">
            Bought by <span className="text-foreground font-medium">{order.buyerName}</span> — the
            tickets were issued to someone else, so reply to the attendee above.
          </p>
        )}
        <Button asChild variant="outline" size="sm" className="mt-3">
          <a
            href={`mailto:${order.attendeeEmail}?subject=${encodeURIComponent(
              `Your order ${order.orderNumber} — ${order.event.title}`,
            )}`}
          >
            <Mail /> Email attendee
          </a>
        </Button>
      </section>

      {/* ------------------------------------------------------------ event */}
      <section aria-labelledby="od-event" className="mt-6">
        <Eyebrow id="od-event">Event</Eyebrow>
        <p className="mt-2 text-sm font-medium text-pretty">{order.event.title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
          {formatEventDate(order.event.startDate)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={paths.organizerEvent(order.event.id)}>
              <BarChart3 /> Event analytics
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={paths.event(order.event)}>
              <ExternalLink /> Public page
            </Link>
          </Button>
        </div>
      </section>
    </div>
  )
}

// --------------------------------------------------------------------- page

export function OrganizerOrders({
  initialStatus,
  initialSearch,
  initialEventId,
}: {
  initialStatus: string
  initialSearch: string
  initialEventId: string
}) {
  const [status, setStatus] = useState(initialStatus)
  const [eventId, setEventId] = useState(initialEventId)
  const [search, setSearch] = useState(initialSearch)
  const [sort, setSort] = useState<Sort>({ key: 'createdAt', dir: 'desc' })
  const [openId, setOpenId] = useState<string | null>(null)
  const debounced = useDebounced(search)
  useUrlQuery(paths.organizerOrders({ status, q: debounced, eventId }))

  const { data, isLoading } = useQuery({
    queryKey: ['organizer-orders', status, debounced, eventId],
    queryFn: () => {
      const p = new URLSearchParams()
      if (status !== 'ALL') p.set('status', status)
      if (eventId !== 'ALL') p.set('eventId', eventId)
      if (debounced) p.set('q', debounced)
      const qs = p.toString()
      return apiGet<OrdersResponse>(`/api/organizer/orders${qs ? `?${qs}` : ''}`)
    },
  })

  /**
   * Options for the event picker. Shares its cache key with `/organizer`,
   * `/organizer/analytics` and `/organizer/payouts`, so arriving here from any
   * of them fills the picker from cache instead of waiting on a request.
   */
  const { data: eventsData } = useQuery({
    queryKey: ['organizer-analytics'],
    queryFn: () => apiGet<EventsResponse>('/api/organizer/analytics'),
  })

  const counts = data?.counts ?? {}
  const inScope = Object.values(counts).reduce((a, b) => a + b, 0)
  const paidCount = counts.PAID ?? 0
  const grossMinor = data?.grossMinor ?? 0

  const events = useMemo(
    () =>
      [...(eventsData?.events ?? [])].sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      ),
    [eventsData],
  )

  /**
   * Sorted here rather than on the server: the endpoint returns at most 200
   * rows and they are all in hand, so re-ordering them is instant and costs no
   * request. The footnote under the table says as much, because sorting a
   * truncated window by value is not the same as sorting every order the
   * organizer has ever taken.
   */
  const orders = useMemo(() => {
    const rows = [...(data?.orders ?? [])]
    const factor = sort.dir === 'asc' ? 1 : -1
    return rows.sort((a, b) => {
      if (sort.key === 'createdAt') {
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * factor
      }
      return (a[sort.key] - b[sort.key]) * factor
    })
  }, [data?.orders, sort])

  const openOrder = openId ? (orders.find((o) => o.id === openId) ?? null) : null
  const narrowed = status !== 'ALL' || eventId !== 'ALL' || Boolean(search)

  /**
   * `ALL` plus every state that actually occurs. `PAID` and `PENDING` stay
   * regardless: an organizer looking for the money-in and money-owed filters
   * should find them where they always are, not have them appear and vanish
   * with the data.
   */
  const filters: FilterOption[] = [
    { value: 'ALL', label: 'All', count: inScope },
    ...STATUSES.filter((s) => (counts[s] ?? 0) > 0 || s === 'PAID' || s === 'PENDING').map((s) => ({
      value: s,
      label: statusLabel(s),
      count: counts[s] ?? 0,
      dotClass: STATUS_FILL[s],
    })),
  ]

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))

  const clearFilters = () => {
    setStatus('ALL')
    setEventId('ALL')
    setSearch('')
  }

  return (
    <div className="space-y-6">
      {/* ----------------------------------------------------------- ledger */}
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroMetric
          label="Collected from buyers"
          value={formatMinor(grossMinor)}
          hint={
            isLoading
              ? undefined
              : `${paidCount} paid order${paidCount === 1 ? '' : 's'} · includes the 3% platform fee`
          }
          loading={isLoading}
          icon={Receipt}
          {...entrance(0)}
          className={cn('lg:col-span-2', entrance(0).className)}
        >
          {!isLoading && <StatusDistribution counts={counts} total={inScope} />}
          {/* Both figures an organizer might mistake this one for, one click
              away and named, rather than a second definition of "net" here. */}
          <div className="relative mt-5 flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={paths.organizer()}>
                What you earned <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={paths.organizerAnalytics()}>
                Per-event breakdown <ArrowRight />
              </Link>
            </Button>
          </div>
        </HeroMetric>

        <div {...entrance(1)}>
          <MetricGroup
            title={eventId === 'ALL' ? 'Across all events' : 'This event'}
            loading={isLoading}
            items={[
              { label: 'Paid orders', value: paidCount },
              {
                label: 'Average paid order',
                value: paidCount > 0 ? formatMinor(Math.round(grossMinor / paidCount)) : '—',
              },
              { label: 'Refunded to buyers', value: formatMinor(data?.refundedMinor ?? 0) },
            ]}
          />
        </div>
      </div>

      {/* ----------------------------------------------------------- orders */}
      <section
        aria-labelledby="orders-heading"
        {...entrance(2)}
        className={cn('space-y-4', entrance(2).className)}
      >
        <SectionHeading
          id="orders-heading"
          title="Orders"
          description="Find one by number, buyer or attendee — then open it for the full breakdown."
        >
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Order number, name or email"
              label="Search orders"
            />
            <Select value={eventId} onValueChange={setEventId}>
              <SelectTrigger className="w-full sm:w-52" aria-label="Filter by event">
                <SelectValue placeholder="All events" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="ALL">All events</SelectItem>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    <span className="truncate">{e.title}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </SectionHeading>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <FilterChips
            value={status}
            onChange={setStatus}
            options={filters}
            label="Payment status"
          />
          <div className="flex items-center gap-2">
            {/* The table sorts from its own column headers. This is the same
                state, exposed at the widths where those headers do not exist. */}
            <Select
              value={`${sort.key}:${sort.dir}`}
              onValueChange={(v) => {
                const [key, dir] = v.split(':')
                setSort({ key: key as SortKey, dir: dir as Sort['dir'] })
              }}
            >
              <SelectTrigger
                className="h-8 w-auto gap-1 rounded-full px-3 text-xs lg:hidden"
                aria-label="Sort orders"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {SORT_CHOICES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-8 active:scale-[0.98] motion-reduce:transform-none"
              onClick={() => exportCsv(orders)}
              disabled={orders.length === 0}
            >
              <Download /> Export
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Panel padded={false} className="divide-border/60 divide-y">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="hidden h-4 flex-1 sm:block" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            ))}
          </Panel>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={Ticket}
            title={narrowed ? 'No orders match this' : 'No orders yet'}
            description={
              narrowed
                ? 'Nothing here fits the current search and filters.'
                : 'Orders appear the moment somebody buys a ticket to one of your events.'
            }
            action={
              narrowed ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild size="sm">
                  <Link href={paths.organizerEvents()}>
                    Your events <ArrowRight />
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <>
            {/* ------------------------------------------------ table (lg+) */}
            <Panel padded={false} className="hidden overflow-hidden lg:block">
              {/* Scrolls inside its own container, so the page itself never
                  scrolls sideways however narrow the window gets. */}
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-muted/70 text-muted-foreground sticky top-0 z-10 text-left text-xs uppercase backdrop-blur">
                    <tr className="border-border/70 border-b">
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Order
                      </th>
                      <SortHeader sortKey="createdAt" sort={sort} onSort={toggleSort}>
                        Placed
                      </SortHeader>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Attendee
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Event
                      </th>
                      <SortHeader
                        sortKey="ticketCount"
                        sort={sort}
                        onSort={toggleSort}
                        className="text-center"
                      >
                        Tickets
                      </SortHeader>
                      <SortHeader
                        sortKey="totalMinor"
                        sort={sort}
                        onSort={toggleSort}
                        className="text-right"
                      >
                        Buyer paid
                      </SortHeader>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Status
                      </th>
                      <th scope="col" className="w-10 px-2 py-2.5">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-border/60 divide-y">
                    {orders.map((o) => (
                      /* The whole row is the target, and the handler sits here
                         rather than on the button inside it — so a mouse click
                         and a keyboard Enter on that button both arrive exactly
                         once, as the click bubbles up. */
                      <tr
                        key={o.id}
                        onClick={() => setOpenId(o.id)}
                        className="group hover:bg-muted/40 has-[:focus-visible]:bg-muted/40 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="focus-visible:ring-ring group-hover:text-primary cursor-pointer rounded font-mono text-[13px] font-medium tracking-tight tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none"
                            aria-label={`Order ${o.orderNumber}, ${formatMinor(o.totalMinor)}, ${statusLabel(o.paymentStatus)} — open details`}
                          >
                            {o.orderNumber}
                          </button>
                        </td>
                        <td className="text-muted-foreground px-4 py-3 whitespace-nowrap tabular-nums">
                          {formatDateShort(o.createdAt)}
                          <span className="ml-1.5 text-xs opacity-80">
                            {formatDateTimeTime(o.createdAt)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="max-w-[180px] truncate">{o.attendeeName}</p>
                          <p className="text-muted-foreground max-w-[180px] truncate text-xs">
                            {o.attendeeEmail}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-muted-foreground max-w-[200px] truncate">
                            {o.event.title}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-center tabular-nums">{o.ticketCount}</td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-medium tabular-nums">{formatMinor(o.totalMinor)}</p>
                          {o.refundedMinor > 0 && (
                            <p className="text-muted-foreground text-xs tabular-nums">
                              −{formatMinor(o.refundedMinor)} refunded
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <PaymentStatusBadge status={o.paymentStatus} />
                        </td>
                        <td className="px-2 py-3">
                          <ChevronRight
                            className="text-muted-foreground/60 group-hover:text-foreground size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
                            aria-hidden="true"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* ---------------------------------------------- cards (< lg) */}
            {/* Not the same table behind a scrollbar: a phone-width order is
                read top to bottom, and a sideways-scrolling table hides the
                columns that matter most behind a gesture. */}
            <ul className="space-y-2 lg:hidden">
              {orders.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(o.id)}
                    className={cn(
                      'border-border/70 bg-card shadow-primary/[0.04] w-full cursor-pointer rounded-2xl border p-4 text-left shadow-sm',
                      'hover:bg-muted/40 transition-colors active:scale-[0.99] motion-reduce:transform-none',
                      'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-semibold"
                        aria-hidden="true"
                      >
                        {initials(o.attendeeName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{o.attendeeName}</p>
                        <p className="text-muted-foreground truncate font-mono text-[11px] tabular-nums">
                          {o.orderNumber}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums">
                          {formatMinor(o.totalMinor)}
                        </p>
                        <p className="text-muted-foreground text-[11px] tabular-nums">
                          {formatDateShort(o.createdAt)}
                        </p>
                      </div>
                    </div>
                    <p className="text-muted-foreground mt-2.5 truncate text-xs">{o.event.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <PaymentStatusBadge status={o.paymentStatus} />
                      <Badge variant="outline" className="font-normal tabular-nums">
                        {o.ticketCount} {o.ticketCount === 1 ? 'ticket' : 'tickets'}
                      </Badge>
                      {o.refundedMinor > 0 && (
                        <Badge variant="outline" className="font-normal tabular-nums">
                          −{formatMinor(o.refundedMinor)} refunded
                        </Badge>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span className="tabular-nums">
                {orders.length} order{orders.length === 1 ? '' : 's'} shown,{' '}
                {SORT_SENTENCE[`${sort.key}:${sort.dir}`]}.
                {data?.truncated &&
                  ' This is the most recent 200 — sorting reorders those, so narrow the search to reach older ones.'}
              </span>
            </p>
          </>
        )}
      </section>

      {/* ------------------------------------------------------ order panel */}
      <Sheet open={Boolean(openOrder)} onOpenChange={(open) => !open && setOpenId(null)}>
        {/* The panel's own headings describe it; `aria-describedby={undefined}`
            tells Radix so, rather than leaving it to warn about a missing
            description on every open. */}
        <SheetContent className="w-full gap-0 sm:max-w-md" aria-describedby={undefined}>
          {openOrder && (
            <>
              <SheetHeader className="pr-12 pb-2">
                <Eyebrow>Order</Eyebrow>
                <div className="flex items-center gap-2">
                  <SheetTitle className="font-mono text-lg tracking-tight tabular-nums">
                    {openOrder.orderNumber}
                  </SheetTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    onClick={() => copyText(openOrder.orderNumber, 'Order number')}
                  >
                    <Copy className="size-3.5" />
                    <span className="sr-only">Copy order number</span>
                  </Button>
                </div>
              </SheetHeader>
              <OrderDetail order={openOrder} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
