'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import { formatMinor, formatEventDate } from '@/lib/format'
import { fromMinor, toMinor } from '@/lib/money'
import type { EventAnalytics } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PaymentStatusBadge, EventStatusBadge } from '@/components/dashboard/status-badges'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return formatEventDate(iso)
}

interface AddTypeForm {
  name: string
  price: string
  totalQuantity: string
  maxPerOrder: string
}

const emptyAdd: AddTypeForm = { name: '', price: '', totalQuantity: '', maxPerOrder: '5' }

interface EditTypeForm {
  id: string
  name: string
  price: string
  totalQuantity: string
  maxPerOrder: string
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-center">
      <p className="truncate text-xl font-bold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

export function EventAnalytics({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [addForm, setAddForm] = useState<AddTypeForm>(emptyAdd)
  const [editForm, setEditForm] = useState<EditTypeForm | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', eventId],
    queryFn: () => apiGet<{ analytics: EventAnalytics }>(`/api/organizer/events/${eventId}/analytics`),
  })

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['analytics', eventId] })
    qc.invalidateQueries({ queryKey: ['organizer-events'] })
    qc.invalidateQueries({ queryKey: ['organizer-stats'] })
  }

  const addMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/organizer/events/${eventId}/ticket-types`, {
        name: addForm.name.trim(),
        priceMinor: toMinor(addForm.price) ?? 0,
        totalQuantity: Number(addForm.totalQuantity),
        maxPerOrder: Number(addForm.maxPerOrder || '5'),
      }),
    onSuccess: () => {
      toast.success('Ticket type added')
      setAddForm(emptyAdd)
      invalidateAll()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: (f: EditTypeForm) =>
      apiPut(`/api/organizer/ticket-types/${f.id}`, {
        name: f.name.trim(),
        priceMinor: toMinor(f.price) ?? 0,
        totalQuantity: Number(f.totalQuantity),
        maxPerOrder: Number(f.maxPerOrder || '5'),
      }),
    onSuccess: () => {
      toast.success('Ticket type updated')
      setEditForm(null)
      invalidateAll()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/organizer/ticket-types/${id}`),
    onSuccess: () => {
      toast.success('Ticket type deleted')
      invalidateAll()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const a = data?.analytics

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6 text-base sm:text-lg">{a ? a.event.title : 'Event Analytics'}</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            {a && <EventStatusBadge status={a.event.status} />}
            <span>Performance, ticket types &amp; recent orders</span>
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-40 rounded-lg" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {error instanceof Error ? error.message : 'Failed to load analytics'}
          </div>
        )}

        {a && (
          <div className="grid gap-6">
            {/* Stat tiles */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Total Tickets" value={a.totalTickets} />
              <Tile label="Sold" value={a.sold} />
              <Tile label="Available" value={a.available} />
              <Tile label="Revenue" value={formatMinor(a.revenueMinor)} />
            </div>

            {/* Check-in progress */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-primary" /> Check-in Status
                </span>
                <span className="text-muted-foreground">
                  {a.checkIns} arrived · {a.notArrived} not arrived
                </span>
              </div>
              <Progress
                value={a.checkIns + a.notArrived > 0 ? Math.round((a.checkIns / (a.checkIns + a.notArrived)) * 100) : 0}
              />
              <p className="text-xs text-muted-foreground">
                {a.checkIns + a.notArrived > 0
                  ? `${Math.round((a.checkIns / (a.checkIns + a.notArrived)) * 100)}% of sold tickets have checked in`
                  : 'No sold tickets yet'}
              </p>
            </div>

            {/* Ticket type breakdown + management */}
            <div className="grid gap-3">
              <h3 className="text-sm font-semibold">Ticket Types</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 font-medium">Sold</th>
                      <th className="px-3 py-2 font-medium">Fill</th>
                      <th className="px-3 py-2 font-medium">Revenue</th>
                      <th className="px-3 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.ticketTypeBreakdown.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                          No ticket types yet — add one below.
                        </td>
                      </tr>
                    )}
                    {a.ticketTypeBreakdown.map((t) =>
                      editForm && editForm.id === t.id ? (
                        <tr key={t.id} className="border-t align-middle">
                          <td className="px-3 py-2" colSpan={6}>
                            <div className="grid gap-2 sm:grid-cols-5 sm:items-end">
                              <div className="grid gap-1">
                                <Label className="text-xs" htmlFor="et-name">Name</Label>
                                <Input
                                  id="et-name"
                                  className="h-8"
                                  value={editForm.name}
                                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                />
                              </div>
                              <div className="grid gap-1">
                                <Label className="text-xs" htmlFor="et-price">Price (৳)</Label>
                                <Input
                                  id="et-price"
                                  type="number"
                                  min="0"
                                  className="h-8"
                                  value={editForm.price}
                                  onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                                />
                              </div>
                              <div className="grid gap-1">
                                <Label className="text-xs" htmlFor="et-qty">Quantity</Label>
                                <Input
                                  id="et-qty"
                                  type="number"
                                  min={t.soldQuantity}
                                  className="h-8"
                                  value={editForm.totalQuantity}
                                  onChange={(e) => setEditForm({ ...editForm, totalQuantity: e.target.value })}
                                />
                              </div>
                              <div className="grid gap-1">
                                <Label className="text-xs" htmlFor="et-max">Max / order</Label>
                                <Input
                                  id="et-max"
                                  type="number"
                                  min="1"
                                  className="h-8"
                                  value={editForm.maxPerOrder}
                                  onChange={(e) => setEditForm({ ...editForm, maxPerOrder: e.target.value })}
                                />
                              </div>
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  className="h-8 flex-1"
                                  disabled={updateMutation.isPending}
                                  onClick={() => updateMutation.mutate(editForm)}
                                >
                                  {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => setEditForm(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={t.id} className="border-t">
                          <td className="px-3 py-2 font-medium">{t.name}</td>
                          <td className="px-3 py-2">{formatMinor(t.priceMinor)}</td>
                          <td className="px-3 py-2">
                            {t.soldQuantity}/{t.totalQuantity}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Progress
                                className="h-2 w-16"
                                value={t.totalQuantity > 0 ? Math.round((t.soldQuantity / t.totalQuantity) * 100) : 0}
                              />
                              <span className="text-xs text-muted-foreground">
                                {t.totalQuantity > 0 ? Math.round((t.soldQuantity / t.totalQuantity) * 100) : 0}%
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2">{formatMinor(t.revenueMinor)}</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={`Edit ${t.name}`}
                                onClick={() =>
                                  setEditForm({
                                    id: t.id,
                                    name: t.name,
                                    // The input shows taka; the API speaks paisa.
                                    price: String(fromMinor(t.priceMinor)),
                                    totalQuantity: String(t.totalQuantity),
                                    maxPerOrder: '5',
                                  })
                                }
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                disabled={t.soldQuantity > 0 || deleteMutation.isPending}
                                title={t.soldQuantity > 0 ? 'Cannot delete — tickets already sold' : 'Delete ticket type'}
                                aria-label={`Delete ${t.name}`}
                                onClick={() => {
                                  if (window.confirm(`Delete ticket type "${t.name}"?`)) deleteMutation.mutate(t.id)
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>

              {/* Add ticket type inline form */}
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Plus className="h-3.5 w-3.5" /> Add Ticket Type
                </p>
                <div className="grid gap-2 sm:grid-cols-5 sm:items-end">
                  <div className="grid gap-1">
                    <Label className="text-xs" htmlFor="at-name">Name</Label>
                    <Input
                      id="at-name"
                      className="h-8"
                      value={addForm.name}
                      onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                      placeholder="e.g. VIP"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs" htmlFor="at-price">Price (৳)</Label>
                    <Input
                      id="at-price"
                      type="number"
                      min="0"
                      className="h-8"
                      value={addForm.price}
                      onChange={(e) => setAddForm({ ...addForm, price: e.target.value })}
                      placeholder="1000"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs" htmlFor="at-qty">Quantity</Label>
                    <Input
                      id="at-qty"
                      type="number"
                      min="1"
                      className="h-8"
                      value={addForm.totalQuantity}
                      onChange={(e) => setAddForm({ ...addForm, totalQuantity: e.target.value })}
                      placeholder="50"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs" htmlFor="at-max">Max / order</Label>
                    <Input
                      id="at-max"
                      type="number"
                      min="1"
                      className="h-8"
                      value={addForm.maxPerOrder}
                      onChange={(e) => setAddForm({ ...addForm, maxPerOrder: e.target.value })}
                    />
                  </div>
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={addMutation.isPending}
                    onClick={() => {
                      if (!addForm.name.trim() || addForm.price === '' || !addForm.totalQuantity) {
                        toast.error('Fill in name, price and quantity')
                        return
                      }
                      addMutation.mutate()
                    }}
                  >
                    {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Recent orders */}
            <div className="grid gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Users className="h-4 w-4" /> Recent Orders
              </h3>
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                {a.recentOrders.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">No orders yet.</p>
                ) : (
                  <ul className="divide-y">
                    {a.recentOrders.map((o) => (
                      <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-medium text-muted-foreground">{o.orderNumber}</p>
                          <p className="truncate font-medium">{o.user.name}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{o._count.tickets} {o._count.tickets === 1 ? 'ticket' : 'tickets'}</Badge>
                          <span className="font-semibold">{formatMinor(o.totalMinor)}</span>
                          <PaymentStatusBadge status={o.paymentStatus} />
                          <span className="w-16 text-right text-xs text-muted-foreground">{timeAgo(o.createdAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
