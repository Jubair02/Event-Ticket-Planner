'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Loader2,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Star,
  Ticket,
  Users,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { apiGet, apiPut } from '@/lib/api'
import { categoryEmoji, formatBDT, formatEventDate } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { AdminOrganizerRow, AdminStats, AdminUserRow, EventListItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { EventStatusBadge } from '@/components/organizer/organizer-dashboard'

type AdminTab = 'overview' | 'organizers' | 'events' | 'users'

/** Small inline hook: debounce a fast-changing value (search inputs). */
function useDebounced(value: string, delay = 300): string {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

/**
 * Run `fn` over every item with a concurrency cap, collecting per-item outcomes.
 * There is no bulk endpoint, so bulk actions fan out over the single-row API;
 * the cap keeps a 200-row selection from opening 200 sockets at once.
 */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<unknown>) {
  const results: PromiseSettledResult<unknown>[] = []
  for (let i = 0; i < items.length; i += limit) {
    results.push(...(await Promise.allSettled(items.slice(i, i + limit).map(fn))))
  }
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  return { total: results.length, done: results.length - failures.length, failures }
}

/** Reports a bulk outcome as one toast rather than one per row. */
function reportBulk(noun: string, verb: string, r: Awaited<ReturnType<typeof mapLimit>>) {
  if (r.failures.length === 0) {
    toast.success(`${r.done} ${noun}${r.done === 1 ? '' : 's'} ${verb}`)
    return
  }
  const reason = r.failures[0].reason
  const detail = reason instanceof Error ? reason.message : 'Some changes were rejected'
  toast.error(`${r.done} of ${r.total} ${noun}s ${verb}`, { description: detail })
}

function useSelection() {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set())
  return {
    ids,
    clear: () => setIds(new Set()),
    toggle: (id: string) =>
      setIds((prev) => {
        const next = new Set(prev)
        if (!next.delete(id)) next.add(id)
        return next
      }),
    setMany: (rowIds: string[], on: boolean) =>
      setIds((prev) => {
        const next = new Set(prev)
        for (const id of rowIds) {
          if (on) next.add(id)
          else next.delete(id)
        }
        return next
      }),
  }
}

// ============================= Shared presentation =============================

function SectionHeading({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

/** Quiet metric list. Deliberately not a card grid: these are reference numbers. */
function MetricGroup({
  title,
  items,
  loading,
}: {
  title: string
  items: { label: string; value: string | number }[]
  loading: boolean
}) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">{title}</h3>
      <dl className="mt-3 divide-y">
        {items.map((it) => (
          <div key={it.label} className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
            <dt className="text-sm text-muted-foreground">{it.label}</dt>
            <dd className="text-sm font-semibold tabular-nums">
              {loading ? <Skeleton className="h-4 w-12" /> : it.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'outline'}
      className={cn('h-7 rounded-full px-3 text-xs', !active && 'text-muted-foreground')}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  label: string
}) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
        aria-label={label}
      />
    </div>
  )
}

type BulkAction = {
  key: string
  label: string
  icon: LucideIcon
  count: number
  destructive?: boolean
  confirm?: { title: string; body: string; cta: string }
}

/**
 * Selection action bar. Each action carries the number of selected rows it can
 * actually apply to, so the admin never fires a request the API will reject.
 */
function BulkBar({
  selectedCount,
  actions,
  running,
  onRun,
  onClear,
}: {
  selectedCount: number
  actions: BulkAction[]
  running: string | null
  onRun: (action: BulkAction) => void
  onClear: () => void
}) {
  if (selectedCount === 0) return null
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2"
    >
      <span className="text-sm font-medium tabular-nums">{selectedCount} selected</span>
      <span className="mr-auto h-4 w-px bg-border" aria-hidden="true" />
      {actions.map((a) => (
        <Button
          key={a.key}
          size="sm"
          variant={a.destructive ? 'destructive' : 'default'}
          className="h-8 active:scale-[0.98]"
          disabled={a.count === 0 || running !== null}
          onClick={() => onRun(a)}
          title={a.count === 0 ? 'No selected rows are eligible for this action' : undefined}
        >
          {running === a.key ? <Loader2 className="animate-spin" /> : <a.icon />}
          {a.label}
          <span className="tabular-nums opacity-70">({a.count})</span>
        </Button>
      ))}
      <Button size="sm" variant="ghost" className="h-8" onClick={onClear} disabled={running !== null}>
        Clear
      </Button>
    </div>
  )
}

