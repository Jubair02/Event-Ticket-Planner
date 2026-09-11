'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, UserRound, Users, XCircle } from 'lucide-react'
import { apiGet, apiPut } from '@/lib/api'
import { formatEventDate } from '@/lib/format'
import { paths } from '@/lib/routes'
import { useAppStore } from '@/lib/store'
import type { AdminUserRow } from '@/lib/types'
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
import { AccountStatusBadge, RoleBadge } from '@/components/dashboard/status-badges'
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
import {
  BulkBar,
  ConfirmDialog,
  mapLimit,
  reportBulk,
  useDebounced,
  useSelection,
  type BulkAction,
} from './shared'

interface UsersResponse {
  users: AdminUserRow[]
  counts: Record<string, number>
  truncated: boolean
}

const ROLE_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'CUSTOMER', label: 'Customers' },
  { value: 'ORGANIZER', label: 'Organizers' },
  { value: 'EVENT_STAFF', label: 'Staff' },
  { value: 'SUPER_ADMIN', label: 'Admins' },
]

const COLUMNS = [
  { label: 'Select', srOnly: true, className: 'w-10' },
  { label: 'User' },
  { label: 'Role' },
  { label: 'Account' },
  { label: 'Joined' },
  { label: 'Actions', srOnly: true, className: 'text-right' },
]

export function AdminUsers({
  initialRole,
  initialSearch,
}: {
  initialRole: string
  initialSearch: string
}) {
  // Seeded from the URL by the page; only the debounced search reaches the
  // address bar, so a refresh restores the search that was actually run.
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
      return apiGet<UsersResponse>(`/api/admin/users${qs ? `?${qs}` : ''}`)
    },
  })

  const users = data?.users ?? []
  const counts = data?.counts ?? {}

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
    const r = await mapLimit(rows, 5, (u) =>
      apiPut(`/api/admin/users/${u.id}`, { status: action.key }),
    )
    setRunning(null)
    setConfirming(null)
    selection.clear()
    reportBulk('user', action.key === 'SUSPENDED' ? 'suspended' : 'activated', r)
    invalidate()
  }

  const filters: FilterOption[] = ROLE_FILTERS.map((f) => ({
    ...f,
    count:
      f.value === 'ALL' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[f.value] ?? 0),
  }))

  const allSelected = selectable.length > 0 && selected.length === selectable.length
  const busy = running !== null
  const suspending = suspendTarget?.status === 'ACTIVE'

  return (
    <div className="space-y-6">
      <StatStrip
        {...sectionProps(0, '')}
        loading={isLoading}
        items={[
          { label: 'Customers', value: counts.CUSTOMER ?? 0 },
          { label: 'Organizers', value: counts.ORGANIZER ?? 0 },
          { label: 'Gate staff', value: counts.EVENT_STAFF ?? 0 },
          { label: 'Admins', value: counts.SUPER_ADMIN ?? 0 },
        ]}
      />

      <section aria-labelledby="admin-users-heading" {...sectionProps(1)}>
        <SectionHeading
          id="admin-users-heading"
          title="Users"
          description="Suspending blocks sign-in. Nothing is deleted, and tickets stay valid."
        />

        <ConsoleToolbar>
          <FilterChips
            value={roleFilter}
            onChange={setRoleFilter}
            options={filters}
            visible={5}
            label="Filter by role"
          />
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Name or email"
            label="Search users"
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
        ) : users.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No users here"
            description={
              search || roleFilter !== 'ALL'
                ? 'Nothing matches this filter. Try clearing it.'
                : 'Accounts appear here as people sign up.'
            }
          />
        ) : (
          <>
            <ConsoleTable columns={COLUMNS} caption="User directory, newest first">
              {users.map((u) => {
                const protected_ = !canSuspend(u)
                return (
                  <ConsoleRow key={u.id} tone={u.status !== 'ACTIVE' ? 'danger' : undefined}>
                    <ConsoleCell label="Select" className="md:w-10">
                      {protected_ ? (
                        // The API refuses to suspend an admin or yourself, so the
                        // control is absent rather than present-and-failing.
                        <span className="sr-only">Not selectable</span>
                      ) : (
                        <Checkbox
                          checked={selection.ids.has(u.id)}
                          onCheckedChange={() => selection.toggle(u.id)}
                          aria-label={`Select ${u.name}`}
                          disabled={busy}
                        />
                      )}
                    </ConsoleCell>
                    <ConsoleCell label="User">
                      <RowIdentity
                        icon={<UserRound className="size-4" />}
                        title={u.name}
                        meta={
                          <>
                            {u.email}
                            {u.organizer && (
                              <span className="block truncate">
                                {u.organizer.organizationName}
                              </span>
                            )}
                          </>
                        }
                        tone={u.status === 'ACTIVE' ? 'default' : 'muted'}
                      />
                    </ConsoleCell>
                    <ConsoleCell label="Role">
                      <RoleBadge role={u.role} />
                    </ConsoleCell>
                    <ConsoleCell label="Account">
                      <AccountStatusBadge status={u.status} />
                    </ConsoleCell>
                    <ConsoleCell label="Joined">
                      <span className="text-muted-foreground">{formatEventDate(u.createdAt)}</span>
                    </ConsoleCell>
                    <ConsoleActions>
                      {protected_ ? (
                        <span className="text-xs text-muted-foreground">
                          {u.id === currentUser?.id ? 'This is you' : 'Protected'}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant={u.status === 'ACTIVE' ? 'outline' : 'default'}
                          className="h-8 active:scale-[0.98] motion-reduce:transform-none"
                          disabled={busy || statusMutation.isPending}
                          onClick={() => setSuspendTarget(u)}
                        >
                          {statusMutation.isPending && statusMutation.variables?.id === u.id ? (
                            <Loader2 className="animate-spin" />
                          ) : u.status === 'ACTIVE' ? (
                            <XCircle />
                          ) : (
                            <CheckCircle2 />
                          )}
                          {u.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                        </Button>
                      )}
                    </ConsoleActions>
                  </ConsoleRow>
                )
              })}
            </ConsoleTable>

            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              {selectable.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() =>
                    selection.setMany(
                      selectable.map((u) => u.id),
                      !allSelected,
                    )
                  }
                >
                  {allSelected ? 'Clear selection' : `Select all ${selectable.length}`}
                </Button>
              )}
              {data?.truncated && <TruncatedNote shown={users.length} noun="users" />}
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

      <ActionConfirm
        open={suspendTarget !== null}
        title={suspending ? `Suspend ${suspendTarget?.name}?` : `Activate ${suspendTarget?.name}?`}
        body={
          suspending
            ? 'They will not be able to log in until reactivated. Their orders and tickets are kept.'
            : 'They will be able to log in again immediately.'
        }
        cta={suspending ? 'Suspend' : 'Activate'}
        destructive={suspending}
        pending={statusMutation.isPending}
        onCancel={() => setSuspendTarget(null)}
        onConfirm={() => {
          if (!suspendTarget) return
          statusMutation.mutate({
            id: suspendTarget.id,
            status: suspendTarget.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
          })
        }}
      />
    </div>
  )
}
