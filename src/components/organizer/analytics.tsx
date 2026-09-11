'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { BarChart3, ChevronRight, TrendingUp } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/app/empty-state'
import {
  Eyebrow,
  HeroMetric,
  Meter,
  MetricGroup,
  Panel,
  SectionHeading,
  entrance,
} from '@/components/dashboard/primitives'
import { EventStatusBadge } from '@/components/dashboard/status-badges'
import { CategoryIcon } from '@/components/app/category-icon'

interface EventAnalyticsRow {
  id: string
  slug: string | null
  title: string
  status: string
  category: string
  startDate: string
  endDate: string
  capacity: number
  sold: number
  available: number
  sellThrough: number
  orders: number
  grossMinor: number
  refundedMinor: number
  netMinor: number
  platformFeeMinor: number
  potentialMinor: number
  checkedIn: number
  attendanceRate: number | null
}

interface AnalyticsResponse {
  events: EventAnalyticsRow[]
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

const pct = (n: number) => `${Math.round(n * 100)}%`

/**
 * How the comparison is ordered.
 *
 * "Compare your events side by side" is the whole point of this table, and a
 * comparison you cannot reorder only answers the question the default happens
 * to match. Date stays the default so the list still reads as a timeline.
 */
const SORTS = {
  recent: { label: 'Most recent', pick: (e: EventAnalyticsRow) => new Date(e.startDate).getTime() },
  revenue: { label: 'Net revenue', pick: (e: EventAnalyticsRow) => e.netMinor },
  sellThrough: { label: 'Sell-through', pick: (e: EventAnalyticsRow) => e.sellThrough },
  sold: { label: 'Tickets sold', pick: (e: EventAnalyticsRow) => e.sold },
  attendance: { label: 'Turnout', pick: (e: EventAnalyticsRow) => e.attendanceRate ?? -1 },
} as const

type SortKey = keyof typeof SORTS

/** Sell-through as a bar, because a row of percentages is hard to compare. */
function SellThrough({ sold, capacity }: { sold: number; capacity: number }) {
  const ratio = capacity > 0 ? Math.min(sold / capacity, 1) : 0
  return (
    <div className="min-w-[120px]">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="tabular-nums">
          {sold}
          <span className="text-muted-foreground">/{capacity}</span>
        </span>
        <span className="text-muted-foreground tabular-nums">{pct(ratio)}</span>
      </div>
      <Meter
        className="mt-1"
        value={sold}
        max={capacity}
        label={`${sold} of ${capacity} tickets sold`}
      />
    </div>
  )
}

export function OrganizerAnalytics() {
  const [sort, setSort] = useState<SortKey>('recent')

  const { data, isLoading } = useQuery({
    queryKey: ['organizer-analytics'],
    queryFn: () => apiGet<AnalyticsResponse>('/api/organizer/analytics'),
  })

  const t = data?.totals

  const events = useMemo(() => {
    const rows = data?.events ?? []
    const { pick } = SORTS[sort]
    // Copy first: the query cache's array must not be sorted in place.
    return [...rows].sort((a, b) => pick(b) - pick(a))
  }, [data?.events, sort])

  /**
   * Ceiling revenue across every event, at list price.
   *
   * The API computes `potentialMinor` per event precisely because it is "what
   * makes the sell-through figure meaningful", but `totals` does not carry it
   * and nothing rendered it — so the headline number had no scale to sit
   * against. Summed here rather than guessed.
   */
  const potentialMinor = useMemo(
    () => (data?.events ?? []).reduce((sum, e) => sum + e.potentialMinor, 0),
    [data?.events],
  )

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroMetric
          label="Net revenue"
          value={formatMinor(t?.netMinor ?? 0)}
          hint={
            t
              ? `${formatMinor(t.grossMinor)} collected, less ${formatMinor(t.refundedMinor)} refunded`
              : undefined
          }
          loading={isLoading}
          icon={TrendingUp}
          {...entrance(0)}
          className={cn('lg:col-span-2', entrance(0).className)}
        >
          {/* Net against the list-price ceiling: the figure alone says nothing
              about whether it was a good result. */}
          {!isLoading && potentialMinor > 0 && (
            <div className="relative mt-4">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <Eyebrow className="text-[10px]">Against list-price ceiling</Eyebrow>
                <span className="font-semibold tabular-nums">
                  {pct(Math.min((t?.netMinor ?? 0) / potentialMinor, 1))}
                </span>
              </div>
              <Meter
                className="mt-1.5"
                value={t?.netMinor ?? 0}
                max={potentialMinor}
                label={`${formatMinor(t?.netMinor ?? 0)} of ${formatMinor(potentialMinor)} possible at list price`}
                // Earning more is good news, so this bar must not flip to the
                // warning tone the way an inventory bar does.
                hot={1.1}
              />
              <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                {formatMinor(potentialMinor)} if every ticket sold at list price
              </p>
            </div>
          )}
        </HeroMetric>
        <MetricGroup
          title="Across your events"
          loading={isLoading}
          items={[
            { label: 'Events', value: t?.events ?? 0 },
            { label: 'Tickets sold', value: t?.sold ?? 0 },
            {
              label: 'Sell-through',
              value: t && t.capacity > 0 ? pct(t.sold / t.capacity) : '—',
            },
            { label: 'Checked in', value: t?.checkedIn ?? 0 },
            { label: 'Platform fees', value: formatMinor(t?.platformFeeMinor ?? 0) },
          ]}
          {...entrance(1)}
        />
      </div>

      <section
        aria-labelledby="per-event-heading"
        {...entrance(2)}
        className={cn('space-y-4', entrance(2).className)}
      >
        <SectionHeading
          id="per-event-heading"
          title="By event"
          description="Compare your events side by side, then open one for the full breakdown."
        >
          {events.length > 1 && (
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-9 w-auto gap-1.5 text-xs" aria-label="Sort events by">
                <span className="text-muted-foreground">Sort</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {(Object.keys(SORTS) as SortKey[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {SORTS[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SectionHeading>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="Nothing to measure yet"
            description="Once you publish an event and start selling, its numbers show up here."
            action={
              <Button asChild>
                <Link href={paths.organizerEvents()}>Go to my events</Link>
              </Button>
            }
          />
        ) : (
          <>
            {/* ── small screens ──
                The table below needed 860px and scrolled sideways to get it.
                Same figures, stacked, with the whole row opening the event. */}
            <Panel padded={false} className="overflow-hidden lg:hidden">
              <h3 className="sr-only">Your events by the numbers</h3>
              <ul className="divide-y divide-border/70">
                {events.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={paths.organizerEvent(e.id)}
                      className="flex items-start gap-3 p-4 transition-colors duration-200 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span
                        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
                        aria-hidden="true"
                      >
                        <CategoryIcon category={e.category} className="size-4" />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="truncate text-sm font-medium">{e.title}</span>
                          <EventStatusBadge status={e.status} />
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                          {formatEventDate(e.startDate)}
                        </span>

                        <span className="mt-2 block">
                          <SellThrough sold={e.sold} capacity={e.capacity} />
                        </span>

                        <span className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                          <span className="tabular-nums">
                            <span className="text-muted-foreground">Net </span>
                            <span className="font-semibold">{formatMinor(e.netMinor)}</span>
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {e.orders} {e.orders === 1 ? 'order' : 'orders'}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {e.attendanceRate === null
                              ? 'No turnout yet'
                              : `${pct(e.attendanceRate)} turned up`}
                          </span>
                        </span>
                      </span>

                      <ChevronRight
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>

            {/* ── large screens ── */}
            <Panel padded={false} className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium">Event</th>
                    <th className="px-4 py-3 font-medium">Sold</th>
                    <th className="px-4 py-3 text-right font-medium">Net revenue</th>
                    <th className="px-4 py-3 text-center font-medium">Orders</th>
                    <th className="px-4 py-3 text-center font-medium">Turned up</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {events.map((e) => (
                    <tr key={e.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <span
                            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                            aria-hidden="true"
                          >
                            <CategoryIcon category={e.category} className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="max-w-[220px] truncate font-medium">{e.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatEventDate(e.startDate)}
                            </p>
                            <div className="mt-1">
                              <EventStatusBadge status={e.status} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <SellThrough sold={e.sold} capacity={e.capacity} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <p className="font-medium">{formatMinor(e.netMinor)}</p>
                        {e.refundedMinor > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {formatMinor(e.refundedMinor)} refunded
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">{e.orders}</td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        {/* Null until something has sold, rather than a misleading 0%. */}
                        {e.attendanceRate === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            {pct(e.attendanceRate)}
                            <span className="block text-xs text-muted-foreground">
                              {e.checkedIn} of {e.sold}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild size="sm" variant="outline" className="h-8 cursor-pointer">
                          <Link href={paths.organizerEvent(e.id)}>Details</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </>
        )}
      </section>
    </div>
  )
}
