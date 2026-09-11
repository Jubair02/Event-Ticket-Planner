'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PlayCircle,
  RotateCcw,
  Undo2,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { apiGet, apiPatch, apiPost } from '@/lib/api'
import { formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/app/empty-state'
import {
  FilterChips,
  SearchBox,
  SectionHeading,
  sectionProps,
  type FilterOption,
} from '@/components/dashboard/primitives'
import { RefundStatusBadge } from '@/components/dashboard/status-badges'
import { useUrlQuery } from '@/components/dashboard/use-url-query'
import {
  ActionConfirm,
  ConsoleActions,
  ConsoleCell,
  ConsoleRow,
  ConsoleSkeleton,
  ConsoleTable,
  ConsoleToolbar,
  RowIdentity,
  StatStrip,
} from './console'
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

const STATUS_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'REQUESTED', label: 'Requested' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'COMPLETED', label: 'Refunded' },
  { value: 'REJECTED', label: 'Rejected' },
]

const COLUMNS = [
  { label: 'Refund' },
  { label: 'Customer' },
  { label: 'Reason' },
  { label: 'Amount', className: 'text-right' },
  { label: 'Status' },
  { label: 'Actions', srOnly: true, className: 'text-right' },
]

const OWED_COLUMNS = [
  { label: 'Order' },
  { label: 'Customer' },
  { label: 'Tickets', className: 'text-center' },
  { label: 'Owed', className: 'text-right' },
]

interface RowAction {
  key: string
  label: string
  icon: LucideIcon
  destructive?: boolean
}

/**
 * Which actions a refund can take, by status.
 *
 * FAILED is not terminal: the same row is retried so the idempotency key is
 * reused and the customer cannot be paid twice, or abandoned into REJECTED.
 */
