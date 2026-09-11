'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { EventListItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Panel, SectionHeading, entrance } from '@/components/dashboard/primitives'

interface StaffRow {
  id: string
  name: string
  email: string
  phone: string | null
  status: string
  createdAt: string
  staffAssignments: Array<{ id: string; event: { id: string; title: string } }>
}

/** How many assigned-event chips to show inline before collapsing to "+N more". */
const VISIBLE_ASSIGNMENTS = 2

/** Above this many events, the assignment list gets a filter box. */
const SEARCHABLE_FROM = 7

/** Two letters from the name, for the row's avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * A people list needs a visual anchor per row, or every row looks identical
 * while you scan for one person. Initials rather than a photo: there is no
 * avatar field on a staff account, and a generic placeholder icon on each row
 * would be an anchor that distinguishes nothing.
 */
function StaffAvatar({ name, suspended }: { name: string; suspended: boolean }) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        suspended ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

/**
 * "Assigned to nothing" is a dead end, not a neutral state: the account can
 * sign in and then find no event to scan. It used to read as muted grey filler,
 * which is how a real misconfiguration stayed invisible.
 */
function NoAssignments() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-chart-5/60 bg-chart-5/10 px-2 py-0.5 text-xs font-medium text-foreground">
      <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
      Not assigned
    </span>
  )
}

function StaffEventsCheckboxList({
  events,
  selected,
  onToggle,
  onSetAll,
}: {
  events: EventListItem[]
  selected: string[]
  onToggle: (id: string) => void
  onSetAll: (ids: string[]) => void
}) {
  const [q, setQ] = useState('')

  const searchable = events.length >= SEARCHABLE_FROM
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return events
    return events.filter((e) => e.title.toLowerCase().includes(needle))
  }, [events, q])

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">You have no events yet — create one first.</p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground tabular-nums">
          {selected.length} of {events.length} selected
        </p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 cursor-pointer px-2 text-xs"
            disabled={selected.length === events.length}
            onClick={() => onSetAll(events.map((e) => e.id))}
          >
            Select all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 cursor-pointer px-2 text-xs"
            disabled={selected.length === 0}
            onClick={() => onSetAll([])}
          >
            Clear
          </Button>
        </div>
      </div>

      {searchable && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter events"
            aria-label="Filter events by name"
            className="h-9 pl-8"
          />
        </div>
      )}

      <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border p-3">
        {shown.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">No events match.</p>
        ) : (
          shown.map((e) => (
            <label
              key={e.id}
              className="flex cursor-pointer items-center gap-2 text-sm"
              htmlFor={`assign-${e.id}`}
            >
              <Checkbox
                id={`assign-${e.id}`}
                checked={selected.includes(e.id)}
                onCheckedChange={() => onToggle(e.id)}
              />
              <span className="truncate">{e.title}</span>
            </label>
          ))
        )}
      </div>
    </div>
  )
}

