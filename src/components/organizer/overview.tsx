'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BanknoteArrowUp,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Compass,
  ScanLine,
  Sparkles,
  Ticket,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { OrganizerStats } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CategoryIcon } from '@/components/app/category-icon'
import { EventStatusBadge } from '@/components/dashboard/status-badges'
import {
  DeltaChip,
  Eyebrow,
  HeroMetric,
  Meter,
  MetricGroup,
  Panel,
  SectionHeading,
  entrance,
} from '@/components/dashboard/primitives'

/**
 * The organizer's landing surface.
 *
 * This page has one job, and it is not reporting: an organizer decides here
 * whether to run their next event on TicketBD. So it leads with the two things
 * that answer that — **what they earned** and **how much of that they can
 * actually take out** — then shows how their events performed against each
 * other, and only then lists what needs doing.
 *
 * It deliberately does not open with gross revenue. Gross is the platform's
 * vanity number; net earnings and a withdrawable balance are the organizer's.
 */

interface EventRow {
  id: string
  slug: string | null
  title: string
  status: string
  category: string
  startDate: string
  capacity: number
  sold: number
  orders: number
  grossMinor: number
  refundedMinor: number
  netMinor: number
  checkedIn: number
  attendanceRate: number | null
}

interface AnalyticsResponse {
  events: EventRow[]
  totals: {
    events: number
    capacity: number
    sold: number
    orders: number
    grossMinor: number
    refundedMinor: number
    netMinor: number
    platformFeeMinor: number
    checkedIn: number
  }
}

interface WalletResponse {
  balances: {
    availableMinor: number
    pendingMinor: number
    paidMinor: number
    nextMaturityAt: string | null
  }
  policy: { holdDays: number; minPayoutMinor: number }
}

const pct = (n: number) => `${Math.round(n * 100)}%`

/**
 * Change in net earnings from one event to the one before it.
 *
 * The only honest period-over-period comparison available: nothing in the
 * schema snapshots history, so there is no "vs last month" to show. Two events
 * that actually sold something is the minimum — and a zero baseline is skipped
 * rather than reported as an infinite rise.
 */
function previousEventDelta(events: EventRow[]): number | null {
  const sold = events
    .filter((e) => e.sold > 0)
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
  if (sold.length < 2) return null
  const [latest, previous] = sold
  if (previous.netMinor <= 0) return null
  return (latest.netMinor - previous.netMinor) / previous.netMinor
}

