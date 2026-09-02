'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Banknote,
  CheckCircle2,
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
import type { AdminOrganizerRow, AdminStats, AdminUserRow, EventListItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
  highlight,
  action,
}: {
  icon: LucideIcon
  label: string
  value: string | number
  loading: boolean
  highlight?: boolean
  action?: React.ReactNode
}) {
  return (
    <Card className={highlight ? 'border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20' : undefined}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {loading ? (
              <Skeleton className="h-7 w-14" />
            ) : (
              <p className="truncate text-xl font-bold tracking-tight sm:text-2xl">{value}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            {action}
          </div>
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              highlight ? 'bg-amber-400/20 text-amber-700 dark:text-amber-400' : 'bg-primary/10 text-primary'
            }`}
          >
            <Icon className="h-4.5 w-4.5" />
          </span>
        </div>
      </CardContent>
    </Card>
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
      className={`h-7 rounded-full px-3 text-xs ${active ? '' : 'text-muted-foreground'}`}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

// ============================= Overview =============================

function AdminOverview() {
  const navigate = useAppStore((s) => s.navigate)
  const { data, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => apiGet<{ stats: AdminStats }>('/api/admin/stats'),
  })
  const s = data?.stats

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      <StatCard icon={Users} label="Total Users" value={s?.totalUsers ?? 0} loading={isLoading} />
      <StatCard icon={Users} label="Customers" value={s?.totalCustomers ?? 0} loading={isLoading} />
      <StatCard icon={ShieldCheck} label="Organizers" value={s?.totalOrganizers ?? 0} loading={isLoading} />
      <StatCard icon={Ticket} label="Staff" value={s?.totalStaff ?? 0} loading={isLoading} />
      <StatCard icon={Ticket} label="Total Events" value={s?.totalEvents ?? 0} loading={isLoading} />
      <StatCard icon={CheckCircle2} label="Published Events" value={s?.publishedEvents ?? 0} loading={isLoading} />
      <StatCard
        icon={Eye}
        label="Pending Events"
        value={s?.pendingEvents ?? 0}
        loading={isLoading}
        highlight={(s?.pendingEvents ?? 0) > 0}
        action={
          (s?.pendingEvents ?? 0) > 0 ? (
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0 text-amber-700 underline dark:text-amber-400"
              onClick={() => navigate({ name: 'admin', tab: 'events' })}
            >
              Review now →
            </Button>
          ) : undefined
        }
      />
      <StatCard icon={Ticket} label="Total Orders" value={s?.totalOrders ?? 0} loading={isLoading} />
      <StatCard icon={Banknote} label="Paid Orders" value={s?.paidOrders ?? 0} loading={isLoading} />
      <StatCard icon={Banknote} label="Total Revenue" value={s ? formatBDT(s.totalRevenue) : '৳0'} loading={isLoading} />
      <StatCard icon={Ticket} label="Tickets Sold" value={s?.totalTicketsSold ?? 0} loading={isLoading} />
      <StatCard icon={CheckCircle2} label="Check-ins" value={s?.totalCheckIns ?? 0} loading={isLoading} />
    </div>
  )
}

// ============================= Organizers =============================

function AdminOrganizers() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('ALL')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-organizers', statusFilter],
    queryFn: () =>
      apiGet<{ organizers: AdminOrganizerRow[] }>(
        `/api/admin/organizers${statusFilter === 'ALL' ? '' : `?status=${statusFilter}`}`
      ),
  })

  const organizers = data?.organizers ?? []

  const reviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      apiPut(`/api/admin/organizers/${id}`, { status }),
    onSuccess: (_d, vars) => {
      toast.success(vars.status === 'APPROVED' ? 'Organizer approved' : 'Organizer rejected')
      qc.invalidateQueries({ queryKey: ['admin-organizers'] })
      qc.invalidateQueries({ queryKey: ['admin-stats'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const busy = reviewMutation.isPending

  function statusBadge(status: string) {
    if (status === 'APPROVED') return <Badge>Approved</Badge>
    if (status === 'REJECTED') return <Badge variant="destructive">Rejected</Badge>
    return (
      <Badge variant="outline" className="border-amber-400/60 text-amber-600 dark:text-amber-400">
        Pending
      </Badge>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((f) => (
          <FilterChip key={f} active={statusFilter === f} onClick={() => setStatusFilter(f)}>
            {f === 'ALL' ? 'All' : f === 'PENDING' ? 'Pending' : f === 'APPROVED' ? 'Approved' : 'Rejected'}
          </FilterChip>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : organizers.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={statusFilter === 'PENDING' ? 'No pending applications' : 'No organizers found'}
          description="Organizer applications will appear here for approval."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {organizers.map((o) => (
            <Card
              key={o.id}
              className={o.status === 'PENDING' ? 'border-amber-400/60 ring-2 ring-amber-400/40' : undefined}
            >
              <CardContent className="grid gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{o.organizationName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Applied {formatEventDate(o.createdAt)} · {o.eventCount} event{o.eventCount === 1 ? '' : 's'}
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
                      className="flex-1"
                      disabled={busy}
                      onClick={() => reviewMutation.mutate({ id: o.id, status: 'APPROVED' })}
                    >
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      Approve
                    </Button>
                    {o.status === 'PENDING' && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1"
                        disabled={busy}
                        onClick={() => reviewMutation.mutate({ id: o.id, status: 'REJECTED' })}
                      >
                        <XCircle className="mr-2 h-4 w-4" /> Reject
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================= Events =============================

function AdminEvents() {
  const qc = useQueryClient()
  const navigate = useAppStore((s) => s.navigate)
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
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
        approve: 'Event approved & published',
        reject: 'Event rejected',
        suspend: 'Event suspended',
        restore: 'Event restored to published',
        feature: 'Event featured on homepage',
        unfeature: 'Event unfeatured',
      }
      toast.success(messages[vars.action] ?? 'Event updated')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const busy = actionMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { v: 'ALL', label: 'All' },
            { v: 'PENDING_APPROVAL', label: 'Pending' },
            { v: 'PUBLISHED', label: 'Published' },
            { v: 'SUSPENDED', label: 'Suspended' },
            { v: 'REJECTED', label: 'Rejected' },
            { v: 'DRAFT', label: 'Draft' },
            { v: 'ONGOING', label: 'Ongoing' },
            { v: 'COMPLETED', label: 'Completed' },
            { v: 'CANCELLED', label: 'Cancelled' },
          ].map((f) => (
            <FilterChip key={f.v} active={statusFilter === f.v} onClick={() => setStatusFilter(f.v)}>
              {f.label}
            </FilterChip>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events…"
            className="pl-8"
            aria-label="Search events"
          />
        </div>
      </div>

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
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Organizer</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Featured</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow
                  key={e.id}
                  className={
                    e.status === 'PENDING_APPROVAL'
                      ? 'bg-amber-50/70 hover:bg-amber-50 dark:bg-amber-950/20 dark:hover:bg-amber-950/30'
                      : undefined
                  }
                >
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
                    <p className="max-w-[180px] truncate text-sm font-medium">{e.organizer?.organizationName ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{e.organizer?.user?.name ?? ''}</p>
                  </TableCell>
                  <TableCell className="text-sm">{e.city}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{formatEventDate(e.startDate)}</TableCell>
                  <TableCell>
                    <EventStatusBadge status={e.status} />
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={busy}
                      aria-label={e.featured ? `Unfeature ${e.title}` : `Feature ${e.title}`}
                      onClick={() => actionMutation.mutate({ id: e.id, action: e.featured ? 'unfeature' : 'feature' })}
                    >
                      <Star
                        className={`h-4 w-4 ${
                          e.featured ? 'fill-yellow-400 text-yellow-500' : 'text-muted-foreground'
                        }`}
                      />
                    </Button>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${e.title}`}>
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {e.status === 'PENDING_APPROVAL' && (
                          <>
                            <DropdownMenuItem onSelect={() => actionMutation.mutate({ id: e.id, action: 'approve' })}>
                              <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => actionMutation.mutate({ id: e.id, action: 'reject' })}
                            >
                              <XCircle className="mr-2 h-4 w-4" /> Reject
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        {e.status === 'SUSPENDED' && (
                          <DropdownMenuItem onSelect={() => actionMutation.mutate({ id: e.id, action: 'restore' })}>
                            <CheckCircle2 className="mr-2 h-4 w-4" /> Restore
                          </DropdownMenuItem>
                        )}
                        {(e.status === 'PUBLISHED' || e.status === 'ONGOING') && (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => actionMutation.mutate({ id: e.id, action: 'suspend' })}
                          >
                            <XCircle className="mr-2 h-4 w-4" /> Suspend
                          </DropdownMenuItem>
                        )}
                        {(e.status === 'REJECTED' || e.status === 'SUSPENDED') && (
                          <DropdownMenuItem onSelect={() => actionMutation.mutate({ id: e.id, action: 'approve' })}>
                            <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
                          </DropdownMenuItem>
                        )}
                        {e.status === 'PUBLISHED' && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => navigate({ name: 'event-detail', eventId: e.id })}>
                              <Eye className="mr-2 h-4 w-4" /> View Public Page
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// ============================= Users =============================

function AdminUsers() {
  const qc = useQueryClient()
  const [roleFilter, setRoleFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [suspendTarget, setSuspendTarget] = useState<AdminUserRow | null>(null)

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

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) =>
      apiPut(`/api/admin/users/${id}`, { status }),
    onSuccess: (_d, vars) => {
      toast.success(vars.status === 'SUSPENDED' ? 'User suspended' : 'User activated')
      setSuspendTarget(null)
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['admin-stats'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function roleBadge(role: string) {
    switch (role) {
      case 'SUPER_ADMIN':
        return <Badge>Admin</Badge>
      case 'ORGANIZER':
        return <Badge variant="outline" className="border-primary/40 text-primary">Organizer</Badge>
      case 'EVENT_STAFF':
        return <Badge variant="outline">Staff</Badge>
      default:
        return <Badge variant="secondary">Customer</Badge>
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-44" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Roles</SelectItem>
            <SelectItem value="CUSTOMER">Customers</SelectItem>
            <SelectItem value="ORGANIZER">Organizers</SelectItem>
            <SelectItem value="EVENT_STAFF">Event Staff</SelectItem>
            <SelectItem value="SUPER_ADMIN">Super Admins</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="pl-8"
            aria-label="Search users"
          />
        </div>
      </div>

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
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell className="text-sm">{u.phone || '—'}</TableCell>
                  <TableCell>{roleBadge(u.role)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{formatEventDate(u.createdAt)}</TableCell>
                  <TableCell>
                    {u.status === 'ACTIVE' ? (
                      <Badge>Active</Badge>
                    ) : (
                      <Badge variant="destructive">Suspended</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {u.role !== 'SUPER_ADMIN' && (
                      <Button
                        size="sm"
                        variant={u.status === 'ACTIVE' ? 'outline' : 'default'}
                        className="h-8"
                        disabled={statusMutation.isPending}
                        onClick={() => setSuspendTarget(u)}
                      >
                        {u.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Suspend / activate confirm */}
      <AlertDialog open={!!suspendTarget} onOpenChange={(o) => { if (!o) setSuspendTarget(null) }}>
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
              {statusMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {suspendTarget?.status === 'ACTIVE' ? 'Suspend User' : 'Activate User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================= Shell =============================

export function AdminDashboard({ initialTab }: { initialTab?: AdminTab }) {
  const navigate = useAppStore((s) => s.navigate)
  const view = useAppStore((s) => s.view)
  // Tab derived from store view (single source of truth — no sync effect needed)
  const tab: AdminTab = (view.name === 'admin' ? view.tab : initialTab) ?? 'overview'

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">Platform-wide overview, approvals &amp; moderation</p>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(t) => navigate({ name: 'admin', tab: t as AdminTab })}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="organizers">Organizers</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-2">
          <AdminOverview />
        </TabsContent>
        <TabsContent value="organizers" className="mt-2">
          <AdminOrganizers />
        </TabsContent>
        <TabsContent value="events" className="mt-2">
          <AdminEvents />
        </TabsContent>
        <TabsContent value="users" className="mt-2">
          <AdminUsers />
        </TabsContent>
      </Tabs>
    </div>
  )
}
