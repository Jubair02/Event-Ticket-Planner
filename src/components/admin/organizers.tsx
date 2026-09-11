'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Building2, CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import { apiGet, apiPut } from '@/lib/api'
import { formatEventDate } from '@/lib/format'
import { paths } from '@/lib/routes'
import type { AdminOrganizerRow } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/app/empty-state'
import {
  FilterChips,
  SearchBox,
  SectionHeading,
  sectionProps,
  type FilterOption,
} from '@/components/dashboard/primitives'
import { AccountStatusBadge, OrganizerStatusBadge } from '@/components/dashboard/status-badges'
import { useUrlQuery } from '@/components/dashboard/use-url-query'
import {
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
import {
  BulkBar,
  ConfirmDialog,
  mapLimit,
  reportBulk,
  useDebounced,
  useSelection,
  type BulkAction,
} from './shared'

interface OrganizersResponse {
  organizers: AdminOrganizerRow[]
  counts: Record<string, number>
  truncated: boolean
}

const ORGANIZER_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
]

const COLUMNS = [
  { label: 'Select', srOnly: true, className: 'w-10' },
  { label: 'Organization' },
  { label: 'Contact' },
  { label: 'Events', className: 'text-center' },
  { label: 'Status' },
  { label: 'Actions', srOnly: true, className: 'text-right' },
]

export function AdminOrganizers({
  initialStatus,
  initialSearch = '',
}: {
  initialStatus: string
  initialSearch?: string
}) {
  // Seeded from the URL by the page, then mirrored back into it: a refresh or a
  // shared link reopens the same filtered queue.
  const [statusFilter, setStatusFilter] = useState(initialStatus)
  const [search, setSearch] = useState(initialSearch)
  const q = useDebounced(search)
  useUrlQuery(paths.adminOrganizers({ status: statusFilter, q: q.trim() }))

  const qc = useQueryClient()
  const selection = useSelection()
  const [running, setRunning] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<BulkAction | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-organizers', statusFilter, q],
    queryFn: () => {
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (q.trim()) params.set('q', q.trim())
      const qs = params.toString()
      return apiGet<OrganizersResponse>(`/api/admin/organizers${qs ? `?${qs}` : ''}`)
    },
  })

  const organizers = data?.organizers ?? []
  const counts = data?.counts ?? {}
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
      apiPut(`/api/admin/organizers/${o.id}`, { status: action.key }),
    )
    setRunning(null)
    setConfirming(null)
    selection.clear()
    reportBulk('organizer', action.key === 'APPROVED' ? 'approved' : 'rejected', r)
    invalidate()
  }

  const filters: FilterOption[] = ORGANIZER_FILTERS.map((f) => ({
    ...f,
    count:
      f.value === 'ALL' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[f.value] ?? 0),
  }))

  const allSelected = organizers.length > 0 && selected.length === organizers.length
  const busy = running !== null

  return (
    <div className="space-y-6">
      <StatStrip
        {...sectionProps(0, '')}
        loading={isLoading}
        items={[
          {
            label: 'Awaiting review',
            value: counts.PENDING ?? 0,
            tone: (counts.PENDING ?? 0) > 0 ? 'attention' : 'default',
          },
          { label: 'Approved', value: counts.APPROVED ?? 0 },
          { label: 'Rejected', value: counts.REJECTED ?? 0 },
          {
            label: 'Events listed',
            value: organizers.reduce((sum, o) => sum + o.eventCount, 0),
          },
        ]}
      />

      <section aria-labelledby="admin-organizers-heading" {...sectionProps(1)}>
        <SectionHeading
          id="admin-organizers-heading"
          title="Organizers"
          description="Approve applications and revoke access. Rejecting keeps their data."
        />

        <ConsoleToolbar>
          <FilterChips
            value={statusFilter}
            onChange={setStatusFilter}
            options={filters}
            visible={4}
            label="Application status"
          />
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Organization, name or email"
            label="Search organizers"
          />
        </ConsoleToolbar>

        <BulkBar
          selectedCount={selected.length}
          actions={bulkActions}
          running={running}
          onRun={(a) => (a.confirm ? setConfirming(a) : runBulk(a))}
          onClear={selection.clear}
        />

        {isLoading ? (
          <ConsoleSkeleton rows={5} cols={5} />
        ) : organizers.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No organizers here"
            description={
              search || statusFilter !== 'ALL'
                ? 'Nothing matches this filter. Try clearing it.'
                : 'Organizer applications arrive when someone signs up to sell tickets.'
            }
          />
        ) : (
          <>
            <ConsoleTable columns={COLUMNS} caption="Organizer applications, newest first">
              {organizers.map((o) => (
                <ConsoleRow key={o.id} tone={o.status === 'PENDING' ? 'attention' : undefined}>
                  <ConsoleCell label="Select" className="md:w-10">
                    <Checkbox
                      checked={selection.ids.has(o.id)}
                      onCheckedChange={() => selection.toggle(o.id)}
                      aria-label={`Select ${o.organizationName}`}
                      disabled={busy}
                    />
                  </ConsoleCell>
                  <ConsoleCell label="Organization">
                    <RowIdentity
                      icon={<Building2 className="size-4" />}
                      title={o.organizationName}
                      meta={`Applied ${formatEventDate(o.createdAt)}`}
                      tone={o.status === 'APPROVED' ? 'default' : 'muted'}
                    />
                  </ConsoleCell>
                  <ConsoleCell label="Contact">
                    <span className="block truncate">{o.user.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {o.user.email}
                    </span>
                    {o.phone && (
                      <span className="block truncate text-xs text-muted-foreground tabular-nums">
                        {o.phone}
                      </span>
                    )}
                    <span className="mt-1 block">
                      <AccountStatusBadge status={o.user.status} />
                    </span>
                  </ConsoleCell>
                  <ConsoleCell label="Events" align="center">
                    <span className="tabular-nums">{o.eventCount}</span>
                  </ConsoleCell>
                  <ConsoleCell label="Status">
                    <OrganizerStatusBadge status={o.status} />
                  </ConsoleCell>
                  <ConsoleActions>
                    {o.status !== 'APPROVED' && (
                      <Button
                        size="sm"
                        className="h-8 active:scale-[0.98] motion-reduce:transform-none"
                        disabled={busy || reviewMutation.isPending}
                        onClick={() => reviewMutation.mutate({ id: o.id, status: 'APPROVED' })}
                      >
                        {reviewMutation.isPending &&
                        reviewMutation.variables?.id === o.id &&
                        reviewMutation.variables?.status === 'APPROVED' ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <CheckCircle2 />
                        )}
                        Approve
                      </Button>
                    )}
                    {o.status === 'PENDING' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={busy || reviewMutation.isPending}
                        onClick={() => reviewMutation.mutate({ id: o.id, status: 'REJECTED' })}
                      >
                        <XCircle /> Reject
                      </Button>
                    )}
                    {o.status === 'REJECTED' && (
                      <span className="text-xs text-muted-foreground md:hidden">
                        Rejected — approve to restore
                      </span>
                    )}
                  </ConsoleActions>
                </ConsoleRow>
              ))}
            </ConsoleTable>

            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() =>
                  selection.setMany(
                    organizers.map((o) => o.id),
                    !allSelected,
                  )
                }
              >
                {allSelected ? 'Clear selection' : `Select all ${organizers.length}`}
              </Button>
              {data?.truncated && <TruncatedNote shown={organizers.length} noun="organizers" />}
            </div>
          </>
        )}
      </section>

      <ConfirmDialog
        action={confirming}
        running={busy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && runBulk(confirming)}
      />
    </div>
  )
}
