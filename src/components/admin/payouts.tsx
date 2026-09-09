'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BanknoteArrowUp, CheckCircle2, Loader2, Send, XCircle } from 'lucide-react'
import { apiGet, apiPut } from '@/lib/api'
import { formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

interface PayoutRow {
  id: string
  reference: string
  amountMinor: number
  status: string
  statusLabel: string
  note: string | null
  reviewNote: string | null
  reviewedAt: string | null
  reviewedByName: string | null
  transferRef: string | null
  paidAt: string | null
  initiatedBy: string
  createdAt: string
  method: {
    typeLabel: string
    accountName: string
    accountLast4: string
    bankName: string | null
  } | null
  organizer?: { id: string; organizationName: string; contactEmail: string | null }
}

interface PayoutsResponse {
  payouts: PayoutRow[]
  counts: Record<string, number>
  totalsMinor: Record<string, number>
  outstandingMinor: number
  truncated: boolean
}

const STATUS_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'REQUESTED', label: 'Awaiting review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PAID', label: 'Paid' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

const STATUS_TONE: Record<string, string> = {
  PAID: 'border-primary/20 bg-primary/10 text-primary',
  APPROVED: 'border-chart-2/20 bg-chart-2/10 text-chart-2',
  REQUESTED: 'border-chart-5/20 bg-chart-5/10 text-chart-5',
  REJECTED: 'border-destructive/20 bg-destructive/10 text-destructive',
  CANCELLED: 'bg-muted text-muted-foreground',
}

export function AdminPayouts({
  initialStatus,
  initialSearch,
}: {
  initialStatus: string
  initialSearch: string
}) {
  const [status, setStatus] = useState(initialStatus)
  const [search, setSearch] = useState(initialSearch)
  const debounced = useDebounced(search)
  useUrlQuery(paths.adminPayouts({ status, q: debounced }))

  const qc = useQueryClient()
  const [running, setRunning] = useState<string | null>(null)
  const [paying, setPaying] = useState<PayoutRow | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-payouts', status, debounced],
    queryFn: () => {
      const p = new URLSearchParams()
      if (status !== 'ALL') p.set('status', status)
      if (debounced) p.set('q', debounced)
      const qs = p.toString()
      return apiGet<PayoutsResponse>(`/api/admin/payouts${qs ? `?${qs}` : ''}`)
    },
  })

  const payouts = data?.payouts ?? []
  const counts = data?.counts ?? {}

  const decide = useMutation({
    mutationFn: (vars: { id: string; action: string; note?: string; transferRef?: string }) =>
      apiPut(`/api/admin/payouts/${vars.id}`, {
        action: vars.action,
        note: vars.note,
        transferRef: vars.transferRef,
      }),
    onSuccess: (_d, vars) => {
      toast.success(
        vars.action === 'mark_paid'
          ? 'Payout marked paid and posted to the ledger'
          : vars.action === 'approve'
            ? 'Payout approved'
            : 'Payout rejected'
      )
      setPaying(null)
      qc.invalidateQueries({ queryKey: ['admin-payouts'] })
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setRunning(null),
  })

  const filters: FilterOption[] = STATUS_FILTERS.map((f) => ({
    ...f,
    count:
      f.value === 'ALL' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[f.value] ?? 0),
  }))

  function run(id: string, action: string) {
    setRunning(`${id}:${action}`)
    decide.mutate({ id, action })
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroMetric
          label="Committed, not yet transferred"
          value={formatMinor(data?.outstandingMinor ?? 0)}
          hint={`${counts.REQUESTED ?? 0} awaiting review · ${counts.APPROVED ?? 0} approved`}
          loading={isLoading}
          icon={BanknoteArrowUp}
          {...entrance(0)}
          className={cn('lg:col-span-2', entrance(0).className)}
        />
        <MetricGroup
          title="Paid out"
          loading={isLoading}
          items={[
            { label: 'Total transferred', value: formatMinor(data?.totalsMinor.PAID ?? 0) },
            { label: 'Payouts paid', value: counts.PAID ?? 0 },
            { label: 'Rejected', value: counts.REJECTED ?? 0 },
          ]}
          {...entrance(1)}
        />
      </div>

      <section
        aria-labelledby="payouts-heading"
        {...entrance(2)}
        className={cn('space-y-4', entrance(2).className)}
      >
        <SectionHeading
          id="payouts-heading"
          title="Payout queue"
          description="Approving reserves the funds. Marking paid is what posts it to the ledger."
        >
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Reference or organizer"
            label="Search payouts"
          />
        </SectionHeading>

        <FilterChips value={status} onChange={setStatus} options={filters} visible={4} label="Payout status" />

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : payouts.length === 0 ? (
          <EmptyState
            icon={BanknoteArrowUp}
            title="No payouts here"
            description={
              search || status !== 'ALL'
                ? 'Nothing matches this filter.'
                : 'Organizers request payouts once their sales have cleared.'
            }
          />
        ) : (
          <div className="space-y-2">
            {payouts.map((p) => (
              <Panel key={p.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{p.reference}</p>
                      <Badge variant="outline" className={STATUS_TONE[p.status] ?? ''}>
                        {p.statusLabel}
                      </Badge>
                      {p.initiatedBy === 'AUTOMATIC' && (
                        <Badge variant="secondary" className="text-xs">
                          Automatic
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm">
                      {p.organizer?.organizationName ?? 'Unknown organizer'}
                      {p.organizer?.contactEmail ? (
                        <span className="text-muted-foreground"> · {p.organizer.contactEmail}</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {p.method
                        ? `${p.method.typeLabel} ····${p.method.accountLast4} · ${p.method.accountName}`
                        : 'No destination on file'}
                      {p.method?.bankName ? ` · ${p.method.bankName}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Requested {formatEventDate(p.createdAt)}
                      {p.reviewedByName ? ` · reviewed by ${p.reviewedByName}` : ''}
                      {p.transferRef ? ` · ref ${p.transferRef}` : ''}
                    </p>
                    {p.note && <p className="mt-1 text-xs italic text-muted-foreground">“{p.note}”</p>}
                    {p.reviewNote && (
                      <p className="mt-1 text-xs text-muted-foreground">{p.reviewNote}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <p className="font-semibold tabular-nums">{formatMinor(p.amountMinor)}</p>
                    <div className="flex gap-1.5">
                      {p.status === 'REQUESTED' && (
                        <>
                          <Button
                            size="sm"
                            className="h-8"
                            disabled={running !== null}
                            onClick={() => run(p.id, 'approve')}
                          >
                            {running === `${p.id}:approve` ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <CheckCircle2 />
                            )}
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={running !== null}
                            onClick={() => run(p.id, 'reject')}
                          >
                            {running === `${p.id}:reject` ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <XCircle />
                            )}
                            Reject
                          </Button>
                        </>
                      )}
                      {p.status === 'APPROVED' && (
                        <>
                          <Button size="sm" className="h-8" onClick={() => setPaying(p)}>
                            <Send /> Mark paid
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={running !== null}
                            onClick={() => run(p.id, 'reject')}
                          >
                            {running === `${p.id}:reject` ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <XCircle />
                            )}
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </section>

      <MarkPaidDialog
        payout={paying}
        pending={decide.isPending}
        onCancel={() => setPaying(null)}
        onConfirm={(transferRef, note) =>
          paying && decide.mutate({ id: paying.id, action: 'mark_paid', transferRef, note })
        }
      />
    </div>
  )
}

/**
 * Marking a payout paid is the irreversible step — it posts to the ledger — so
 * it asks for the bank's transfer reference rather than firing on one click.
 */
function MarkPaidDialog({
  payout,
  pending,
  onCancel,
  onConfirm,
}: {
  payout: PayoutRow | null
  pending: boolean
  onCancel: () => void
  onConfirm: (transferRef: string, note?: string) => void
}) {
  const [transferRef, setTransferRef] = useState('')
  const [note, setNote] = useState('')

  return (
    <Dialog
      open={payout !== null}
      onOpenChange={(o) => {
        if (!o) {
          onCancel()
          setTransferRef('')
          setNote('')
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {payout?.reference} paid</DialogTitle>
          <DialogDescription>
            This posts {payout ? formatMinor(payout.amountMinor) : ''} to the ledger and cannot be
            undone. Enter the reference the bank or wallet gave you.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="transfer-ref">Transfer reference</Label>
            <Input
              id="transfer-ref"
              value={transferRef}
              onChange={(e) => setTransferRef(e.target.value)}
              placeholder="e.g. TRX8817264"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-note">Note (optional)</Label>
            <Input
              id="pay-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything worth recording"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={pending || transferRef.trim().length === 0}
            onClick={() => onConfirm(transferRef.trim(), note.trim() || undefined)}
          >
            {pending && <Loader2 className="animate-spin" />} Mark paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
