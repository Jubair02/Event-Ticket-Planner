'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CreditCard } from 'lucide-react'
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
import { useDebounced } from './shared'

interface PaymentRow {
  id: string
  amountMinor: number
  gatewayFeeMinor: number
  provider: string
  method: string | null
  status: string
  paidAt: string | null
  createdAt: string
  transactionId: string | null
  order: {
    id: string
    orderNumber: string
    totalMinor: number
    refundedMinor: number
    paymentStatus: string
  }
  customer: { id: string; name: string; email: string }
  event: { id: string; slug: string | null; title: string }
}

interface PaymentsResponse {
  payments: PaymentRow[]
  counts: Record<string, number>
  totalsMinor: Record<string, number>
  ledger: {
    gatewayClearingMinor: number
    cashMinor: number
    platformRevenueMinor: number
    organizerPayableMinor: number
  }
  truncated: boolean
}

const STATUSES = ['PAID', 'PENDING', 'FAILED', 'REFUNDED', 'CANCELLED']

export function AdminPayments({
  initialStatus,
  initialSearch,
}: {
  initialStatus: string
  initialSearch: string
}) {
  const [status, setStatus] = useState(initialStatus)
  const [search, setSearch] = useState(initialSearch)
  const debounced = useDebounced(search)
  useUrlQuery(paths.adminPayments({ status, q: debounced }))

  const { data, isLoading } = useQuery({
    queryKey: ['admin-payments', status, debounced],
    queryFn: () => {
      const p = new URLSearchParams()
      if (status !== 'ALL') p.set('status', status)
      if (debounced) p.set('q', debounced)
      const qs = p.toString()
      return apiGet<PaymentsResponse>(`/api/admin/payments${qs ? `?${qs}` : ''}`)
    },
  })

  const payments = data?.payments ?? []
  const counts = data?.counts ?? {}
  const ledger = data?.ledger

  const filters: FilterOption[] = [
    { value: 'ALL', label: 'All', count: Object.values(counts).reduce((a, b) => a + b, 0) },
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
          label="Captured from customers"
          value={formatMinor(data?.totalsMinor.PAID ?? 0)}
          hint={`${counts.PAID ?? 0} successful payment${(counts.PAID ?? 0) === 1 ? '' : 's'}`}
          loading={isLoading}
          icon={CreditCard}
          {...entrance(0)}
          className={cn('lg:col-span-2', entrance(0).className)}
        />
        {/* Straight from the ledger, so this panel and the books cannot disagree. */}
        <MetricGroup
          title="Where the money sits"
          loading={isLoading}
          items={[
            { label: 'Held at gateway', value: formatMinor(ledger?.gatewayClearingMinor ?? 0) },
            { label: 'In our bank', value: formatMinor(ledger?.cashMinor ?? 0) },
            { label: 'Owed to organizers', value: formatMinor(ledger?.organizerPayableMinor ?? 0) },
            { label: 'Platform revenue', value: formatMinor(ledger?.platformRevenueMinor ?? 0) },
          ]}
          {...entrance(1)}
        />
      </div>

      <section
        aria-labelledby="payments-heading"
        {...entrance(2)}
        className={cn('space-y-4', entrance(2).className)}
      >
        <SectionHeading
          id="payments-heading"
          title="Payments"
          description="Read-only. Correcting a payment means issuing a refund or an adjustment."
        >
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Transaction, order or customer"
            label="Search payments"
          />
        </SectionHeading>

        <FilterChips value={status} onChange={setStatus} options={filters} label="Payment status" />

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : payments.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No payments here"
            description={
              search || status !== 'ALL'
                ? 'Nothing matches this filter.'
                : 'Payments appear as customers check out.'
            }
          />
        ) : (
          <Panel padded={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium">Order</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Event</th>
                    <th className="px-4 py-3 font-medium">Method</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {payments.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium">{p.order.orderNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatEventDate(p.paidAt ?? p.createdAt)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[170px] truncate">{p.customer.name}</p>
                        <p className="max-w-[170px] truncate text-xs text-muted-foreground">
                          {p.customer.email}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[180px] truncate text-muted-foreground">
                          {p.event.title}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{p.method ?? '—'}</p>
                        {p.transactionId && (
                          <p className="max-w-[140px] truncate text-xs text-muted-foreground">
                            {p.transactionId}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <p className="font-medium">{formatMinor(p.amountMinor)}</p>
                        {p.order.refundedMinor > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {formatMinor(p.order.refundedMinor)} refunded
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <PaymentStatusBadge status={p.status} />
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
            Showing the most recent 200 payments. Narrow the search to see older ones.
          </p>
        )}
      </section>
    </div>
  )
}
