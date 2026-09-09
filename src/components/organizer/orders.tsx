'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Receipt, Ticket } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import { PAYMENT_STATUS_LABELS } from '@/lib/constants'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/empty-state'
import {
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

const STATUSES = ['PAID', 'PENDING', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CANCELLED']

export function OrganizerOrders({
  initialStatus,
  initialSearch,
}: {
  initialStatus: string
  initialSearch: string
}) {
  const [status, setStatus] = useState(initialStatus)
  const [search, setSearch] = useState(initialSearch)
  const debounced = useDebounced(search)
  useUrlQuery(paths.organizerOrders({ status, q: debounced }))

  const { data, isLoading } = useQuery({
    queryKey: ['organizer-orders', status, debounced],
    queryFn: () => {
      const p = new URLSearchParams()
      if (status !== 'ALL') p.set('status', status)
      if (debounced) p.set('q', debounced)
      const qs = p.toString()
      return apiGet<OrdersResponse>(`/api/organizer/orders${qs ? `?${qs}` : ''}`)
    },
  })

  const orders = data?.orders ?? []
  const counts = data?.counts ?? {}
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  const filters: FilterOption[] = [
    { value: 'ALL', label: 'All', count: total },
    ...STATUSES.map((s) => ({
      value: s,
      label: PAYMENT_STATUS_LABELS[s] ?? s,
      count: counts[s] ?? 0,
    })),
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroMetric
          label="Gross sales"
          value={formatMinor(data?.grossMinor ?? 0)}
          hint="Across every paid order on your events"
          loading={isLoading}
          icon={Receipt}
          {...entrance(0)}
          className={cn('lg:col-span-2', entrance(0).className)}
        />
        <MetricGroup
          title="At a glance"
          loading={isLoading}
          items={[
            { label: 'Paid orders', value: counts.PAID ?? 0 },
            { label: 'Awaiting payment', value: counts.PENDING ?? 0 },
            { label: 'Refunded', value: formatMinor(data?.refundedMinor ?? 0) },
          ]}
          {...entrance(1)}
        />
      </div>

      <section
        aria-labelledby="orders-heading"
        {...entrance(2)}
        className={cn('space-y-4', entrance(2).className)}
      >
        <SectionHeading
          id="orders-heading"
          title="Orders"
          description="Every order placed on your events, newest first."
        >
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Order number, name or email"
            label="Search orders"
          />
        </SectionHeading>

        <FilterChips value={status} onChange={setStatus} options={filters} label="Payment status" />

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={Ticket}
            title="No orders here"
            description={
              search || status !== 'ALL'
                ? 'Nothing matches this filter. Try clearing it.'
                : 'Orders will appear as soon as someone buys a ticket to one of your events.'
            }
          />
        ) : (
          <Panel padded={false} className="overflow-hidden">
            {/* Scrolls inside its own container so the page never scrolls sideways. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Attendee</th>
                    <th className="px-4 py-3 font-medium">Event</th>
                    <th className="px-4 py-3 text-center font-medium">Tickets</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {orders.map((o) => (
                    <tr key={o.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium">{o.orderNumber}</p>
                        <p className="text-xs text-muted-foreground">{formatEventDate(o.createdAt)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[180px] truncate">{o.attendeeName}</p>
                        <p className="max-w-[180px] truncate text-xs text-muted-foreground">
                          {o.attendeeEmail}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={paths.event(o.event)}
                          className="max-w-[200px] truncate hover:text-primary hover:underline"
                        >
                          {o.event.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">{o.ticketCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <p className="font-medium">{formatMinor(o.totalMinor)}</p>
                        {o.refundedMinor > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {formatMinor(o.refundedMinor)} refunded
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <PaymentStatusBadge status={o.paymentStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {data?.truncated && (
          <p className="text-xs text-muted-foreground">
            Showing the most recent 200 orders. Narrow the search to see older ones.
          </p>
        )}
      </section>
    </div>
  )
}
