'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Eye, Loader2, MoreHorizontal, Star, Ticket, XCircle } from 'lucide-react'
import { apiGet, apiPut } from '@/lib/api'
import { categoryEmoji, formatEventDate } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { EventListItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/app/empty-state'
import { EventStatusBadge } from '@/components/dashboard/status-badges'
import {
  FilterChips,
  SearchBox,
  SectionHeading,
  entrance,
  panelClass,
} from '@/components/dashboard/primitives'
import { useUrlQuery } from '@/components/dashboard/use-url-query'
import {
  BulkBar,
  ConfirmDialog,
  mapLimit,
  reportBulk,
  useDebounced,
  useSelection,
  type BulkAction,
} from './shared'

// ============================= Events =============================

const EVENT_FILTERS = [
  { v: 'ALL', label: 'All' },
  { v: 'PENDING_APPROVAL', label: 'Pending' },
  { v: 'PUBLISHED', label: 'Published' },
  { v: 'SUSPENDED', label: 'Suspended' },
  { v: 'REJECTED', label: 'Rejected' },
  { v: 'DRAFT', label: 'Draft' },
  { v: 'ONGOING', label: 'Ongoing' },
  { v: 'COMPLETED', label: 'Completed' },
  { v: 'CANCELLED', label: 'Cancelled' },
]

/**
 * Which selected rows each bulk action can actually apply to, so a bulk run
 * never fires a request the API will reject. The approve/reject/suspend entries
 * mirror ALLOWED_FROM in `PUT /api/admin/events/[id]` — keep the two in sync.
 * `feature` is not a status transition; it only skips already-featured rows.
 */
const EVENT_ELIGIBLE: Record<string, (e: EventListItem) => boolean> = {
  approve: (e) => ['PENDING_APPROVAL', 'REJECTED', 'SUSPENDED'].includes(e.status),
  reject: (e) => e.status === 'PENDING_APPROVAL',
  suspend: (e) => ['PUBLISHED', 'ONGOING'].includes(e.status),
  feature: (e) => !e.featured,
}

/** `${action}ed` would render "approveed". */
const EVENT_PAST_TENSE: Record<string, string> = {
  approve: 'approved',
  reject: 'rejected',
  suspend: 'suspended',
  feature: 'featured',
}

export function AdminEvents({
  initialStatus,
  initialSearch,
}: {
  initialStatus: string
  initialSearch: string
}) {
  // Seeded from the URL by the page. The search box keeps its own state so
  // typing stays instant; only the debounced value reaches the query and the
  // address bar, so a refresh restores the search that was actually run.
  const [statusFilter, setStatusFilter] = useState(initialStatus)
  const [search, setSearch] = useState(initialSearch)

  const qc = useQueryClient()
  const selection = useSelection()
  const [running, setRunning] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<BulkAction | null>(null)
  const q = useDebounced(search)
  useUrlQuery(paths.adminEvents({ status: statusFilter, q: q.trim() }))

  const { data, isLoading } = useQuery({
    queryKey: ['admin-events', statusFilter, q],
    queryFn: () => {
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (q.trim()) params.set('q', q.trim())
      const qs = params.toString()
      return apiGet<{ events: EventListItem[] }>(`/api/admin/events${qs ? `?${qs}` : ''}`)
    },
  })

  const events = data?.events ?? []
  const selected = events.filter((e) => selection.ids.has(e.id))

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['admin-events'] })
    qc.invalidateQueries({ queryKey: ['admin-stats'] })
    qc.invalidateQueries({ queryKey: ['events'] })
  }

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      apiPut(`/api/admin/events/${id}`, { action }),
    onSuccess: (_d, vars) => {
      const messages: Record<string, string> = {
        approve: 'Event approved and published',
        reject: 'Event rejected',
        suspend: 'Event suspended',
        restore: 'Event restored to published',
        feature: 'Event featured on the homepage',
        unfeature: 'Event unfeatured',
      }
      toast.success(messages[vars.action] ?? 'Event updated')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const eligible = (action: string) => selected.filter(EVENT_ELIGIBLE[action])

  const bulkActions: BulkAction[] = [
    { key: 'approve', label: 'Approve', icon: CheckCircle2, count: eligible('approve').length },
    {
      key: 'reject',
      label: 'Reject',
      icon: XCircle,
      count: eligible('reject').length,
      destructive: true,
      confirm: {
        title: `Reject ${eligible('reject').length} event${eligible('reject').length === 1 ? '' : 's'}?`,
        body: 'The organizers will need to resubmit. Nothing is deleted.',
        cta: 'Reject events',
      },
    },
    {
      key: 'suspend',
      label: 'Suspend',
      icon: XCircle,
      count: eligible('suspend').length,
      destructive: true,
      confirm: {
        title: `Suspend ${eligible('suspend').length} event${eligible('suspend').length === 1 ? '' : 's'}?`,
        body: 'They are pulled from the public site immediately. You can restore them later.',
        cta: 'Suspend events',
      },
    },
    { key: 'feature', label: 'Feature', icon: Star, count: eligible('feature').length },
  ]

  async function runBulk(action: BulkAction) {
    const rows = eligible(action.key)
    if (rows.length === 0) return
    setRunning(action.key)
    const r = await mapLimit(rows, 5, (e) => apiPut(`/api/admin/events/${e.id}`, { action: action.key }))
    setRunning(null)
    setConfirming(null)
    selection.clear()
    reportBulk('event', EVENT_PAST_TENSE[action.key] ?? 'updated', r)
    invalidate()
  }

  const allSelected = events.length > 0 && selected.length === events.length
  const busy = running !== null

  return (
    <section aria-labelledby="admin-events-heading" className="space-y-4">
      <SectionHeading
        id="admin-events-heading"
        title="Events"
        description={
          isLoading
            ? 'Loading events…'
            : `${events.length} event${events.length === 1 ? '' : 's'} — approve submissions, suspend, and feature.`
        }
      >
        <SearchBox value={search} onChange={setSearch} placeholder="Search events…" label="Search events" />
      </SectionHeading>

      <FilterChips
        value={statusFilter}
        onChange={setStatusFilter}
        options={EVENT_FILTERS.map((f) => ({ value: f.v, label: f.label }))}
        visible={4}
        label="Event status"
      />

      <BulkBar
        selectedCount={selected.length}
        actions={bulkActions}
        running={running}
        onClear={selection.clear}
        onRun={(a) => (a.confirm ? setConfirming(a) : runBulk(a))}
      />

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState icon={Ticket} title="No events found" description="Try a different filter or search term." />
      ) : (
        <div className={cn(panelClass, 'overflow-x-auto')}>
          <Table className="min-w-[860px]">
            <caption className="sr-only">
              All platform events with organizer, date, status and moderation actions
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(c) => selection.setMany(events.map((e) => e.id), c === true)}
                    aria-label="Select all events"
                  />
                </TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Organizer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Featured</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => {
                const isSelected = selection.ids.has(e.id)
                const rowBusy =
                  busy || (actionMutation.isPending && actionMutation.variables?.id === e.id)
                return (
                  <TableRow
                    key={e.id}
                    data-state={isSelected ? 'selected' : undefined}
                    className={cn(e.status === 'PENDING_APPROVAL' && !isSelected && 'bg-chart-5/10')}
                  >
                    <TableCell>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => selection.toggle(e.id)}
                        aria-label={`Select ${e.title}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {e.banner ? (
                          <img
                            src={e.banner}
                            alt={`${e.title} banner`}
                            className="h-10 w-16 shrink-0 rounded object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded bg-muted text-lg">
                            {categoryEmoji(e.category)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="max-w-[220px] truncate font-medium">{e.title}</p>
                          <p className="text-xs text-muted-foreground">{e.city}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[180px] truncate text-sm font-medium">
                        {e.organizer?.organizationName ?? '—'}
                      </p>
                      <p className="text-xs text-muted-foreground">{e.organizer?.user?.name ?? ''}</p>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{formatEventDate(e.startDate)}</TableCell>
                    <TableCell>
                      <EventStatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={rowBusy}
                        aria-label={e.featured ? `Unfeature ${e.title}` : `Feature ${e.title}`}
                        aria-pressed={e.featured}
                        onClick={() =>
                          actionMutation.mutate({ id: e.id, action: e.featured ? 'unfeature' : 'feature' })
                        }
                      >
                        <Star
                          className={cn(
                            'h-4 w-4 transition-colors',
                            e.featured ? 'fill-chart-5 text-chart-5' : 'text-muted-foreground',
                          )}
                        />
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Actions for ${e.title}`}
                          >
                            {rowBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="h-4 w-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {e.status === 'PENDING_APPROVAL' && (
                            <>
                              <DropdownMenuItem
                                onSelect={() => actionMutation.mutate({ id: e.id, action: 'approve' })}
                              >
                                <CheckCircle2 /> Approve
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => actionMutation.mutate({ id: e.id, action: 'reject' })}
                              >
                                <XCircle /> Reject
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          {e.status === 'SUSPENDED' && (
                            <DropdownMenuItem
                              onSelect={() => actionMutation.mutate({ id: e.id, action: 'restore' })}
                            >
                              <CheckCircle2 /> Restore
                            </DropdownMenuItem>
                          )}
                          {(e.status === 'PUBLISHED' || e.status === 'ONGOING') && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => actionMutation.mutate({ id: e.id, action: 'suspend' })}
                            >
                              <XCircle /> Suspend
                            </DropdownMenuItem>
                          )}
                          {e.status === 'REJECTED' && (
                            <DropdownMenuItem
                              onSelect={() => actionMutation.mutate({ id: e.id, action: 'approve' })}
                            >
                              <CheckCircle2 /> Approve
                            </DropdownMenuItem>
                          )}
                          {e.status === 'PUBLISHED' && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem asChild>
                                <Link href={paths.event(e)}>
                                  <Eye /> View public page
                                </Link>
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        action={confirming}
        running={busy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && runBulk(confirming)}
      />
    </section>
  )
}