function ConfirmDialog({
  action,
  onCancel,
  onConfirm,
  running,
}: {
  action: BulkAction | null
  onCancel: () => void
  onConfirm: () => void
  running: boolean
}) {
  return (
    <AlertDialog open={action !== null} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{action?.confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{action?.confirm?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={action?.destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
            onClick={(ev) => {
              ev.preventDefault()
              onConfirm()
            }}
          >
            {running && <Loader2 className="animate-spin" />}
            {action?.confirm?.cta}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ============================= Overview =============================

function QueueRow({
  count,
  label,
  hint,
  cta,
  onReview,
  loading,
}: {
  count: number
  label: string
  hint: string
  cta: string
  onReview: () => void
  loading: boolean
}) {
  const waiting = count > 0
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <span
        className={cn(
          'w-12 shrink-0 text-2xl font-semibold tabular-nums',
          waiting ? 'text-foreground' : 'text-muted-foreground/50',
        )}
      >
        {loading ? <Skeleton className="h-7 w-9" /> : count}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm font-medium', !waiting && 'text-muted-foreground')}>{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      {waiting && (
        <Button size="sm" className="active:scale-[0.98]" onClick={onReview}>
          {cta}
        </Button>
      )}
    </li>
  )
}

function AdminOverview({ onReview }: { onReview: (tab: 'organizers' | 'events') => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => apiGet<{ stats: AdminStats }>('/api/admin/stats'),
  })
  const s = data?.stats
  const pendingEvents = s?.pendingEvents ?? 0
  const pendingOrganizers = s?.pendingOrganizers ?? 0
  const waiting = pendingEvents + pendingOrganizers
  // Counts default to 0 while loading, so only warn once real data has arrived.
  const hasQueue = !isLoading && waiting > 0

  return (
    <div className="space-y-6">
      {/* The one job this page exists for, given the weight to match. */}
      <section
        aria-labelledby="admin-queue-heading"
        className={cn('rounded-xl border p-5', hasQueue ? 'border-chart-5/50 bg-chart-5/10' : 'bg-card')}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl',
              hasQueue ? 'bg-chart-5/25 text-foreground' : 'bg-primary/10 text-primary',
            )}
          >
            {hasQueue ? <ClipboardCheck className="size-5" /> : <CheckCircle2 className="size-5" />}
          </span>
          <div className="min-w-0">
            <h2 id="admin-queue-heading" className="text-lg font-semibold tracking-tight">
              Needs review
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isLoading
                ? 'Checking for submissions…'
                : hasQueue
                  ? 'Submissions are held from the public site until you decide.'
                  : 'Nothing is waiting on you right now.'}
            </p>
          </div>
        </div>

        {(isLoading || hasQueue) && (
          <ul className="mt-4 divide-y border-t pt-4">
            <QueueRow
              count={pendingEvents}
              label="Events awaiting approval"
              hint="Not visible to customers until approved"
              cta="Review events"
              onReview={() => onReview('events')}
              loading={isLoading}
            />
            <QueueRow
              count={pendingOrganizers}
              label="Organizer applications"
              hint="Cannot publish events until approved"
              cta="Review applications"
              onReview={() => onReview('organizers')}
              loading={isLoading}
            />
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Revenue is the one number worth reading at a glance, so it gets the size. */}
        <section aria-labelledby="admin-revenue-heading" className="rounded-xl border bg-card p-5">
          <h3
            id="admin-revenue-heading"
            className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase"
          >
            Revenue
          </h3>
          {isLoading ? (
            <Skeleton className="mt-3 h-9 w-40" />
          ) : (
            <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
              {formatBDT(s?.totalRevenue ?? 0)}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {s?.paidOrders ?? 0} paid of {s?.totalOrders ?? 0} orders
          </p>
          <dl className="mt-4 divide-y border-t">
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-sm text-muted-foreground">Tickets sold</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {isLoading ? <Skeleton className="h-4 w-12" /> : (s?.totalTicketsSold ?? 0)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2 last:pb-0">
              <dt className="text-sm text-muted-foreground">Check-ins</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {isLoading ? <Skeleton className="h-4 w-12" /> : (s?.totalCheckIns ?? 0)}
              </dd>
            </div>
          </dl>
        </section>

        <MetricGroup
          title="People"
          loading={isLoading}
          items={[
            { label: 'All accounts', value: s?.totalUsers ?? 0 },
            { label: 'Customers', value: s?.totalCustomers ?? 0 },
            { label: 'Organizers', value: s?.totalOrganizers ?? 0 },
            { label: 'Event staff', value: s?.totalStaff ?? 0 },
          ]}
        />

        <MetricGroup
          title="Events"
          loading={isLoading}
          items={[
            { label: 'All events', value: s?.totalEvents ?? 0 },
            { label: 'Published', value: s?.publishedEvents ?? 0 },
            { label: 'Awaiting approval', value: pendingEvents },
          ]}
        />
      </div>
    </div>
  )
}

// ============================= Organizers =============================

const ORGANIZER_FILTERS = [
  { v: 'ALL', label: 'All' },
  { v: 'PENDING', label: 'Pending' },
  { v: 'APPROVED', label: 'Approved' },
  { v: 'REJECTED', label: 'Rejected' },
]

function AdminOrganizers({
  statusFilter,
  onStatusFilter,
}: {
  statusFilter: string
  onStatusFilter: (v: string) => void
}) {
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
          <FilterChip key={f.v} active={statusFilter === f.v} onClick={() => onStatusFilter(f.v)}>
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
                  'rounded-xl border bg-card p-4 transition-colors',
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

function AdminEvents({
  statusFilter,
  onStatusFilter,
  search,
  onSearch,
}: {
  statusFilter: string
  onStatusFilter: (v: string) => void
  search: string
  onSearch: (v: string) => void
}) {
  const qc = useQueryClient()
  const navigate = useAppStore((s) => s.navigate)
  const selection = useSelection()
  const [running, setRunning] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<BulkAction | null>(null)
  const q = useDebounced(search)

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
        <SearchBox value={search} onChange={onSearch} placeholder="Search events…" label="Search events" />
      </SectionHeading>

      <div className="flex flex-wrap items-center gap-1.5">
        {EVENT_FILTERS.map((f) => (
          <FilterChip key={f.v} active={statusFilter === f.v} onClick={() => onStatusFilter(f.v)}>
            {f.label}
          </FilterChip>
        ))}
      </div>

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
        <div className="overflow-x-auto rounded-lg border">
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
                              <DropdownMenuItem
                                onSelect={() => navigate({ name: 'event-detail', eventId: e.id })}
                              >
                                <Eye /> View public page
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

// ============================= Users =============================

function AdminUsers({
  roleFilter,
  onRoleFilter,
  search,
  onSearch,
}: {
  roleFilter: string
  onRoleFilter: (v: string) => void
  search: string
  onSearch: (v: string) => void
}) {
  const qc = useQueryClient()
  const currentUser = useAppStore((s) => s.user)
  const selection = useSelection()
  const [running, setRunning] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<BulkAction | null>(null)
  const [suspendTarget, setSuspendTarget] = useState<AdminUserRow | null>(null)
  const q = useDebounced(search)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', roleFilter, q],
    queryFn: () => {
      const params = new URLSearchParams()
      if (roleFilter !== 'ALL') params.set('role', roleFilter)
      if (q.trim()) params.set('q', q.trim())
      const qs = params.toString()
      return apiGet<{ users: AdminUserRow[] }>(`/api/admin/users${qs ? `?${qs}` : ''}`)
    },
  })

  const users = data?.users ?? []

  /** The API refuses both, so never offer them. */
  function canSuspend(u: AdminUserRow) {
    return u.role !== 'SUPER_ADMIN' && u.id !== currentUser?.id
  }

  const selectable = users.filter(canSuspend)
  const selected = users.filter((u) => selection.ids.has(u.id))

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['admin-users'] })
    qc.invalidateQueries({ queryKey: ['admin-stats'] })
  }

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) =>
      apiPut(`/api/admin/users/${id}`, { status }),
    onSuccess: (_d, vars) => {
      toast.success(vars.status === 'SUSPENDED' ? 'User suspended' : 'User activated')
      setSuspendTarget(null)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const suspendable = selected.filter((u) => canSuspend(u) && u.status === 'ACTIVE')
  const activatable = selected.filter((u) => u.status !== 'ACTIVE')

  const bulkActions: BulkAction[] = [
    { key: 'ACTIVE', label: 'Activate', icon: CheckCircle2, count: activatable.length },
    {
      key: 'SUSPENDED',
      label: 'Suspend',
      icon: XCircle,
      count: suspendable.length,
      destructive: true,
      confirm: {
        title: `Suspend ${suspendable.length} user${suspendable.length === 1 ? '' : 's'}?`,
        body: 'They will not be able to log in until reactivated. Their orders and tickets are kept.',
        cta: 'Suspend users',
      },
    },
  ]

  async function runBulk(action: BulkAction) {
    const rows = action.key === 'SUSPENDED' ? suspendable : activatable
    if (rows.length === 0) return
    setRunning(action.key)
    const r = await mapLimit(rows, 5, (u) => apiPut(`/api/admin/users/${u.id}`, { status: action.key }))
    setRunning(null)
    setConfirming(null)
    selection.clear()
    reportBulk('user', action.key === 'SUSPENDED' ? 'suspended' : 'activated', r)
    invalidate()
  }

  function roleBadge(role: string) {
    switch (role) {
      case 'SUPER_ADMIN':
        return <Badge>Admin</Badge>
      case 'ORGANIZER':
        return (
          <Badge variant="outline" className="border-primary/40 text-primary">
            Organizer
          </Badge>
        )
      case 'EVENT_STAFF':
        return <Badge variant="outline">Staff</Badge>
      default:
        return <Badge variant="secondary">Customer</Badge>
    }
  }

  const allSelected = selectable.length > 0 && selected.length === selectable.length
  const busy = running !== null

  return (
    <section aria-labelledby="admin-users-heading" className="space-y-4">
      <SectionHeading
        id="admin-users-heading"
        title="Users"
        description={
          isLoading
            ? 'Loading accounts…'
            : `${users.length} account${users.length === 1 ? '' : 's'} — suspend or restore access.`
        }
      >
        <SearchBox
          value={search}
          onChange={onSearch}
          placeholder="Search name or email…"
          label="Search users"
        />
      </SectionHeading>

      <Select value={roleFilter} onValueChange={onRoleFilter}>
        <SelectTrigger className="w-44" aria-label="Filter by role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All roles</SelectItem>
          <SelectItem value="CUSTOMER">Customers</SelectItem>
          <SelectItem value="ORGANIZER">Organizers</SelectItem>
          <SelectItem value="EVENT_STAFF">Event staff</SelectItem>
          <SelectItem value="SUPER_ADMIN">Super admins</SelectItem>
        </SelectContent>
      </Select>

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
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <EmptyState icon={Users} title="No users found" description="Try a different role filter or search term." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[800px]">
            <caption className="sr-only">
              All platform accounts with role, join date, status and access actions
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    onCheckedChange={(c) => selection.setMany(selectable.map((u) => u.id), c === true)}
                    aria-label="Select all suspendable users"
                  />
                </TableHead>
                <TableHead>User</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const isSelected = selection.ids.has(u.id)
                const rowBusy =
                  busy || (statusMutation.isPending && statusMutation.variables?.id === u.id)
                return (
                  <TableRow key={u.id} data-state={isSelected ? 'selected' : undefined}>
                    <TableCell>
                      {canSuspend(u) ? (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => selection.toggle(u.id)}
                          aria-label={`Select ${u.name}`}
                        />
                      ) : (
                        <span className="sr-only">Not selectable</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">
                        {u.name}
                        {u.id === currentUser?.id && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{u.phone || '—'}</TableCell>
                    <TableCell>{roleBadge(u.role)}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{formatEventDate(u.createdAt)}</TableCell>
                    <TableCell>
                      {u.status === 'ACTIVE' ? <Badge>Active</Badge> : <Badge variant="destructive">Suspended</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      {canSuspend(u) && (
                        <Button
                          size="sm"
                          variant={u.status === 'ACTIVE' ? 'outline' : 'default'}
                          className="h-8 active:scale-[0.98]"
                          disabled={rowBusy}
                          onClick={() => setSuspendTarget(u)}
                        >
                          {u.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                        </Button>
                      )}
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

      {/* Single-row suspend / activate confirm */}
      <AlertDialog open={!!suspendTarget} onOpenChange={(o) => !o && setSuspendTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {suspendTarget?.status === 'ACTIVE' ? 'Suspend this user?' : 'Activate this user?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {suspendTarget?.name} ({suspendTarget?.email}) —{' '}
              {suspendTarget?.status === 'ACTIVE'
                ? 'they will no longer be able to log in.'
                : 'they will be able to log in again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                suspendTarget?.status === 'ACTIVE' ? 'bg-destructive text-white hover:bg-destructive/90' : undefined
              }
              onClick={(ev) => {
                ev.preventDefault()
                if (suspendTarget) {
                  statusMutation.mutate({
                    id: suspendTarget.id,
                    status: suspendTarget.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                  })
                }
              }}
            >
              {statusMutation.isPending && <Loader2 className="animate-spin" />}
              {suspendTarget?.status === 'ACTIVE' ? 'Suspend user' : 'Activate user'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ============================= Shell =============================

export function AdminDashboard({ initialTab }: { initialTab?: AdminTab }) {
  const navigate = useAppStore((s) => s.navigate)
  const view = useAppStore((s) => s.view)
  // Tab derived from store view (single source of truth — no sync effect needed)
  const tab: AdminTab = (view.name === 'admin' ? view.tab : initialTab) ?? 'overview'

  // Filters live here, not in the panels: Radix unmounts the inactive tab, so
  // panel-local filters were lost on every tab switch — and the overview's
  // "review" buttons need to preselect them.
  const [organizerStatus, setOrganizerStatus] = useState('ALL')
  const [eventStatus, setEventStatus] = useState('ALL')
  const [eventSearch, setEventSearch] = useState('')
  const [userRole, setUserRole] = useState('ALL')
  const [userSearch, setUserSearch] = useState('')

  function reviewQueue(target: 'organizers' | 'events') {
    if (target === 'events') {
      setEventStatus('PENDING_APPROVAL')
      setEventSearch('')
    } else {
      setOrganizerStatus('PENDING')
    }
    navigate({ name: 'admin', tab: target })
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin dashboard</h1>
          <p className="text-sm text-muted-foreground">Approvals, moderation and platform health</p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(t) => navigate({ name: 'admin', tab: t as AdminTab })}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="organizers">Organizers</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-2">
          <AdminOverview onReview={reviewQueue} />
        </TabsContent>
        <TabsContent value="organizers" className="mt-2">
          <AdminOrganizers statusFilter={organizerStatus} onStatusFilter={setOrganizerStatus} />
        </TabsContent>
        <TabsContent value="events" className="mt-2">
          <AdminEvents
            statusFilter={eventStatus}
            onStatusFilter={setEventStatus}
            search={eventSearch}
            onSearch={setEventSearch}
          />
        </TabsContent>
        <TabsContent value="users" className="mt-2">
          <AdminUsers
            roleFilter={userRole}
            onRoleFilter={setUserRole}
            search={userSearch}
            onSearch={setUserSearch}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
