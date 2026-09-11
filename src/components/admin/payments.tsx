'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CreditCard } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { PAYMENT_STATUS_LABELS } from '@/lib/constants'
import { EmptyState } from '@/components/app/empty-state'
import {
  FilterChips,
  SearchBox,
  SectionHeading,
  sectionProps,
  type FilterOption,
} from '@/components/dashboard/primitives'
import { PaymentStatusBadge } from '@/components/dashboard/status-badges'
import { useUrlQuery } from '@/components/dashboard/use-url-query'
import {
  ConsoleCell,
  ConsoleRow,
  ConsoleSkeleton,
  ConsoleTable,
  ConsoleToolbar,
  RowIdentity,
  StatStrip,
  TruncatedNote,
} from './console'
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

const COLUMNS = [
  { label: 'Order' },
  { label: 'Customer' },
  { label: 'Event' },
  { label: 'Method' },
  { label: 'Amount', className: 'text-right' },
  { label: 'Status' },
]

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
      {/* Straight from the ledger, so this band and the books cannot disagree. */}
      <StatStrip
        {...sectionProps(0, '')}
        loading={isLoading}
        items={[
          { label: 'Captured', value: formatMinor(data?.totalsMinor.PAID ?? 0) },
          { label: 'Held at gateway', value: formatMinor(ledger?.gatewayClearingMinor ?? 0) },
          { label: 'Owed to organizers', value: formatMinor(ledger?.organizerPayableMinor ?? 0) },
          { label: 'Platform revenue', value: formatMinor(ledger?.platformRevenueMinor ?? 0) },
        ]}
      />

      <section aria-labelledby="payments-heading" {...sectionProps(1)}>
        <SectionHeading
          id="payments-heading"
          title="Payments"
          description="Read-only. Correcting a payment means issuing a refund or an adjustment."
        />

        <ConsoleToolbar>
          <FilterChips
            value={status}
            onChange={setStatus}
            options={filters}
            visible={6}
            label="Payment status"
          />
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Transaction, order or customer"
            label="Search payments"
          />
        </ConsoleToolbar>

        {isLoading ? (
          <ConsoleSkeleton rows={6} cols={6} />
        ) : payments.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No payments here"
            description={
              search || status !== 'ALL'
                ? 'Nothing matches this filter. Try clearing it.'
                : 'Payments appear as customers check out.'
            }
          />
        ) : (
          <>
            <ConsoleTable columns={COLUMNS} caption="Payments, newest first">
              {payments.map((p) => (
                <ConsoleRow key={p.id} tone={p.status === 'FAILED' ? 'danger' : undefined}>
                  <ConsoleCell label="Order">
                    <RowIdentity
                      icon={<CreditCard className="size-4" />}
                      title={p.order.orderNumber}
                      meta={formatEventDate(p.paidAt ?? p.createdAt)}
                      tone={p.status === 'PAID' ? 'default' : 'muted'}
                    />
                  </ConsoleCell>
                  <ConsoleCell label="Customer">
                    <span className="block truncate">{p.customer.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.customer.email}
                    </span>
                  </ConsoleCell>
                  <ConsoleCell label="Event">
                    <span className="block truncate text-muted-foreground">{p.event.title}</span>
                  </ConsoleCell>
                  <ConsoleCell label="Method">
                    <span className="block">{p.method ?? '—'}</span>
                    {p.transactionId && (
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {p.transactionId}
                      </span>
                    )}
                  </ConsoleCell>
                  <ConsoleCell label="Amount" align="right">
                    <span className="block font-medium tabular-nums">
                      {formatMinor(p.amountMinor)}
                    </span>
                    {p.order.refundedMinor > 0 && (
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {formatMinor(p.order.refundedMinor)} refunded
                      </span>
                    )}
                  </ConsoleCell>
                  <ConsoleCell label="Status">
                    <PaymentStatusBadge status={p.status} />
                  </ConsoleCell>
                </ConsoleRow>
              ))}
            </ConsoleTable>
            {data?.truncated && <TruncatedNote shown={payments.length} noun="payments" />}
          </>
        )}
      </section>
    </div>
  )
}
