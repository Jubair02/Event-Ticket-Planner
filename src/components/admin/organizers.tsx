'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import { apiGet, apiPut } from '@/lib/api'
import { formatEventDate } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { AdminOrganizerRow } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/empty-state'
import { FilterChip, FilterChips, SectionHeading, entrance } from '@/components/dashboard/primitives'
import { useUrlQuery } from '@/components/dashboard/use-url-query'
import { BulkBar, ConfirmDialog, mapLimit, reportBulk, useSelection, type BulkAction } from './shared'

// ============================= Organizers =============================

const ORGANIZER_FILTERS = [
  { v: 'ALL', label: 'All' },
  { v: 'PENDING', label: 'Pending' },
  { v: 'APPROVED', label: 'Approved' },
  { v: 'REJECTED', label: 'Rejected' },
]

export function AdminOrganizers({ initialStatus }: { initialStatus: string }) {
  // Seeded from the URL by the page, then mirrored back into it: a refresh or a
  // shared link reopens the same filtered queue.
  const [statusFilter, setStatusFilter] = useState(initialStatus)
  useUrlQuery(paths.adminOrganizers(statusFilter))

  const qc = useQueryClient()
  const selection = useSelection()
  const [running, setRunning] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<BulkAction | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-organizers', statusFilter],
    queryFn: () =>
      apiGet<{ organizers: AdminOrganizerRow[] }>(
        `/api/admin/organizers${statusFilter === 'ALL' ? '' : `?status=${statusFilter}`}`
      ),
  })

  const organizers = data?.organizers ?? []
  // Stale ids from a previous filter are ignored rather than acted on blindly.
  const selected = organizers.filter((o) => selection.ids.has(o.id))

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['admin-organizers'] })
    qc.invalidateQueries({ queryKey: ['admin-stats'] })
  }

  const reviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      apiPut(`/api/admin/organizers/${id}`, { status }),
    onSuccess: (_d, vars) => {
      toast.success(vars.status === 'APPROVED' ? 'Organizer approved' : 'Organizer rejected')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const approvable = selected.filter((o) => o.status !== 'APPROVED')
  const rejectable = selected.filter((o) => o.status === 'PENDING')

  const bulkActions: BulkAction[] = [
    { key: 'APPROVED', label: 'Approve', icon: CheckCircle2, count: approvable.length },
    {
      key: 'REJECTED',
      label: 'Reject',
      icon: XCircle,
      count: rejectable.length,
      destructive: true,
      confirm: {
        title: `Reject ${rejectable.length} application${rejectable.length === 1 ? '' : 's'}?`,
        body: 'They will not be able to publish events. You can approve them later.',
        cta: 'Reject applications',
      },
    },
  ]

  async function runBulk(action: BulkAction) {
    const rows = action.key === 'APPROVED' ? approvable : rejectable
    if (rows.length === 0) return
    setRunning(action.key)
    const r = await mapLimit(rows, 5, (o) =>
      apiPut(`/api/admin/organizers/${o.id}`, { status: action.key })
    )
    setRunning(null)
    setConfirming(null)
    selection.clear()
    reportBulk('organizer', action.key === 'APPROVED' ? 'approved' : 'rejected', r)
    invalidate()
  }

  function statusBadge(status: string) {
    if (status === 'APPROVED') return <Badge>Approved</Badge>
    if (status === 'REJECTED') return <Badge variant="destructive">Rejected</Badge>
    return (
      <Badge variant="outline" className="border-chart-5/60">
        Pending
      </Badge>
    )
  }

  const allSelected = organizers.length > 0 && selected.length === organizers.length

  return (
    <section aria-labelledby="admin-organizers-heading" className="space-y-4">
      <SectionHeading
        id="admin-organizers-heading"
        title="Organizers"
        description={
          isLoading
            ? 'Loading applications…'
            : `${organizers.length} account${organizers.length === 1 ? '' : 's'} — approve applications and revoke access.`
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {ORGANIZER_FILTERS.map((f) => (
          <FilterChip key={f.v} active={statusFilter === f.v} onClick={() => setStatusFilter(f.v)}>
            {f.label}
          </FilterChip>
        ))}
        {organizers.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-xs"
            onClick={() => selection.setMany(organizers.map((o) => o.id), !allSelected)}
          >
            {allSelected ? 'Clear selection' : 'Select all'}
          </Button>
        )}
      </div>

      <BulkBar
        selectedCount={selected.length}
        actions={bulkActions}
        running={running}
        onClear={selection.clear}
        onRun={(a) => (a.confirm ? setConfirming(a) : runBulk(a))}
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : organizers.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={statusFilter === 'PENDING' ? 'No pending applications' : 'No organizers found'}
          description="Organizer applications will appear here for approval."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {organizers.map((o) => {
            const isSelected = selection.ids.has(o.id)
            const rowBusy =
              running !== null || (reviewMutation.isPending && reviewMutation.variables?.id === o.id)
            return (
              <li
                key={o.id}
                className={cn(
                  'rounded-2xl border bg-card p-4 transition-colors',
                  o.status === 'PENDING' && 'border-chart-5/50 bg-chart-5/5',
                  isSelected && 'ring-2 ring-primary/40',
                )}
              >
                <div className="grid gap-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => selection.toggle(o.id)}
                      aria-label={`Select ${o.organizationName}`}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{o.organizationName}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Applied {formatEventDate(o.createdAt)} · {o.eventCount} event
                        {o.eventCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    {statusBadge(o.status)}
                  </div>

                  <div className="rounded-md bg-muted/40 p-2.5 text-sm">
                    <p className="font-medium">{o.user.name}</p>
                    <p className="text-xs text-muted-foreground">{o.user.email}</p>
                    <p className="text-xs text-muted-foreground">{o.user.phone || 'No phone'}</p>
                  </div>

                  {o.status !== 'APPROVED' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 active:scale-[0.98]"
                        disabled={rowBusy}
                        onClick={() => reviewMutation.mutate({ id: o.id, status: 'APPROVED' })}
                      >
                        {rowBusy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                        Approve
                      </Button>
                      {o.status === 'PENDING' && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="flex-1 active:scale-[0.98]"
                          disabled={rowBusy}
                          onClick={() => reviewMutation.mutate({ id: o.id, status: 'REJECTED' })}
                        >
                          <XCircle /> Reject
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        action={confirming}
        running={running !== null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && runBulk(confirming)}
      />
    </section>
  )
}
