'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BarChart3,
  CalendarPlus,
  ChevronRight,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pencil,
  PlayCircle,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import { categoryLabel, formatEventDate } from '@/lib/format'
import { EVENT_STATUS_LABELS } from '@/lib/constants'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { paths } from '@/lib/routes'
import type { EventListItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/app/empty-state'
import { EventStatusBadge } from '@/components/dashboard/status-badges'
import { CategoryIcon } from '@/components/app/category-icon'
import {
  FilterChips,
  Meter,
  Panel,
  SectionHeading,
  entrance,
} from '@/components/dashboard/primitives'
import { useUrlQuery } from '@/components/dashboard/use-url-query'
import { cn } from '@/lib/utils'
import { EventForm } from './event-form'
import { EventAnalytics } from './event-analytics'

/** Chip order: the four an organizer reaches for most come first; the rest fold into "More". */
const STATUSES = [
  'PUBLISHED',
  'PENDING_APPROVAL',
  'DRAFT',
  'ONGOING',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
  'SUSPENDED',
] as const

function soldOf(e: EventListItem): number {
  return (e.ticketTypes || []).reduce((acc, t) => acc + t.soldQuantity, 0)
}
function totalOf(e: EventListItem): number {
  return (e.ticketTypes || []).reduce((acc, t) => acc + t.totalQuantity, 0)
}

export function EventsManager({
  initialAnalyticsEventId,
  initialStatus = 'ALL',
  createOnArrival = false,
}: {
  /** Deep link from /organizer/events/[eventId]. */
  initialAnalyticsEventId?: string
  /** Status chip to preselect, from `?status=` on the route. */
  initialStatus?: string
  /** `?new=1` — the dashboard's Create event button, from any section. */
  createOnArrival?: boolean
} = {}) {
  const qc = useQueryClient()
  const router = useRouter()
  const [filter, setFilter] = useState<string>(initialStatus)
  useUrlQuery(paths.organizerEvents(filter))
  const [formOpen, setFormOpen] = useState(createOnArrival)
  const [editing, setEditing] = useState<EventListItem | null>(null)
  const [analyticsEventId, setAnalyticsEventId] = useState<string | null>(
    initialAnalyticsEventId ?? null,
  )
  const [cancelTarget, setCancelTarget] = useState<EventListItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EventListItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['organizer-events'],
    queryFn: () => apiGet<{ events: EventListItem[] }>('/api/organizer/events'),
  })

  const events = data?.events ?? []

  const counts = useMemo(() => {
    const map: Record<string, number> = { ALL: events.length }
    for (const s of STATUSES) map[s] = 0
    for (const e of events) map[e.status] = (map[e.status] ?? 0) + 1
    return map
  }, [events])

  const filtered = filter === 'ALL' ? events : events.filter((e) => e.status === filter)

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['organizer-events'] })
    qc.invalidateQueries({ queryKey: ['organizer-stats'] })
  }

  const submitMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/organizer/events/${id}/submit`),
    onSuccess: () => {
      toast.success('Event submitted for approval')
      invalidateAll()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ONGOING' | 'COMPLETED' }) =>
      apiPut(`/api/organizer/events/${id}`, { status }),
    onSuccess: (_d, vars) => {
      toast.success(vars.status === 'ONGOING' ? 'Event marked as ongoing' : 'Event marked as completed')
      invalidateAll()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/organizer/events/${id}/cancel`),
    onSuccess: () => {
      toast.success('Event cancelled')
      setCancelTarget(null)
      invalidateAll()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/organizer/events/${id}`),
    onSuccess: () => {
      toast.success('Event deleted')
      setDeleteTarget(null)
      invalidateAll()
    },
    onError: (e: Error) => {
      // The server's own message (e.g. "Cannot delete an event with orders") is the useful one.
      toast.error(e.message)
      setDeleteTarget(null)
    },
  })

  /**
   * Which row, if any, has a request in flight. One shared flag used to spin the
   * menu on every row at once, so you could not tell which event was being acted on.
   */
  function busyRow(id: string) {
    return (
      (submitMutation.isPending && submitMutation.variables === id) ||
      (statusMutation.isPending && statusMutation.variables?.id === id) ||
      (cancelMutation.isPending && cancelMutation.variables === id) ||
      (deleteMutation.isPending && deleteMutation.variables === id)
    )
  }

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  const filterOptions = [
    { value: 'ALL', label: 'All', count: counts.ALL },
    ...STATUSES.map((s) => ({ value: s, label: EVENT_STATUS_LABELS[s] ?? s, count: counts[s] ?? 0 })),
  ]

  /**
   * The per-row overflow menu.
   *
   * A render helper rather than a component, so the table and the small-screen
   * card list share one copy of the lifecycle actions without threading eight
   * mutation handlers through props.
   */
  function renderActions(e: EventListItem) {
    const rowBusy = busyRow(e.id)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 cursor-pointer"
            aria-label={`Actions for ${e.title}`}
            disabled={rowBusy}
          >
            {rowBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={() => {
              setEditing(e)
              setFormOpen(true)
            }}
          >
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAnalyticsEventId(e.id)}>
            <BarChart3 /> Analytics
          </DropdownMenuItem>
          {(e.status === 'DRAFT' || e.status === 'REJECTED') && (
            <DropdownMenuItem onSelect={() => submitMutation.mutate(e.id)}>
              <Send /> Submit for approval
            </DropdownMenuItem>
          )}
          {e.status === 'PUBLISHED' && (
            <DropdownMenuItem onSelect={() => statusMutation.mutate({ id: e.id, status: 'ONGOING' })}>
              <PlayCircle /> Mark ongoing
            </DropdownMenuItem>
          )}
          {(e.status === 'PUBLISHED' || e.status === 'ONGOING') && (
            <DropdownMenuItem
              onSelect={() => statusMutation.mutate({ id: e.id, status: 'COMPLETED' })}
            >
              <ExternalLink /> Mark completed
            </DropdownMenuItem>
          )}
          {e.status !== 'CANCELLED' && e.status !== 'COMPLETED' && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setCancelTarget(e)}
            >
              <XCircle /> Cancel event
            </DropdownMenuItem>
          )}
          {(e.status === 'PUBLISHED' || e.status === 'ONGOING') && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={paths.event(e)}>
                  <ExternalLink /> View public page
                </Link>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setDeleteTarget(e)}
          >
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  /** The event's thumbnail, or its category mark when there is no banner. */
  function renderThumb(e: EventListItem, className: string) {
    return e.banner ? (
      <img
        src={e.banner}
        alt=""
        className={cn('shrink-0 rounded-md object-cover', className)}
        loading="lazy"
        decoding="async"
      />
    ) : (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary',
          className,
        )}
        aria-hidden="true"
      >
        <CategoryIcon category={e.category} className="size-4" />
      </div>
    )
  }

  return (
    <section aria-labelledby="organizer-events-heading" className="space-y-4">
      <div {...entrance(0)}>
        <SectionHeading
          id="organizer-events-heading"
          title="Your events"
          description={
            isLoading
              ? 'Loading events…'
              : `${events.length} event${events.length === 1 ? '' : 's'} — edit, submit for approval, and track sales.`
          }
        >
          <Button className="active:scale-[0.98] motion-reduce:transform-none" onClick={openCreate}>
            <CalendarPlus /> Create event
          </Button>
        </SectionHeading>
      </div>

      <div {...entrance(1)}>
        <FilterChips value={filter} onChange={setFilter} options={filterOptions} visible={4} label="Event status" />
      </div>

      <div {...entrance(2)}>
        {isLoading ? (
          <Panel padded={false} className="divide-y divide-border/70">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 p-4">
                <Skeleton className="h-10 w-16 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            ))}
          </Panel>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CalendarPlus}
            title={
              filter === 'ALL'
                ? 'No events yet'
                : `No ${(EVENT_STATUS_LABELS[filter] ?? filter).toLowerCase()} events`
            }
            description={
              filter === 'ALL'
                ? 'Create your first event, set up ticket types and start selling in minutes.'
                : 'Try another status filter, or create a new event.'
            }
            action={
              <Button onClick={openCreate}>
                <CalendarPlus /> Create event
              </Button>
            }
          />
        ) : (
          <>
            {/* ── small screens: cards ──
                The table below needs 860px and used to scroll sideways to get
                it, which is the one layout rule this dashboard was breaking.
                Same data, stacked, with the row itself opening analytics. */}
            <Panel padded={false} className="overflow-hidden lg:hidden">
              <h3 className="sr-only">Your events</h3>
              <ul className="divide-y divide-border/70">
                {filtered.map((e) => {
                  const sold = soldOf(e)
                  const total = totalOf(e)
                  const pct = total > 0 ? Math.min(100, Math.round((sold / total) * 100)) : 0
                  return (
                    <li key={e.id} className="flex items-center gap-1 pr-2">
                      <Link
                        href={paths.organizerEvent(e.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-4 transition-colors duration-200 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {renderThumb(e, 'size-11')}
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="truncate text-sm font-medium">{e.title}</span>
                            <EventStatusBadge status={e.status} />
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground tabular-nums">
                            {categoryLabel(e.category)} · {e.city} · {formatEventDate(e.startDate)}
                          </span>
                          {total > 0 && (
                            <span className="mt-2 flex items-center gap-2">
                              <Meter
                                value={sold}
                                max={total}
                                label={`${sold} of ${total} tickets sold, ${pct}%`}
                                className="w-16 shrink-0"
                              />
                              <span className="text-[11px] text-muted-foreground tabular-nums">
                                {sold}/{total} · {pct}%
                              </span>
                            </span>
                          )}
                        </span>
                        <ChevronRight
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </Link>
                      {renderActions(e)}
                    </li>
                  )
                })}
              </ul>
            </Panel>

            {/* ── large screens: the table ── */}
            {/* Guard without a floor: no `min-w`, so the table never *forces*
                a sideways scroll, but it degrades to one instead of breaking if
                a long title and a wide badge ever collide. */}
            <Panel padded={false} className="hidden overflow-x-auto lg:block">
              <Table>
                <caption className="sr-only">
                  Your events with category, date, ticket sales, status and actions
                </caption>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Event</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Tickets</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((e) => {
                    const sold = soldOf(e)
                    const total = totalOf(e)
                    const pct = total > 0 ? Math.min(100, Math.round((sold / total) * 100)) : 0
                    return (
                      <TableRow key={e.id} className="transition-colors">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {renderThumb(e, 'h-10 w-16')}
                            <div className="min-w-0">
                              {/* The row's own job is "how is this selling", so
                                  the title opens analytics in one click rather
                                  than two through the overflow menu. */}
                              <Link
                                href={paths.organizerEvent(e.id)}
                                className="block max-w-[240px] truncate rounded font-medium underline-offset-4 transition-colors duration-200 hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                              >
                                {e.title}
                              </Link>
                              <p className="text-xs text-muted-foreground">{e.city}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="gap-1.5 font-normal">
                            <CategoryIcon category={e.category} className="size-3" />
                            {categoryLabel(e.category)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap tabular-nums">
                          {formatEventDate(e.startDate)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <p className="text-sm tabular-nums">
                            {sold}
                            <span className="text-muted-foreground">/{total || '—'}</span>
                          </p>
                          {total > 0 && (
                            <Meter
                              value={sold}
                              max={total}
                              label={`${sold} of ${total} tickets sold, ${pct}%`}
                              className="mt-1.5 w-20"
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <EventStatusBadge status={e.status} />
                        </TableCell>
                        <TableCell className="text-right">{renderActions(e)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Panel>
          </>
        )}
      </div>

      {/* Create / edit dialog */}
      <EventForm editing={editing} open={formOpen} onOpenChange={setFormOpen} />

      {/* Analytics dialog */}
      {analyticsEventId && (
        <EventAnalytics
          eventId={analyticsEventId}
          onClose={() => {
            setAnalyticsEventId(null)
            // Arrived via /organizer/events/[id]: drop back to the list URL so
            // Back does not reopen the panel that was just dismissed.
            if (initialAnalyticsEventId) router.push(paths.organizerEvents())
          }}
        />
      )}

      {/* Cancel confirm */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this event?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.title} will be marked as cancelled and all of its active tickets invalidated. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep event</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(ev) => {
                ev.preventDefault()
                if (cancelTarget) cancelMutation.mutate(cancelTarget.id)
              }}
            >
              {cancelMutation.isPending && <Loader2 className="animate-spin" />}
              Cancel event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this event?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.title} and its ticket types will be permanently deleted. Events with existing orders
              cannot be deleted — cancel them instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep event</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(ev) => {
                ev.preventDefault()
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
              }}
            >
              {deleteMutation.isPending && <Loader2 className="animate-spin" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
