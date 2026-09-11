'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BanknoteArrowUp, CheckCircle2, Loader2, Send, XCircle } from 'lucide-react'
import { apiGet, apiPut } from '@/lib/api'
import { formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  SearchBox,
  SectionHeading,
  sectionProps,
  type FilterOption,
} from '@/components/dashboard/primitives'
import { PayoutStatusBadge } from '@/components/dashboard/status-badges'
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
  TruncatedNote,
} from './console'
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

const COLUMNS = [
  { label: 'Payout' },
  { label: 'Organizer' },
  { label: 'Destination' },
  { label: 'Amount', className: 'text-right' },
  { label: 'Status' },
  { label: 'Actions', srOnly: true, className: 'text-right' },
]

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
  const [rejecting, setRejecting] = useState<PayoutRow | null>(null)

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
            : 'Payout rejected',
      )
      setPaying(null)
      setRejecting(null)
      qc.invalidateQueries({ queryKey: ['admin-payouts'] })
      // The platform's own balances move with a payout, so the overview's
      // figures are stale the moment this succeeds.
      qc.invalidateQueries({ queryKey: ['admin-stats'] })
      qc.invalidateQueries({ queryKey: ['admin-payments'] })
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
      <StatStrip
        {...sectionProps(0, '')}
        loading={isLoading}
        items={[
          {
            label: 'Awaiting review',
            value: counts.REQUESTED ?? 0,
            tone: (counts.REQUESTED ?? 0) > 0 ? 'attention' : 'default',
          },
          { label: 'Approved, unpaid', value: counts.APPROVED ?? 0 },
          {
            label: 'Committed',
            value: formatMinor(data?.outstandingMinor ?? 0),
            tone: (data?.outstandingMinor ?? 0) > 0 ? 'attention' : 'default',
          },
          { label: 'Transferred to date', value: formatMinor(data?.totalsMinor.PAID ?? 0) },
        ]}
      />

      <section aria-labelledby="payouts-heading" {...sectionProps(1)}>
        <SectionHeading
          id="payouts-heading"
          title="Payout queue"
          description="Approving reserves the funds. Marking paid is what posts it to the ledger."
        />

        <ConsoleToolbar>
          <FilterChips
            value={status}
            onChange={setStatus}
            options={filters}
            visible={6}
            label="Payout status"
          />
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Reference or organizer"
            label="Search payouts"
          />
        </ConsoleToolbar>

        {isLoading ? (
          <ConsoleSkeleton rows={5} cols={6} />
        ) : payouts.length === 0 ? (
          <EmptyState
            icon={BanknoteArrowUp}
            title="No payouts here"
            description={
              search || status !== 'ALL'
                ? 'Nothing matches this filter. Try clearing it.'
                : 'Organizers request payouts once their sales have cleared.'
            }
          />
        ) : (
          <>
            <ConsoleTable columns={COLUMNS} caption="Payout queue">
              {payouts.map((p) => {
                const busy = running?.startsWith(`${p.id}:`) ?? false
                return (
                  <ConsoleRow key={p.id} tone={p.status === 'REQUESTED' ? 'attention' : undefined}>
                    <ConsoleCell label="Payout">
                      <RowIdentity
                        icon={<BanknoteArrowUp className="size-4" />}
                        title={p.reference}
                        meta={
                          <>
                            {formatEventDate(p.createdAt)}
                            {p.transferRef ? ` · ref ${p.transferRef}` : ''}
                            {p.reviewedByName ? ` · by ${p.reviewedByName}` : ''}
                          </>
                        }
                        tone={p.status === 'PAID' ? 'default' : 'muted'}
                      />
                    </ConsoleCell>
                    <ConsoleCell label="Organizer">
                      <span className="block truncate">
                        {p.organizer?.organizationName ?? 'Unknown organizer'}
                      </span>
                      {p.organizer?.contactEmail && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.organizer.contactEmail}
                        </span>
                      )}
                      {p.initiatedBy === 'AUTOMATIC' && (
                        <Badge variant="secondary" className="mt-1 text-[10px]">
                          Automatic
                        </Badge>
                      )}
                    </ConsoleCell>
                    <ConsoleCell label="Destination">
                      {p.method ? (
                        <>
                          <span className="block truncate">
                            {p.method.typeLabel} ····{p.method.accountLast4}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.method.accountName}
                            {p.method.bankName ? ` · ${p.method.bankName}` : ''}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">No destination on file</span>
                      )}
                    </ConsoleCell>
                    <ConsoleCell label="Amount" align="right">
                      <span className="block font-semibold tabular-nums">
                        {formatMinor(p.amountMinor)}
                      </span>
                      {p.note && (
                        <span className="block truncate text-xs text-muted-foreground italic">
                          “{p.note}”
                        </span>
                      )}
                    </ConsoleCell>
                    <ConsoleCell label="Status">
                      <PayoutStatusBadge status={p.status} />
                      {p.reviewNote && (
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {p.reviewNote}
                        </span>
                      )}
                    </ConsoleCell>
                    <ConsoleActions>
                      {p.status === 'REQUESTED' && (
                        <>
                          <Button
                            size="sm"
                            className="h-8 active:scale-[0.98] motion-reduce:transform-none"
                            disabled={busy}
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
                            disabled={busy}
                            onClick={() => setRejecting(p)}
                          >
                            <XCircle /> Reject
                          </Button>
                        </>
                      )}
                      {p.status === 'APPROVED' && (
                        <>
                          <Button
                            size="sm"
                            className="h-8 active:scale-[0.98] motion-reduce:transform-none"
                            disabled={busy}
                            onClick={() => setPaying(p)}
                          >
                            <Send /> Mark paid
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={busy}
                            onClick={() => setRejecting(p)}
                          >
                            <XCircle /> Reject
                          </Button>
                        </>
                      )}
                      {p.status !== 'REQUESTED' && p.status !== 'APPROVED' && (
                        <span className="text-xs text-muted-foreground md:hidden">No action</span>
                      )}
                    </ConsoleActions>
                  </ConsoleRow>
                )
              })}
            </ConsoleTable>
            {data?.truncated && <TruncatedNote shown={payouts.length} noun="payouts" />}
          </>
        )}
      </section>

      <MarkPaidDialog
        payout={paying}
        pending={decide.isPending}
        onCancel={() => setPaying(null)}
        onConfirm={(transferRef, note) => {
          if (!paying) return
          setRunning(`${paying.id}:mark_paid`)
          decide.mutate({ id: paying.id, action: 'mark_paid', transferRef, note })
        }}
      />

      <ActionConfirm
        open={rejecting !== null}
        title={`Reject ${rejecting?.reference ?? ''}?`}
        body="The organizer is told it was rejected and the reserved funds return to their available balance. They can request again."
        cta="Reject payout"
        pending={decide.isPending}
        onCancel={() => setRejecting(null)}
        onConfirm={() => {
          if (!rejecting) return
          setRunning(`${rejecting.id}:reject`)
          decide.mutate({ id: rejecting.id, action: 'reject' })
        }}
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
