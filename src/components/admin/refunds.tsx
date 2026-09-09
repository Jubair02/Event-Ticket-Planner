'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, PlayCircle, RotateCcw, Undo2, XCircle } from 'lucide-react'
import { apiGet, apiPatch, apiPost } from '@/lib/api'
import { formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { useUrlQuery } from '@/components/dashboard/use-url-query'
import { useDebounced } from './shared'

interface RefundRow {
  id: string
  refundNumber: string
  status: string
  type: string
  amountMinor: number
  organizerShareMinor: number
  platformShareMinor: number
  reasonLabel: string
  rejectionReason: string | null
  failureReason: string | null
  gatewayAttempts: number
  requestedAt: string
  order: { orderNumber: string; totalMinor: number; refundedMinor: number }
  event: { id: string; slug: string | null; title: string } | null
  customer: { id: string; name: string; email: string } | null
}

interface OwedRow {
  id: string
  orderNumber: string
  outstandingMinor: number
  customer: { name: string; email: string }
  event: { title: string }
  ticketCount: number
}

interface RefundsResponse {
  refunds: RefundRow[]
  counts: Record<string, number>
  totals: Record<string, number>
  owed: OwedRow[]
  owedOutstandingMinor: number
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'REQUESTED', label: 'Requested' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'COMPLETED', label: 'Refunded' },
  { value: 'REJECTED', label: 'Rejected' },
]

const STATUS_TONE: Record<string, string> = {
  COMPLETED: 'border-primary/20 bg-primary/10 text-primary',
  APPROVED: 'border-chart-2/20 bg-chart-2/10 text-chart-2',
  REQUESTED: 'border-chart-5/20 bg-chart-5/10 text-chart-5',
  PROCESSING: 'border-chart-5/20 bg-chart-5/10 text-chart-5',
  FAILED: 'border-destructive/20 bg-destructive/10 text-destructive',
  REJECTED: 'bg-muted text-muted-foreground',
}

/** Which admin actions a refund in a given status can accept. */
function actionsFor(status: string): { key: string; label: string; icon: typeof CheckCircle2 }[] {
  switch (status) {
    case 'REQUESTED':
      return [
        { key: 'approve', label: 'Approve', icon: CheckCircle2 },
        { key: 'reject', label: 'Reject', icon: XCircle },
      ]
    case 'APPROVED':
      return [
        { key: 'process', label: 'Send to gateway', icon: PlayCircle },
        { key: 'reject', label: 'Reject', icon: XCircle },
      ]
    case 'FAILED':
      // FAILED is not terminal: the same row is retried so the customer cannot
      // be paid twice, or abandoned into REJECTED.
      return [
        { key: 'retry', label: 'Retry', icon: RotateCcw },
        { key: 'reject', label: 'Abandon', icon: XCircle },
      ]
    default:
      return []
  }
}