function actionsFor(status: string): RowAction[] {
  switch (status) {
    case 'REQUESTED':
      return [
        { key: 'approve', label: 'Approve', icon: CheckCircle2 },
        { key: 'reject', label: 'Reject', icon: XCircle, destructive: true },
      ]
    case 'APPROVED':
      return [
        { key: 'process', label: 'Send to gateway', icon: PlayCircle },
        { key: 'reject', label: 'Reject', icon: XCircle, destructive: true },
      ]
    case 'FAILED':
      return [
        { key: 'retry', label: 'Retry', icon: RotateCcw },
        { key: 'reject', label: 'Abandon', icon: XCircle, destructive: true },
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
  // Keyed `${id}:${action}` so only the row being acted on shows a spinner and
  // only its own buttons are disabled. The previous `disabled={running !== null}`
  // froze every row in the queue while one refund was processing.
  const [running, setRunning] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ row: RefundRow; action: RowAction } | null>(null)

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
  const owed = data?.owed ?? []

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['admin-refunds'] })
    qc.invalidateQueries({ queryKey: ['admin-stats'] })
  }

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      apiPatch(`/api/admin/refunds/${id}`, { action }),
    onSuccess: () => {
      toast.success('Refund updated')
      setConfirming(null)
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
          : 'Queue drained',
      )
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function run(row: RefundRow, action: RowAction) {
    if (action.destructive) {
      setConfirming({ row, action })
      return
    }
    setRunning(`${row.id}:${action.key}`)
    decide.mutate({ id: row.id, action: action.key })
  }

  const filters: FilterOption[] = STATUS_FILTERS.map((f) => ({
    ...f,
    count:
      f.value === 'ALL' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[f.value] ?? 0),
  }))

  const approvedWaiting = counts.APPROVED ?? 0

  return (
    <div className="space-y-6">
      <StatStrip
        {...sectionProps(0, '')}
        loading={isLoading}
        items={[
          {
            label: 'Awaiting review',
            value: counts.REQUESTED ?? 0,
            tone: (counts.REQUESTED ?? 0) > 0 ? 'attention' : 'default',
          },
          { label: 'Refunded to date', value: formatMinor(data?.totals.COMPLETED ?? 0) },
          {
            label: 'Failed',
            value: counts.FAILED ?? 0,
            tone: (counts.FAILED ?? 0) > 0 ? 'danger' : 'default',
          },
          {
            label: 'Owed, unhandled',
            value: formatMinor(data?.owedOutstandingMinor ?? 0),
            tone: (data?.owedOutstandingMinor ?? 0) > 0 ? 'danger' : 'default',
          },
        ]}
      />

      {approvedWaiting > 0 && (
        <div {...sectionProps(1, 'flex')}>
          <Button
            onClick={() => drain.mutate()}
            disabled={drain.isPending}
            className="active:scale-[0.98] motion-reduce:transform-none"
          >
            {drain.isPending ? <Loader2 className="animate-spin" /> : <PlayCircle />}
            Send {approvedWaiting} approved refund{approvedWaiting === 1 ? '' : 's'} to the gateway
          </Button>
        </div>
      )}

      {owed.length > 0 && (
        <section aria-labelledby="owed-heading" {...sectionProps(2)}>
          <SectionHeading
            id="owed-heading"
            title="Nothing is working on these"
            description="Paid orders on cancelled events with no live refund. This is money owed."
          />
          <ConsoleTable columns={OWED_COLUMNS} caption="Orders owed a refund">
            {owed.slice(0, 8).map((o) => (
              <ConsoleRow key={o.id} tone="danger">
                <ConsoleCell label="Order">
                  <RowIdentity
                    icon={<AlertTriangle className="size-4" />}
                    title={o.orderNumber}
                    meta={o.event.title}
                    tone="muted"
                  />
                </ConsoleCell>
                <ConsoleCell label="Customer">
                  <span className="block truncate">{o.customer.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {o.customer.email}
                  </span>
                </ConsoleCell>
                <ConsoleCell label="Tickets" align="center">
                  <span className="tabular-nums">{o.ticketCount}</span>
                </ConsoleCell>
                <ConsoleCell label="Owed" align="right">
                  <span className="font-semibold text-destructive tabular-nums">
                    {formatMinor(o.outstandingMinor)}
                  </span>
                </ConsoleCell>
              </ConsoleRow>
            ))}
          </ConsoleTable>
          {owed.length > 8 && (
            <p className="px-1 text-xs text-muted-foreground">
              Showing 8 of <span className="tabular-nums">{owed.length}</span> unhandled orders.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="refunds-heading" {...sectionProps(3)}>
        <SectionHeading
          id="refunds-heading"
          title="Refund queue"
          description="Approve, reject or push a refund to the gateway."
        />

        <ConsoleToolbar>
          <FilterChips
            value={status}
            onChange={setStatus}
            options={filters}
            visible={7}
            label="Refund status"
          />
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Refund, order or customer"
            label="Search refunds"
          />
        </ConsoleToolbar>

        {isLoading ? (
          <ConsoleSkeleton rows={5} cols={6} />
        ) : refunds.length === 0 ? (
          <EmptyState
            icon={Undo2}
            title="Nothing in the queue"
            description={
              search || status !== 'ALL'
                ? 'Nothing matches this filter. Try clearing it.'
                : 'Refund requests will show up here.'
            }
          />
        ) : (
          <ConsoleTable columns={COLUMNS} caption="Refund queue, newest first">
            {refunds.map((r) => {
              const actions = actionsFor(r.status)
              const problem = r.failureReason ?? r.rejectionReason
              return (
                <ConsoleRow
                  key={r.id}
                  tone={
                    r.status === 'FAILED'
                      ? 'danger'
                      : r.status === 'REQUESTED'
                        ? 'attention'
                        : undefined
                  }
                >
                  <ConsoleCell label="Refund">
                    <RowIdentity
                      icon={<Undo2 className="size-4" />}
                      title={r.refundNumber}
                      meta={`Order ${r.order.orderNumber} · ${formatEventDate(r.requestedAt)}`}
                      tone={r.status === 'COMPLETED' ? 'default' : 'muted'}
                    />
                  </ConsoleCell>
                  <ConsoleCell label="Customer">
                    <span className="block truncate">{r.customer?.name ?? '—'}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.event?.title ?? ''}
                    </span>
                  </ConsoleCell>
                  <ConsoleCell label="Reason">
                    <span className="block truncate">{r.reasonLabel}</span>
                    {problem && (
                      <span className="block truncate text-xs text-destructive">{problem}</span>
                    )}
                    {r.gatewayAttempts > 0 && (
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {r.gatewayAttempts} gateway attempt{r.gatewayAttempts === 1 ? '' : 's'}
                      </span>
                    )}
                  </ConsoleCell>
                  <ConsoleCell label="Amount" align="right">
                    <span className="block font-semibold tabular-nums">
                      {formatMinor(r.amountMinor)}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {formatMinor(r.organizerShareMinor)} org ·{' '}
                      {formatMinor(r.platformShareMinor)} us
                    </span>
                  </ConsoleCell>
                  <ConsoleCell label="Status">
                    <RefundStatusBadge status={r.status} />
                  </ConsoleCell>
                  <ConsoleActions>
                    {actions.length === 0 ? (
                      <span className="text-xs text-muted-foreground md:hidden">No action</span>
                    ) : (
                      actions.map((a) => {
                        const busy = running === `${r.id}:${a.key}`
                        return (
                          <Button
                            key={a.key}
                            size="sm"
                            variant={a.destructive ? 'outline' : 'default'}
                            className="h-8 active:scale-[0.98] motion-reduce:transform-none"
                            // Only this row's own actions are blocked.
                            disabled={running?.startsWith(`${r.id}:`) ?? false}
                            onClick={() => run(r, a)}
                          >
                            {busy ? <Loader2 className="animate-spin" /> : <a.icon />}
                            {a.label}
                          </Button>
                        )
                      })
                    )}
                  </ConsoleActions>
                </ConsoleRow>
              )
            })}
          </ConsoleTable>
        )}
      </section>

      <ActionConfirm
        open={confirming !== null}
        title={`${confirming?.action.label ?? 'Reject'} ${confirming?.row.refundNumber ?? ''}?`}
        body="The customer will not be refunded, and the tickets on this refund are released back to the order. You can raise a new refund later."
        cta={confirming?.action.label ?? 'Reject'}
        pending={decide.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return
          setRunning(`${confirming.row.id}:${confirming.action.key}`)
          decide.mutate({ id: confirming.row.id, action: confirming.action.key })
        }}
      />
    </div>
  )
}
