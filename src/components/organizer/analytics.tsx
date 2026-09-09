'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { BarChart3, TrendingUp } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { categoryEmoji, formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/app/empty-state'
import {
  HeroMetric,
  MetricGroup,
  Panel,
  SectionHeading,
  entrance,
} from '@/components/dashboard/primitives'
import { EventStatusBadge } from '@/components/dashboard/status-badges'

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
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${pct(ratio)} of capacity sold`}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}

export function OrganizerAnalytics() {
  const { data, isLoading } = useQuery({
    queryKey: ['organizer-analytics'],
    queryFn: () => apiGet<AnalyticsResponse>('/api/organizer/analytics'),
  })

  const events = data?.events ?? []
  const t = data?.totals

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
        />
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
        />

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
          <Panel padded={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
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
                          <span aria-hidden="true">{categoryEmoji(e.category)}</span>
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
                        <Button asChild size="sm" variant="outline" className="h-8">
                          <Link href={paths.organizerEvent(e.id)}>Details</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </section>
    </div>
  )
}