export function StaffManager() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [manageTarget, setManageTarget] = useState<StaffRow | null>(null)
  const [manageSelected, setManageSelected] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null)

  const { data: staffData, isLoading } = useQuery({
    queryKey: ['organizer-staff'],
    queryFn: () => apiGet<{ staff: StaffRow[] }>('/api/organizer/staff'),
  })
  const { data: eventsData } = useQuery({
    queryKey: ['organizer-events'],
    queryFn: () => apiGet<{ events: EventListItem[] }>('/api/organizer/events'),
  })

  const staff = staffData?.staff ?? []
  const events = eventsData?.events ?? []

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['organizer-staff'] })
  }

  function resetCreateForm() {
    setName('')
    setEmail('')
    setPhone('')
    setPassword('')
    setSelectedEvents([])
  }

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost('/api/organizer/staff', {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        password,
        eventIds: selectedEvents,
      }),
    onSuccess: () => {
      toast.success('Staff account created')
      setCreateOpen(false)
      resetCreateForm()
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleMutation = useMutation({
    mutationFn: (s: StaffRow) =>
      apiPut(`/api/organizer/staff/${s.id}`, { status: s.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }),
    onSuccess: (_d, s) => {
      toast.success(s.status === 'ACTIVE' ? `${s.name} suspended` : `${s.name} reactivated`)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const assignMutation = useMutation({
    mutationFn: ({ id, eventIds }: { id: string; eventIds: string[] }) =>
      apiPut(`/api/organizer/staff/${id}`, { eventIds }),
    onSuccess: () => {
      toast.success('Assignments updated')
      setManageTarget(null)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/organizer/staff/${id}`),
    onSuccess: () => {
      toast.success('Staff member removed')
      setDeleteTarget(null)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const creating = createMutation.isPending

  /**
   * The description doubles as the summary line, because an account that is
   * suspended or unassigned cannot scan and the organizer has no other way to
   * notice from here.
   */
  const unassigned = staff.filter((s) => s.staffAssignments.length === 0).length
  const suspended = staff.filter((s) => s.status !== 'ACTIVE').length
  const summary = [
    `${staff.length} account${staff.length === 1 ? '' : 's'}`,
    suspended > 0 ? `${suspended} suspended` : null,
    unassigned > 0 ? `${unassigned} not assigned to any event` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  /** Suspend / reactivate / remove, shared by the table and the card list. */
  function renderStaffActions(s: StaffRow) {
    const rowBusy = toggleMutation.isPending && toggleMutation.variables?.id === s.id
    const active = s.status === 'ACTIVE'
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8 cursor-pointer"
          onClick={() => {
            setManageSelected(s.staffAssignments.map((a) => a.event.id))
            setManageTarget(s)
          }}
          aria-label={`Assign events for ${s.name}`}
        >
          <UserCheck /> Events
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 cursor-pointer"
          title={active ? 'Suspend' : 'Reactivate'}
          aria-label={active ? `Suspend ${s.name}` : `Reactivate ${s.name}`}
          disabled={rowBusy}
          onClick={() => toggleMutation.mutate(s)}
        >
          {rowBusy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : active ? (
            // Was `text-chart-5`, which measures 1.81:1 against the card and
            // fails even the 3:1 floor for a meaningful icon. The shape plus
            // the label carry the meaning; the colour was only decoration.
            <ShieldOff className="size-4" />
          ) : (
            <ShieldCheck className="size-4 text-primary" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 cursor-pointer text-destructive hover:text-destructive"
          aria-label={`Remove ${s.name}`}
          onClick={() => setDeleteTarget(s)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <section aria-labelledby="organizer-staff-heading" className="space-y-4">
      <div {...entrance(0)}>
        <SectionHeading
          id="organizer-staff-heading"
          title="Gate staff"
          description={
            isLoading
              ? 'Loading staff…'
              : staff.length === 0
                ? 'Staff sign in with their email and can only scan tickets for the events you assign.'
                : `${summary} — staff can only scan the events you assign.`
          }
        >
          <Button
            className="active:scale-[0.98] motion-reduce:transform-none"
            onClick={() => {
              resetCreateForm()
              setCreateOpen(true)
            }}
          >
            <Plus /> Create staff
          </Button>
        </SectionHeading>
      </div>

      <div {...entrance(1)}>
        {isLoading ? (
          <Panel padded={false} className="divide-y divide-border/70">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 p-4">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </Panel>
        ) : staff.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No staff yet"
            description="Create staff accounts so your team can scan tickets at the gate. Each account only sees the events you assign."
            action={
              <Button
                onClick={() => {
                  resetCreateForm()
                  setCreateOpen(true)
                }}
              >
                <Plus /> Create staff
              </Button>
            }
          />
        ) : (
          <>
            {/* ── small screens ──
                The table needed 760px and scrolled sideways to get it. */}
            <Panel padded={false} className="overflow-hidden lg:hidden">
              <h3 className="sr-only">Your gate staff</h3>
              <ul className="divide-y divide-border/70">
                {staff.map((s) => {
                  const extra = s.staffAssignments.length - VISIBLE_ASSIGNMENTS
                  return (
                    <li key={s.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <StaffAvatar name={s.name} suspended={s.status !== 'ACTIVE'} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="truncate text-sm font-medium">{s.name}</p>
                            {s.status === 'ACTIVE' ? (
                              <Badge>Active</Badge>
                            ) : (
                              <Badge variant="destructive">Suspended</Badge>
                            )}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                          {s.phone && (
                            <p className="text-xs text-muted-foreground tabular-nums">{s.phone}</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-1">
                        {s.staffAssignments.length === 0 ? (
                          <NoAssignments />
                        ) : (
                          <>
                            {s.staffAssignments.slice(0, VISIBLE_ASSIGNMENTS).map((a) => (
                              <Badge
                                key={a.id}
                                variant="outline"
                                className="max-w-[160px] truncate font-normal"
                              >
                                {a.event.title}
                              </Badge>
                            ))}
                            {extra > 0 && (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                +{extra} more
                              </span>
                            )}
                          </>
                        )}
                      </div>

                      <div className="mt-3 flex justify-end">{renderStaffActions(s)}</div>
                    </li>
                  )
                })}
              </ul>
            </Panel>

            {/* ── large screens ── */}
            <Panel padded={false} className="hidden overflow-x-auto lg:block">
              <Table>
                <caption className="sr-only">
                  Your gate staff with contact details, assigned events, status and actions
                </caption>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Staff</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Assigned events</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staff.map((s) => {
                    const extra = s.staffAssignments.length - VISIBLE_ASSIGNMENTS
                    return (
                      <TableRow key={s.id} className="transition-colors">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <StaffAvatar name={s.name} suspended={s.status !== 'ACTIVE'} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{s.name}</p>
                              <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">{s.phone || '—'}</TableCell>
                        <TableCell>
                          {s.staffAssignments.length === 0 ? (
                            <NoAssignments />
                          ) : (
                            <div className="flex max-w-[280px] flex-wrap items-center gap-1">
                              {s.staffAssignments.slice(0, VISIBLE_ASSIGNMENTS).map((a) => (
                                <Badge
                                  key={a.id}
                                  variant="outline"
                                  className="max-w-[160px] truncate font-normal"
                                >
                                  {a.event.title}
                                </Badge>
                              ))}
                              {extra > 0 && (
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  +{extra} more
                                </span>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {s.status === 'ACTIVE' ? (
                            <Badge>Active</Badge>
                          ) : (
                            <Badge variant="destructive">Suspended</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">{renderStaffActions(s)}</div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Panel>
          </>
        )}
      </div>

      {/* Create staff dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create staff account</DialogTitle>
            <DialogDescription>They sign in with this email and password to scan tickets.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="st-name">Name</Label>
              <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="st-email">Email</Label>
              <Input
                id="st-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@example.com"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="st-phone">Phone (optional)</Label>
              <Input
                id="st-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+8801XXXXXXXXX"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="st-pass">Password</Label>
              <Input
                id="st-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
              />
            </div>
            <div className="grid gap-2">
              <Label>Assign events</Label>
              <StaffEventsCheckboxList
                events={events}
                selected={selectedEvents}
                onToggle={(id) =>
                  setSelectedEvents((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]))
                }
                onSetAll={setSelectedEvents}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button
              disabled={creating}
              onClick={() => {
                if (!name.trim() || !email.trim() || password.length < 6) {
                  toast.error('Name, email and a password of at least 6 characters are required')
                  return
                }
                createMutation.mutate()
              }}
            >
              {creating && <Loader2 className="animate-spin" />}
              Create staff
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign events dialog */}
      <Dialog open={!!manageTarget} onOpenChange={(o) => !o && setManageTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign events — {manageTarget?.name}</DialogTitle>
            <DialogDescription>Tick the events this staff member can scan tickets for.</DialogDescription>
          </DialogHeader>
          <StaffEventsCheckboxList
            events={events}
            selected={manageSelected}
            onToggle={(id) =>
              setManageSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]))
            }
            onSetAll={setManageSelected}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageTarget(null)} disabled={assignMutation.isPending}>
              Cancel
            </Button>
            <Button
              disabled={assignMutation.isPending}
              onClick={() => {
                if (!manageTarget) return
                assignMutation.mutate({ id: manageTarget.id, eventIds: manageSelected })
              }}
            >
              {assignMutation.isPending && <Loader2 className="animate-spin" />}
              Save assignments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this staff member?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} will lose access immediately and their event assignments will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep staff</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(ev) => {
                ev.preventDefault()
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
              }}
            >
              {deleteMutation.isPending && <Loader2 className="animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
