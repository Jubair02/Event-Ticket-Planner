'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Eye, Loader2, MoreHorizontal, Star, Ticket, XCircle } from 'lucide-react'
import { apiGet, apiPut } from '@/lib/api'
import { formatEventDate, formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { EventListItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/app/empty-state'
import { CategoryIcon } from '@/components/app/category-icon'
import { EventStatusBadge } from '@/components/dashboard/status-badges'
import {
  FilterChips,
  Meter,
  SearchBox,
  SectionHeading,
  sectionProps,
  type FilterOption,
} from '@/components/dashboard/primitives'
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

interface EventsResponse {
  events: EventListItem[]
  counts: Record<string, number>
  truncated: boolean
}

const EVENT_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING_APPROVAL', label: 'Pending' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'ONGOING', label: 'Ongoing' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
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

const COLUMNS = [
  { label: 'Select', srOnly: true, className: 'w-10' },
  { label: 'Event' },
  { label: 'Organizer' },
  { label: 'Sold' },
  { label: 'Status' },
  { label: 'Actions', srOnly: true, className: 'text-right' },
]

const sold = (e: EventListItem) => (e.ticketTypes ?? []).reduce((s, t) => s + t.soldQuantity, 0)
const capacity = (e: EventListItem) => (e.ticketTypes ?? []).reduce((s, t) => s + t.totalQuantity, 0)
const grossMinor = (e: EventListItem) =>
  (e.ticketTypes ?? []).reduce((s, t) => s + t.priceMinor * t.soldQuantity, 0)

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
      return apiGet<EventsResponse>(`/api/admin/events${qs ? `?${qs}` : ''}`)
    },
  })

  const events = data?.events ?? []
  const counts = data?.counts ?? {}
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
    const r = await mapLimit(rows, 5, (e) =>
      apiPut(`/api/admin/events/${e.id}`, { action: action.key }),
    )
    setRunning(null)
    setConfirming(null)
    selection.clear()
    reportBulk('event', EVENT_PAST_TENSE[action.key] ?? 'updated', r)
    invalidate()
  }

  const filters: FilterOption[] = EVENT_FILTERS.map((f) => ({
    ...f,
    count:
      f.value === 'ALL' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[f.value] ?? 0),
  }))

  const allSelected = events.length > 0 && selected.length === events.length
  const busy = running !== null

  return (
    <div className="space-y-6">
      <StatStrip
        {...sectionProps(0, '')}
        loading={isLoading}
        items={[
          {
            label: 'Awaiting approval',
            value: counts.PENDING_APPROVAL ?? 0,
            tone: (counts.PENDING_APPROVAL ?? 0) > 0 ? 'attention' : 'default',
          },
          { label: 'Published', value: counts.PUBLISHED ?? 0 },
          { label: 'Live now', value: counts.ONGOING ?? 0 },
          {
            label: 'Suspended',
            value: counts.SUSPENDED ?? 0,
            tone: (counts.SUSPENDED ?? 0) > 0 ? 'danger' : 'default',
          },
        ]}
      />

      <section aria-labelledby="admin-events-heading" {...sectionProps(1)}>
        <SectionHeading
          id="admin-events-heading"
          title="Events"
          description="Approve submissions, suspend what breaks the rules, and feature the best."
        />

        <ConsoleToolbar>
          <FilterChips
            value={statusFilter}
            onChange={setStatusFilter}
            options={filters}
            visible={5}
            label="Event status"
          />
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Event title"
            label="Search events"
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
          <ConsoleSkeleton rows={6} cols={5} />
        ) : events.length === 0 ? (
          <EmptyState
            icon={Ticket}
            title="No events here"
            description={
              search || statusFilter !== 'ALL'
                ? 'Nothing matches this filter. Try clearing it.'
                : 'Events appear here as organizers submit them.'
            }
          />
        ) : (
          <>
            <ConsoleTable columns={COLUMNS} caption="All events, newest first">
              {events.map((e) => {
                const cap = capacity(e)
                const s = sold(e)
                const acting = actionMutation.isPending && actionMutation.variables?.id === e.id
                return (
                  <ConsoleRow
                    key={e.id}
                    tone={
                      e.status === 'PENDING_APPROVAL'
                        ? 'attention'
                        : e.status === 'SUSPENDED' || e.status === 'CANCELLED'
                          ? 'danger'
                          : undefined
                    }
                  >
                    <ConsoleCell label="Select" className="md:w-10">
                      <Checkbox
                        checked={selection.ids.has(e.id)}
                        onCheckedChange={() => selection.toggle(e.id)}
                        aria-label={`Select ${e.title}`}
                        disabled={busy}
                      />
                    </ConsoleCell>
                    <ConsoleCell label="Event">
                      <RowIdentity
                        icon={<CategoryIcon category={e.category} className="size-4" />}
                        title={
                          <span className="flex items-center gap-1.5">
                            <span className="truncate">{e.title}</span>
                            {e.featured && (
                              <Star
                                className="size-3.5 shrink-0 fill-chart-5 text-chart-5"
                                aria-label="Featured"
                              />
                            )}
                          </span>
                        }
                        href={paths.event(e)}
                        meta={`${formatEventDate(e.startDate)} · ${e.city}`}
                        tone={
                          e.status === 'PUBLISHED' || e.status === 'ONGOING' ? 'default' : 'muted'
                        }
                      />
                    </ConsoleCell>
                    <ConsoleCell label="Organizer">
                      <span className="block truncate">{e.organizer.organizationName}</span>
                      {e.organizer.user?.name && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {e.organizer.user.name}
                        </span>
                      )}
                    </ConsoleCell>
                    <ConsoleCell label="Sold">
                      <span className="block text-xs tabular-nums">
                        {s}
                        <span className="text-muted-foreground">/{cap}</span>
                        {s > 0 && (
                          <span className="text-muted-foreground">
                            {' '}
                            · {formatMinor(grossMinor(e))}
                          </span>
                        )}
                      </span>
                      <Meter
                        className="mt-1.5 md:w-32"
                        value={s}
                        max={cap}
                        label={`${e.title}: ${s} of ${cap} tickets sold`}
                      />
                    </ConsoleCell>
                    <ConsoleCell label="Status">
                      <EventStatusBadge status={e.status} />
                    </ConsoleCell>
                    <ConsoleActions>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={e.featured ? `Unfeature ${e.title}` : `Feature ${e.title}`}
                        title={e.featured ? 'Unfeature' : 'Feature on the homepage'}
                        disabled={busy || acting}
                        onClick={() =>
                          actionMutation.mutate({
                            id: e.id,
                            action: e.featured ? 'unfeature' : 'feature',
                          })
                        }
                      >
                        <Star className={cn('size-4', e.featured && 'fill-chart-5 text-chart-5')} />
                      </Button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            className="size-8"
                            aria-label={`Actions for ${e.title}`}
                            disabled={busy || acting}
                          >
                            {acting ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="size-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {EVENT_ELIGIBLE.approve(e) && (
                            <DropdownMenuItem
                              onClick={() => actionMutation.mutate({ id: e.id, action: 'approve' })}
                            >
                              <CheckCircle2 /> Approve and publish
                            </DropdownMenuItem>
                          )}
                          {EVENT_ELIGIBLE.reject(e) && (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => actionMutation.mutate({ id: e.id, action: 'reject' })}
                            >
                              <XCircle /> Reject
                            </DropdownMenuItem>
                          )}
                          {EVENT_ELIGIBLE.suspend(e) && (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => actionMutation.mutate({ id: e.id, action: 'suspend' })}
                            >
                              <XCircle /> Suspend
                            </DropdownMenuItem>
                          )}
                          {e.status === 'SUSPENDED' && (
                            <DropdownMenuItem
                              onClick={() => actionMutation.mutate({ id: e.id, action: 'restore' })}
                            >
                              <CheckCircle2 /> Restore to published
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild>
                            <Link href={paths.event(e)}>
                              <Eye /> View public page
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ConsoleActions>
                  </ConsoleRow>
                )
              })}
            </ConsoleTable>

            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() =>
                  selection.setMany(
                    events.map((e) => e.id),
                    !allSelected,
                  )
                }
              >
                {allSelected ? 'Clear selection' : `Select all ${events.length}`}
              </Button>
              {data?.truncated && <TruncatedNote shown={events.length} noun="events" />}
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
