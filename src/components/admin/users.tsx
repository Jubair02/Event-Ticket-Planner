'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, MoreHorizontal, Users, XCircle } from 'lucide-react'
import { apiGet, apiPut } from '@/lib/api'
import { formatEventDate } from '@/lib/format'
import { paths } from '@/lib/routes'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { AdminUserRow } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
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
import { SearchBox, SectionHeading, entrance, panelClass } from '@/components/dashboard/primitives'
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

// ============================= Users =============================

export function AdminUsers({
  initialRole,
  initialSearch,
}: {
  initialRole: string
  initialSearch: string
}) {
  // Seeded from the URL by the page; see AdminEvents for why only the debounced
  // search reaches the address bar.
  const [roleFilter, setRoleFilter] = useState(initialRole)
  const [search, setSearch] = useState(initialSearch)

  const qc = useQueryClient()
  const currentUser = useAppStore((s) => s.user)
  const selection = useSelection()
  const [running, setRunning] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<BulkAction | null>(null)
  const [suspendTarget, setSuspendTarget] = useState<AdminUserRow | null>(null)
  const q = useDebounced(search)
  useUrlQuery(paths.adminUsers({ role: roleFilter, q: q.trim() }))

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
          onChange={setSearch}
          placeholder="Search name or email…"
          label="Search users"
        />
      </SectionHeading>

      <Select value={roleFilter} onValueChange={setRoleFilter}>
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
        <div className={cn(panelClass, 'overflow-x-auto')}>
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
