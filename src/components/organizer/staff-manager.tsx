'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Info, Loader2, Plus, ShieldOff, Trash2, UserCheck, Users } from 'lucide-react'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import type { EventListItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
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

interface StaffRow {
  id: string
  name: string
  email: string
  phone: string | null
  status: string
  createdAt: string
  staffAssignments: Array<{ id: string; event: { id: string; title: string } }>
}

function StaffEventsCheckboxList({
  events,
  selected,
  onToggle,
}: {
  events: EventListItem[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">You have no events yet — create one first.</p>
  }
  return (
    <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
      {events.map((e) => (
        <label key={e.id} className="flex cursor-pointer items-center gap-2 text-sm" htmlFor={`assign-${e.id}`}>
          <Checkbox
            id={`assign-${e.id}`}
            checked={selected.includes(e.id)}
            onCheckedChange={() => onToggle(e.id)}
          />
          <span className="truncate">{e.title}</span>
        </label>
      ))}
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
      toast.success('Staff member created')
      setCreateOpen(false)
      setName('')
      setEmail('')
      setPhone('')
      setPassword('')
      setSelectedEvents([])
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleMutation = useMutation({
    mutationFn: (s: StaffRow) =>
      apiPut(`/api/organizer/staff/${s.id}`, { status: s.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }),
    onSuccess: (_d, s) => {
      toast.success(s.status === 'ACTIVE' ? `${s.name} suspended` : `${s.name} activated`)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const assignMutation = useMutation({
    mutationFn: ({ id, eventIds }: { id: string; eventIds: string[] }) =>
      apiPut(`/api/organizer/staff/${id}`, { eventIds }),
    onSuccess: () => {
      toast.success('Assigned events updated')
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

  // Initialize dialog selection at open time (event-driven — no setState-in-effect)

  const creating = createMutation.isPending

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Staff log in with their email + password and can only scan tickets for assigned events.
        </AlertDescription>
      </Alert>

      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Your Staff ({staff.length})</h2>
        <Button
          onClick={() => {
            setName('')
            setEmail('')
            setPhone('')
            setPassword('')
            setSelectedEvents([])
            setCreateOpen(true)
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> Create Staff
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : staff.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No staff yet"
          description="Create staff accounts so your team can scan tickets at the gate."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Create Staff
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Assigned Events</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-sm">{s.email}</TableCell>
                  <TableCell className="text-sm">{s.phone || '—'}</TableCell>
                  <TableCell>
                    <div className="flex max-w-[260px] flex-wrap gap-1">
                      {s.staffAssignments.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No events</span>
                      ) : (
                        s.staffAssignments.map((a) => (
                          <Badge key={a.id} variant="outline" className="max-w-[240px] truncate">
                            {a.event.title}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {s.status === 'ACTIVE' ? (
                      <Badge variant="default">Active</Badge>
                    ) : (
                      <Badge variant="destructive">Suspended</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          setManageSelected(s.staffAssignments.map((a) => a.event.id))
                          setManageTarget(s)
                        }}
                        aria-label={`Manage events for ${s.name}`}
                      >
                        <UserCheck className="mr-1.5 h-3.5 w-3.5" /> Events
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={s.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                        aria-label={s.status === 'ACTIVE' ? `Suspend ${s.name}` : `Activate ${s.name}`}
                        disabled={toggleMutation.isPending}
                        onClick={() => toggleMutation.mutate(s)}
                      >
                        {toggleMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldOff className={`h-4 w-4 ${s.status === 'ACTIVE' ? 'text-amber-600' : 'text-primary'}`} />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        aria-label={`Delete ${s.name}`}
                        onClick={() => setDeleteTarget(s)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create staff dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Staff Account</DialogTitle>
            <DialogDescription>
              The staff member logs in with this email and password to scan tickets.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="st-name">Name *</Label>
              <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="st-email">Email *</Label>
              <Input
                id="st-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="st-phone">Phone</Label>
              <Input
                id="st-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+8801XXXXXXXXX"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="st-pass">Password *</Label>
              <Input
                id="st-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
              />
            </div>
            <div className="grid gap-2">
              <Label>Assign Events</Label>
              <StaffEventsCheckboxList
                events={events}
                selected={selectedEvents}
                onToggle={(id) =>
                  setSelectedEvents((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]))
                }
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
                  toast.error('Name, email and a 6+ character password are required')
                  return
                }
                createMutation.mutate()
              }}
            >
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Staff
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage events dialog */}
      <Dialog open={!!manageTarget} onOpenChange={(o) => { if (!o) setManageTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Events — {manageTarget?.name}</DialogTitle>
            <DialogDescription>Tick the events this staff member can scan tickets for.</DialogDescription>
          </DialogHeader>
          <StaffEventsCheckboxList
            events={events}
            selected={manageSelected}
            onToggle={(id) =>
              setManageSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]))
            }
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
              {assignMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Assignments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove staff member?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} will lose access immediately and their event assignments will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Staff</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(ev) => {
                ev.preventDefault()
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
              }}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