export function AdminRefunds({
  initialStatus,
  initialSearch,
}: {
  initialStatus: string
  initialSearch: string
}) {
  const [status, setStatus] = useState(initialStatus)
  const [search, setSearch] = useState(initialSearch)
  const debounced = useDebounced(search)
  useUrlQuery(paths.adminRefunds({ status, q: debounced }))

  const qc = useQueryClient()
  const [running, setRunning] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-refunds', status, debounced],
    queryFn: () => {
      const p = new URLSearchParams()
      if (status !== 'ALL') p.set('status', status)
      if (debounced) p.set('q', debounced)
      const qs = p.toString()
      return apiGet<RefundsResponse>(`/api/admin/refunds${qs ? `?${qs}` : ''}`)
    },
  })

  const refunds = data?.refunds ?? []
  const counts = data?.counts ?? {}

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['admin-refunds'] })
    qc.invalidateQueries({ queryKey: ['admin-stats'] })
  }

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      apiPatch(`/api/admin/refunds/${id}`, { action }),
    onSuccess: () => {
      toast.success('Refund updated')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setRunning(null),
  })

  const drain = useMutation({
    mutationFn: () => apiPost<{ processed?: number }>('/api/admin/refunds/process', {}),
    onSuccess: (r) => {
      toast.success(
        typeof r?.processed === 'number'
          ? `${r.processed} refund${r.processed === 1 ? '' : 's'} sent to the gateway`
          : 'Queue drained'
      )
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const filters: FilterOption[] = STATUS_FILTERS.map((f) => ({
    ...f,
    count:
      f.value === 'ALL' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[f.value] ?? 0),
  }))

  const approvedWaiting = counts.APPROVED ?? 0

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroMetric
          label="Awaiting a decision"
          value={counts.REQUESTED ?? 0}
          hint={
            data
              ? `${formatMinor(data.totals.REQUESTED ?? 0)} requested · ${formatMinor(
                  data.owedOutstandingMinor
                )} owed on cancelled events`
              : undefined
          }
          loading={isLoading}
          icon={Undo2}
          {...entrance(0)}
          className={cn('lg:col-span-2', entrance(0).className)}
        >
          {approvedWaiting > 0 && (
            <div className="relative mt-4">
              <Button
                onClick={() => drain.mutate()}
                disabled={drain.isPending}
                className="active:scale-[0.98] motion-reduce:transform-none"
              >
                {drain.isPending ? <Loader2 className="animate-spin" /> : <PlayCircle />}
                Send {approvedWaiting} approved to the gateway
              </Button>
            </div>
          )}
        </HeroMetric>
        <MetricGroup
          title="Refunded to date"
          loading={isLoading}
          items={[
            { label: 'Completed', value: formatMinor(data?.totals.COMPLETED ?? 0) },
            { label: 'In flight', value: formatMinor(data?.totals.PROCESSING ?? 0) },
            { label: 'Failed', value: counts.FAILED ?? 0 },
            { label: 'Rejected', value: counts.REJECTED ?? 0 },
          ]}
          {...entrance(1)}
        />
      </div>

      {(data?.owed.length ?? 0) > 0 && (
        <section
          aria-labelledby="owed-heading"
          {...entrance(2)}
          className={cn('space-y-3', entrance(2).className)}
        >
          <SectionHeading
            id="owed-heading"
            title="Nothing is working on these"
            description="Paid orders on cancelled events with no live refund. This is money owed."
          />
          <Panel padded={false} className="divide-y divide-border/70">
            {data?.owed.slice(0, 8).map((o) => (
              <div key={o.id} className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{o.orderNumber}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {o.event.title} · {o.customer.email} · {o.ticketCount} ticket
                    {o.ticketCount === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-destructive">
                  {formatMinor(o.outstandingMinor)}
                </span>
              </div>
            ))}
          </Panel>
        </section>
      )}

      <section
        aria-labelledby="refunds-heading"
        {...entrance(3)}
        className={cn('space-y-4', entrance(3).className)}
      >
        <SectionHeading
          id="refunds-heading"
          title="Refund queue"
          description="Approve, reject or push a refund to the gateway."
        >
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Refund, order or customer"
            label="Search refunds"
          />
        </SectionHeading>

        <FilterChips value={status} onChange={setStatus} options={filters} visible={5} label="Refund status" />

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : refunds.length === 0 ? (
          <EmptyState
            icon={Undo2}
            title="Nothing in the queue"
            description={
              search || status !== 'ALL'
                ? 'Nothing matches this filter.'
                : 'Refund requests will show up here.'
            }
          />
        ) : (
          <div className="space-y-2">
            {refunds.map((r) => {
              const actions = actionsFor(r.status)
              return (
                <Panel key={r.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{r.refundNumber}</p>
                        <Badge variant="outline" className={STATUS_TONE[r.status] ?? ''}>
                          {r.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{r.reasonLabel}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Order {r.order.orderNumber}
                        {r.event ? ` · ${r.event.title}` : ''}
                        {r.customer ? ` · ${r.customer.email}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Requested {formatEventDate(r.requestedAt)}
                        {r.gatewayAttempts > 0
                          ? ` · ${r.gatewayAttempts} gateway attempt${r.gatewayAttempts === 1 ? '' : 's'}`
                          : ''}
                      </p>
                      {(r.failureReason || r.rejectionReason) && (
                        <p className="mt-1 text-xs text-destructive">
                          {r.failureReason ?? r.rejectionReason}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">{formatMinor(r.amountMinor)}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {formatMinor(r.organizerShareMinor)} organizer ·{' '}
                          {formatMinor(r.platformShareMinor)} platform
                        </p>
                      </div>
                      {actions.length > 0 && (
                        <div className="flex gap-1.5">
                          {actions.map((a) => (
                            <Button
                              key={a.key}
                              size="sm"
                              variant={a.key === 'reject' ? 'outline' : 'default'}
                              className="h-8"
                              disabled={running !== null}
                              onClick={() => {
                                setRunning(`${r.id}:${a.key}`)
                                decide.mutate({ id: r.id, action: a.key })
                              }}
                            >
                              {running === `${r.id}:${a.key}` ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <a.icon />
                              )}
                              {a.label}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Panel>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