/** One row of the event comparison. */
function EventPerformanceRow({ event }: { event: EventRow }) {
  return (
    <li className="group relative">
      <Link
        href={paths.organizerEvent(event.id)}
        className={cn(
          'flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl px-3 py-3 transition-colors sm:flex-nowrap',
          'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <CategoryIcon category={event.category} className="size-4" />
        </span>

        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{event.title}</span>
            <EventStatusBadge status={event.status} />
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {formatEventDate(event.startDate)}
          </span>
        </span>

        {/* Sell-through is the platform's own value-add, so it gets the meter. */}
        <span className="w-full min-w-0 sm:w-40">
          <span className="flex items-baseline justify-between gap-2 text-xs">
            <span className="tabular-nums">
              {event.sold}
              <span className="text-muted-foreground">/{event.capacity} sold</span>
            </span>
            <span className="text-muted-foreground tabular-nums">
              {event.capacity > 0 ? pct(event.sold / event.capacity) : '—'}
            </span>
          </span>
          <Meter
            className="mt-1.5"
            value={event.sold}
            max={event.capacity}
            label={`${event.title}: ${event.sold} of ${event.capacity} tickets sold`}
          />
        </span>

        <span className="shrink-0 text-right sm:w-28">
          <span className="block text-sm font-semibold tabular-nums">
            {formatMinor(event.netMinor)}
          </span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {event.attendanceRate === null ? 'No arrivals yet' : `${pct(event.attendanceRate)} turned up`}
          </span>
        </span>

        <ArrowRight
          className="hidden size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none sm:block"
          aria-hidden="true"
        />
      </Link>
    </li>
  )
}

function NextStep({
  icon: Icon,
  title,
  body,
  cta,
  href,
  tone = 'default',
}: {
  icon: LucideIcon
  title: string
  body: string
  cta?: string
  href?: string
  tone?: 'default' | 'attention' | 'done'
}) {
  return (
    <li className="flex flex-wrap items-start gap-3 py-3.5 first:pt-0 last:pb-0">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          tone === 'attention' && 'bg-chart-5/20 text-foreground',
          tone === 'done' && 'bg-primary/10 text-primary',
          tone === 'default' && 'bg-muted text-muted-foreground',
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
      </div>
      {cta && href && (
        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-8 active:scale-[0.98] motion-reduce:transform-none"
        >
          <Link href={href}>
            {cta} <ArrowRight />
          </Link>
        </Button>
      )}
    </li>
  )
}

/**
 * First run. A brand-new organizer would otherwise land on a wall of ৳0 —
 * the worst possible first impression on the one screen meant to convince them
 * to list an event.
 */
function FirstRun({ approved }: { approved: boolean }) {
  return (
    <Panel
      {...entrance(0)}
      className={cn('relative overflow-hidden p-6 sm:p-8', entrance(0).className)}
    >
      <div
        className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative max-w-xl">
        <Eyebrow>Welcome to TicketBD</Eyebrow>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-pretty sm:text-3xl">
          Put your first event on sale
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Three steps, and there is no cost to list. We take 3% of each ticket sold, deducted at
          checkout — nothing up front, and nothing at all if you sell nothing.
        </p>

        <ol className="mt-6 space-y-4">
          {[
            {
              icon: CalendarPlus,
              title: 'Add the event and its tickets',
              body: 'Date, venue and at least one ticket type. Save a draft and finish later if you want.',
            },
            {
              icon: approved ? CheckCircle2 : Clock,
              title: approved ? 'Publish it' : 'We approve your account',
              body: approved
                ? 'It appears in search and on the browse page straight away.'
                : 'Usually within a day. You can draft events while you wait.',
            },
            {
              icon: ScanLine,
              title: 'Scan at the door',
              body: 'Add gate staff and they check attendees in from their own phone. No hardware.',
            },
          ].map((step, i) => (
            <li key={step.title} className="flex items-start gap-3">
              <span
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-7 flex flex-wrap gap-2">
          <Button asChild size="lg" className="active:scale-[0.98] motion-reduce:transform-none">
            <Link href={`${paths.organizerEvents()}?new=1`}>
              <CalendarPlus /> Create your first event
            </Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link href={paths.events()}>
              <Compass /> See how others list
            </Link>
          </Button>
        </div>
      </div>
    </Panel>
  )
}

export function Overview() {
  const user = useAppStore((s) => s.user)

  const statsQuery = useQuery({
    queryKey: ['organizer-stats'],
    queryFn: () => apiGet<{ stats: OrganizerStats }>('/api/organizer/stats'),
  })
  // Shares its cache key with /organizer/analytics and /organizer/payouts, so
  // moving between those sections is instant rather than a second fetch.
  const analyticsQuery = useQuery({
    queryKey: ['organizer-analytics'],
    queryFn: () => apiGet<AnalyticsResponse>('/api/organizer/analytics'),
  })
  const walletQuery = useQuery({
    queryKey: ['organizer-wallet'],
    queryFn: () => apiGet<WalletResponse>('/api/organizer/wallet'),
  })

  const isLoading = statsQuery.isLoading || analyticsQuery.isLoading
  const s = statsQuery.data?.stats
  const totals = analyticsQuery.data?.totals
  const events = analyticsQuery.data?.events ?? []
  const balances = walletQuery.data?.balances
  const holdDays = walletQuery.data?.policy.holdDays ?? 7

  const totalEvents = s?.totalEvents ?? 0
  const activeEvents = s?.activeEvents ?? 0
  const pending = s?.pendingApprovals ?? 0
  const ticketsSold = totals?.sold ?? s?.ticketsSold ?? 0
  const checkIns = totals?.checkedIn ?? s?.checkIns ?? 0
  const capacity = totals?.capacity ?? 0
  const netMinor = totals?.netMinor ?? s?.revenueMinor ?? 0
  const approved = user?.organizer?.status === 'APPROVED'

  const delta = previousEventDelta(events)
  const sellThrough = capacity > 0 ? ticketsSold / capacity : null
  const attendance = ticketsSold > 0 ? checkIns / ticketsSold : null

  // Newest first — the last event is the one an organizer judges the platform on.
  const recent = [...events]
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
    .slice(0, 5)

  const availableMinor = balances?.availableMinor ?? 0

  /**
   * Built as data rather than inline JSX so "nothing is waiting" can be a real
   * state. Rendered inline, an all-false set of conditions produced an empty
   * bordered box with no explanation.
   */
  const steps: Array<React.ComponentProps<typeof NextStep>> = []
  if (!approved) {
    steps.push({
      icon: Clock,
      tone: 'attention',
      title: 'Your account is awaiting approval',
      body: 'Draft events now; publishing and gate staff unlock as soon as an admin approves you.',
    })
  }
  if (pending > 0) {
    steps.push({
      icon: Clock,
      tone: 'attention',
      title: `${pending} event${pending === 1 ? '' : 's'} awaiting admin approval`,
      body: 'Not visible to customers yet. Approval usually follows within a day.',
      cta: 'View',
      href: paths.organizerEvents('PENDING_APPROVAL'),
    })
  }
  if (activeEvents > 0 && ticketsSold === 0) {
    steps.push({
      icon: Ticket,
      title: 'No tickets sold yet',
      body: "Share the event link — most first sales come from the organizer's own audience.",
      cta: 'Events',
      href: paths.organizerEvents(),
    })
  }
  if (activeEvents > 0 && ticketsSold > 0 && checkIns === 0) {
    steps.push({
      icon: ScanLine,
      title: 'Make sure gate staff are assigned',
      body: 'Nobody has checked in yet. Confirm each live event has at least one staff account.',
      cta: 'Staff',
      href: paths.organizerStaff(),
    })
  }
  if (availableMinor > 0) {
    steps.push({
      icon: BanknoteArrowUp,
      tone: 'done',
      title: `${formatMinor(availableMinor)} is ready to withdraw`,
      body: 'Cleared earnings, waiting on a payout request.',
      cta: 'Withdraw',
      href: paths.organizerPayouts(),
    })
  }
  if (activeEvents === 0 && pending === 0) {
    steps.push({
      icon: Sparkles,
      title: 'No events are live right now',
      body: 'Submit a draft for approval, or create the next one.',
      cta: 'Events',
      href: paths.organizerEvents(),
    })
  }

  if (!isLoading && totalEvents === 0) {
    return (
      <div className="space-y-6">
        <FirstRun approved={approved} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- money */}
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroMetric
          label="Net earnings"
          icon={Wallet}
          loading={isLoading}
          value={formatMinor(netMinor)}
          delta={delta === null ? undefined : <DeltaChip ratio={delta} since="vs previous event" />}
          hint={
            isLoading
              ? undefined
              : `After refunds and our 3% fee · ${ticketsSold} ticket${ticketsSold === 1 ? '' : 's'} sold`
          }
          {...entrance(0)}
          className={cn('lg:col-span-2', entrance(0).className)}
        >
          <div className="relative mt-5 flex flex-wrap items-center gap-2">
            <Button asChild className="active:scale-[0.98] motion-reduce:transform-none">
              <Link href={paths.organizerPayouts()}>
                <BanknoteArrowUp /> Withdraw earnings
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href={paths.organizerAnalytics()}>
                Full breakdown <ArrowRight />
              </Link>
            </Button>
          </div>
        </HeroMetric>

        <div {...entrance(1)}>
          <MetricGroup
            title="Your balance"
            loading={walletQuery.isLoading}
            items={[
              { label: 'Available now', value: formatMinor(balances?.availableMinor ?? 0) },
              { label: `Clearing (${holdDays}d hold)`, value: formatMinor(balances?.pendingMinor ?? 0) },
              { label: 'Paid out to date', value: formatMinor(balances?.paidMinor ?? 0) },
            ]}
          />
        </div>
      </div>

      {/* -------------------------------------------------------- performance */}
      <section
        aria-labelledby="performance-heading"
        {...entrance(2)}
        className={cn('space-y-4', entrance(2).className)}
      >
        <SectionHeading
          id="performance-heading"
          title="How your events performed"
          description="Newest first, so the last one you ran is the first thing you see."
        >
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link href={paths.organizerAnalytics()}>
              All events <ArrowRight />
            </Link>
          </Button>
        </SectionHeading>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              label: 'Sell-through',
              value: sellThrough === null ? '—' : pct(sellThrough),
              body: sellThrough === null ? 'No tickets on sale yet' : `${ticketsSold} of ${capacity} tickets`,
              ratio: sellThrough,
              of: capacity,
              at: ticketsSold,
            },
            {
              label: 'Turned up',
              value: attendance === null ? '—' : pct(attendance),
              body: attendance === null ? 'Nobody has checked in yet' : `${checkIns} of ${ticketsSold} attendees`,
              ratio: attendance,
              of: ticketsSold,
              at: checkIns,
            },
            {
              label: 'Live right now',
              value: activeEvents,
              body:
                pending > 0
                  ? `${pending} awaiting approval`
                  : `${totalEvents} event${totalEvents === 1 ? '' : 's'} in total`,
              ratio: null,
              of: 0,
              at: 0,
            },
          ].map((tile) => (
            <Panel key={tile.label} className="p-5">
              <Eyebrow>{tile.label}</Eyebrow>
              {isLoading ? (
                <Skeleton className="mt-2 h-8 w-20" />
              ) : (
                <p className="mt-2 text-2xl font-semibold tracking-tight">{tile.value}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">{tile.body}</p>
              {tile.ratio !== null && (
                <Meter className="mt-3" value={tile.at} max={tile.of} label={`${tile.label}: ${tile.body}`} />
              )}
            </Panel>
          ))}
        </div>

        {isLoading ? (
          <Panel padded={false} className="divide-y divide-border/70 p-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 px-3 py-3">
                <Skeleton className="size-9 rounded-xl" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </Panel>
        ) : recent.length > 0 ? (
          <Panel padded={false} className="p-2">
            <ul className="divide-y divide-border/70">
              {recent.map((e) => (
                <EventPerformanceRow key={e.id} event={e} />
              ))}
            </ul>
          </Panel>
        ) : null}
      </section>

      {/* ------------------------------------------------------------ next up */}
      <section
        aria-labelledby="next-heading"
        {...entrance(3)}
        className={cn('space-y-4', entrance(3).className)}
      >
        <SectionHeading
          id="next-heading"
          title="What needs you"
          description="Derived from your own events — this list is empty when nothing is waiting."
        >
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="active:scale-[0.98] motion-reduce:transform-none">
              <Link href={`${paths.organizerEvents()}?new=1`}>
                <CalendarPlus /> Create event
              </Link>
            </Button>
          </div>
        </SectionHeading>

        <Panel>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : steps.length === 0 ? (
            <div className="flex items-center gap-3 py-1">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
                aria-hidden="true"
              >
                <CheckCircle2 className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium">Nothing needs you right now</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Events are live, staff are assigned and there is no balance waiting.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border/70">
              {steps.map((step) => (
                <NextStep key={step.title} {...step} />
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </div>
  )
}