'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BarChart3,
  CalendarPlus,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react'
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from '@/lib/api'
import { categoryEmoji, categoryLabel, formatEventDate } from '@/lib/format'
import { EVENT_STATUS_LABELS } from '@/lib/constants'
import { useAppStore } from '@/lib/store'
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
import { EventStatusBadge } from './organizer-dashboard'
import { EventForm } from './event-form'
import { EventAnalytics } from './event-analytics'

const STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'PUBLISHED',
  'ONGOING',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'SUSPENDED',
] as const

function soldOf(e: EventListItem): number {
  return (e.ticketTypes || []).reduce((acc, t) => acc + t.soldQuantity, 0)
}
function totalOf(e: EventListItem): number {
  return (e.ticketTypes || []).reduce((acc, t) => acc + t.totalQuantity, 0)
}

export function EventsManager() {
  const qc = useQueryClient()
  const navigate = useAppStore((s) => s.navigate)
  const [filter, setFilter] = useState<string>('ALL')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EventListItem | null>(null)
  const [analyticsEventId, setAnalyticsEventId] = useState<string | null>(null)
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
      toast.error(e.message)
      if (e instanceof ApiError && e.status === 409) {
        // server message already shown via toast (e.g. "Cannot delete an event with orders.")
      }
      setDeleteTarget(null)
    },
  })

  const pendingMutation =
    submitMutation.isPending || statusMutation.isPending || cancelMutation.isPending || deleteMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Status filter chips */}
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={filter === 'ALL' ? 'default' : 'outline'}
            className="h-7 rounded-full px-3 text-xs"
            onClick={() => setFilter('ALL')}
          >
            All ({counts.ALL})
          </Button>
          {STATUSES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={filter === s ? 'default' : 'outline'}
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => setFilter(s)}
            >
              {EVENT_STATUS_LABELS[s]} ({counts[s] ?? 0})
            </Button>
          ))}
        </div>
        <Button
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          <CalendarPlus className="mr-2 h-4 w-4" /> Create Event
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={CalendarPlus}
          title={filter === 'ALL' ? 'No events yet' : `No ${EVENT_STATUS_LABELS[filter]?.toLowerCase() ?? filter} events`}
          description="Create your first event, set up ticket types and start selling in minutes."
          action={
            <Button
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              <CalendarPlus className="mr-2 h-4 w-4" /> Create Event
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
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
                return (
                  <TableRow key={e.id}>
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
                          <p className="max-w-[240px] truncate font-medium">{e.title}</p>
                          <p className="text-xs text-muted-foreground">{e.city}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {categoryEmoji(e.category)} {categoryLabel(e.category)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatEventDate(e.startDate)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {sold}/{total || '—'}
                    </TableCell>
                    <TableCell>
                      <EventStatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${e.title}`}>
                            {pendingMutation ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="h-4 w-4" />
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
                            <Pencil className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setAnalyticsEventId(e.id)}>
                            <BarChart3 className="mr-2 h-4 w-4" /> Analytics
                          </DropdownMenuItem>
                          {(e.status === 'DRAFT' || e.status === 'REJECTED') && (
                            <DropdownMenuItem onSelect={() => submitMutation.mutate(e.id)}>
                              <Send className="mr-2 h-4 w-4" /> Submit for Approval
                            </DropdownMenuItem>
                          )}
                          {e.status === 'PUBLISHED' && (
                            <DropdownMenuItem
                              onSelect={() => statusMutation.mutate({ id: e.id, status: 'ONGOING' })}
                            >
                              <ExternalLink className="mr-2 h-4 w-4" /> Mark Ongoing
                            </DropdownMenuItem>
                          )}
                          {(e.status === 'PUBLISHED' || e.status === 'ONGOING') && (
                            <DropdownMenuItem
                              onSelect={() => statusMutation.mutate({ id: e.id, status: 'COMPLETED' })}
                            >
                              <ExternalLink className="mr-2 h-4 w-4" /> Mark Completed
                            </DropdownMenuItem>
                          )}
                          {e.status !== 'CANCELLED' && e.status !== 'COMPLETED' && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setCancelTarget(e)}
                            >
                              <XCircle className="mr-2 h-4 w-4" /> Cancel Event
                            </DropdownMenuItem>
                          )}
                          {e.status === 'PUBLISHED' && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={() => navigate({ name: 'event-detail', eventId: e.id })}>
                                <ExternalLink className="mr-2 h-4 w-4" /> View Public Page
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleteTarget(e)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
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

      {/* Create / Edit dialog */}
      <EventForm editing={editing} open={formOpen} onOpenChange={setFormOpen} />

      {/* Analytics dialog */}
      {analyticsEventId && <EventAnalytics eventId={analyticsEventId} onClose={() => setAnalyticsEventId(null)} />}

      {/* Cancel confirm */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => { if (!o) setCancelTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this event?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.title} will be marked as cancelled and all its active tickets will be invalidated. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Event</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(ev) => {
                ev.preventDefault()
                if (cancelTarget) cancelMutation.mutate(cancelTarget.id)
              }}
            >
              {cancelMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Cancel Event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this event?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.title} and its ticket types will be permanently deleted. Events with existing orders
              cannot be deleted — cancel them instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Event</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(ev) => {
                ev.preventDefault()
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
              }}
            >
              {deleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
