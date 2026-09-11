'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertCircle,
  CalendarDays,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  ScanLine,
  Ticket as TicketIcon,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import { formatMinor, formatEventDate, formatTime } from '@/lib/format'
import { fromMinor, toMinor } from '@/lib/money'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { EventAnalytics as EventAnalyticsDTO } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { CategoryIcon } from '@/components/app/category-icon'
import { PaymentStatusBadge, EventStatusBadge } from '@/components/dashboard/status-badges'
import { Eyebrow, Meter, panelClass } from '@/components/dashboard/primitives'

/*
 * Per-event console: how it is selling, what is on sale, who bought.
 *
 * On visualisation — the analytics endpoint returns totals and a ten-order tail,
 * with no time series anywhere in the payload. So there is no honest
 * sales-over-time line to draw here, and plotting the last ten orders as a
 * trend would invent one. What the data *is* is a set of ratios against a
 * target (sold vs capacity, arrived vs sold), and the right instrument for that
 * is a bullet row — a bar with the value and the percentage as text beside it.
 * `Meter` from the dashboard kit already is one, so this file draws no charts
 * and pulls in no chart library. A donut for check-ins was considered and
 * rejected: it encodes one number in the least accessible way available.
 */

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

const pctOf = (value: number, max: number) => (max > 0 ? Math.round((value / max) * 100) : 0)

interface TypeForm {
  name: string
  price: string
  totalQuantity: string
  maxPerOrder: string
}

const emptyForm: TypeForm = { name: '', price: '', totalQuantity: '', maxPerOrder: '5' }

// ─────────────────────────────────────────────────────────── small parts

/**
 * One figure in the header strip.
 *
 * Deliberately not `HeroMetric` from the dashboard kit: that carries a full
 * panel, a blurred accent and a 5xl figure, which is right on a page and far
 * too loud four-across inside a dialog.
 */
function Stat({
  label,
  value,
  hint,
  icon: Icon,
  emphasis = false,
}: {
  label: string
  value: string | number
  hint?: string
  icon?: LucideIcon
  emphasis?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        emphasis ? 'border-primary/25 bg-primary/[0.06]' : 'border-border/70 bg-muted/30',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Eyebrow className="text-[10px]">{label}</Eyebrow>
        {Icon && (
          <Icon
            className={cn('size-3.5 shrink-0', emphasis ? 'text-primary' : 'text-muted-foreground')}
            aria-hidden="true"
          />
        )}
      </div>
      <p
        className={cn(
          'mt-1 truncate font-semibold tracking-tight tabular-nums',
          emphasis ? 'text-2xl text-primary' : 'text-xl',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">{hint}</p>}
    </div>
  )
}

function FieldSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[5.25rem] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="h-64 rounded-2xl lg:col-span-7" />
        <Skeleton className="h-64 rounded-2xl lg:col-span-5" />
      </div>
    </div>
  )
}

/** Shared by the add form and the inline edit row. */
function TypeFields({
  form,
  onChange,
  idPrefix,
  minQuantity = 1,
}: {
  form: TypeForm
  onChange: (next: TypeForm) => void
  idPrefix: string
  minQuantity?: number
}) {
  return (
    <>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label className="text-xs" htmlFor={`${idPrefix}-name`}>
          Name
        </Label>
        <Input
          id={`${idPrefix}-name`}
          className="h-9"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="e.g. VIP"
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs" htmlFor={`${idPrefix}-price`}>
          Price (৳)
        </Label>
        <Input
          id={`${idPrefix}-price`}
          type="number"
          min="0"
          className="h-9 tabular-nums"
          value={form.price}
          onChange={(e) => onChange({ ...form, price: e.target.value })}
          placeholder="1000"
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs" htmlFor={`${idPrefix}-qty`}>
          Quantity
        </Label>
        <Input
          id={`${idPrefix}-qty`}
          type="number"
          min={minQuantity}
          className="h-9 tabular-nums"
          value={form.totalQuantity}
          onChange={(e) => onChange({ ...form, totalQuantity: e.target.value })}
          placeholder="50"
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs" htmlFor={`${idPrefix}-max`}>
          Max / order
        </Label>
        <Input
          id={`${idPrefix}-max`}
          type="number"
          min="1"
          className="h-9 tabular-nums"
          value={form.maxPerOrder}
          onChange={(e) => onChange({ ...form, maxPerOrder: e.target.value })}
        />
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────── panel

export function EventAnalytics({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [addForm, setAddForm] = useState<TypeForm>(emptyForm)
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<TypeForm>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', eventId],
    queryFn: () =>
      apiGet<{ analytics: EventAnalyticsDTO }>(`/api/organizer/events/${eventId}/analytics`),
  })

  const a = data?.analytics

  /**
   * `maxPerOrder` per ticket type.
   *
   * `ticketTypeBreakdown` does not carry it, so the edit form used to open with
   * a hardcoded "5" and then PUT that value back — silently resetting the limit
   * on any type that was not already 5. The full `event.ticketTypes` array is in
   * the same response and does carry it, so no API change is needed.
   */
  const maxPerOrderById = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of a?.event.ticketTypes ?? []) map.set(t.id, t.maxPerOrder)
    return map
  }, [a])

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
      setAddForm(emptyForm)
      setAddOpen(false)
      invalidateAll()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: string; form: TypeForm }) =>
      apiPut(`/api/organizer/ticket-types/${id}`, {
        name: form.name.trim(),
        priceMinor: toMinor(form.price) ?? 0,
        totalQuantity: Number(form.totalQuantity),
        maxPerOrder: Number(form.maxPerOrder || '5'),
      }),
    onSuccess: () => {
      toast.success('Ticket type updated')
      setEditId(null)
      invalidateAll()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/organizer/ticket-types/${id}`),
    onSuccess: () => {
      toast.success('Ticket type deleted')
      setDeleteTarget(null)
      invalidateAll()
    },
    onError: (e: Error) => {
      toast.error(e.message)
      setDeleteTarget(null)
    },
  })

  function startEdit(t: EventAnalyticsDTO['ticketTypeBreakdown'][number]) {
    setEditId(t.id)
    setEditForm({
      name: t.name,
      // The input shows taka; the API speaks paisa.
      price: String(fromMinor(t.priceMinor)),
      totalQuantity: String(t.totalQuantity),
      maxPerOrder: String(maxPerOrderById.get(t.id) ?? 5),
    })
  }

  const sellThrough = a ? pctOf(a.sold, a.totalTickets) : 0
  const arrivedOf = a ? a.checkIns + a.notArrived : 0
  const arrivedPct = a ? pctOf(a.checkIns, arrivedOf) : 0
  const publicLive = a?.event.status === 'PUBLISHED' || a?.event.status === 'ONGOING'

  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => {
          if (!o) onClose()
        }}
      >
        {/* A console, not a form: the old 2xl width put a 560px-min table and a
            five-field editor inside a 672px box. Wider, with the header pinned
            and only the body scrolling. */}
        <DialogContent
          showCloseButton
          className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        >
          {/* ── header ── */}
          <div className="shrink-0 border-b border-border/70 px-5 py-4 pr-12">
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
                aria-hidden="true"
              >
                {a ? (
                  <CategoryIcon category={a.event.category} className="size-5" />
                ) : (
                  <TicketIcon className="size-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="truncate text-base font-semibold tracking-tight sm:text-lg">
                    {a ? a.event.title : 'Event analytics'}
                  </DialogTitle>
                  {a && <EventStatusBadge status={a.event.status} />}
                </div>
                <DialogDescription asChild>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {a ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                          <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                          {formatEventDate(a.event.startDate)} · {formatTime(a.event.startTime)}
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">
                            {a.event.venue}, {a.event.city}
                          </span>
                        </span>
                        {publicLive && (
                          <Link
                            href={paths.event(a.event)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex cursor-pointer items-center gap-1 rounded font-medium text-primary underline-offset-4 transition-colors duration-200 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            View public page
                            <ExternalLink className="size-3" aria-hidden="true" />
                          </Link>
                        )}
                      </>
                    ) : (
                      <span>Sales, ticket types and recent orders</span>
                    )}
                  </div>
                </DialogDescription>
              </div>
            </div>
          </div>

          {/* ── body ── */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {isLoading && <FieldSkeleton />}

            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{error instanceof Error ? error.message : 'Failed to load analytics'}</span>
              </div>
            )}

            {a && (
              <div className="space-y-4">
                {/* ── figures ──
                    Revenue leads and is the only tinted tile: it is the number
                    the organizer opened this panel to see. */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat
                    label="Revenue"
                    value={formatMinor(a.revenueMinor)}
                    hint="Paid orders, gross"
                    icon={Wallet}
                    emphasis
                  />
                  <Stat
                    label="Sold"
                    value={a.sold}
                    hint={`of ${a.totalTickets} capacity`}
                    icon={TicketIcon}
                  />
                  <Stat
                    label="Sell-through"
                    value={a.totalTickets > 0 ? `${sellThrough}%` : '—'}
                    hint={`${a.available} still available`}
                  />
                  <Stat
                    label="Checked in"
                    value={a.checkIns}
                    hint={arrivedOf > 0 ? `${arrivedPct}% of sold` : 'No sold tickets yet'}
                    icon={ScanLine}
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-12">
                  {/* ── ticket types ── */}
                  <section
                    aria-labelledby="tt-heading"
                    className={cn(panelClass, 'lg:col-span-7')}
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                      <h3 id="tt-heading" className="text-sm font-semibold tracking-tight">
                        Ticket types
                        <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                          {a.ticketTypeBreakdown.length}
                        </span>
                      </h3>
                      <Button
                        size="sm"
                        variant={addOpen ? 'secondary' : 'outline'}
                        className="h-8 cursor-pointer"
                        onClick={() => setAddOpen((v) => !v)}
                        aria-expanded={addOpen}
                        aria-controls="tt-add"
                      >
                        <Plus className="size-3.5" aria-hidden="true" /> Add type
                      </Button>
                    </div>

                    {/* Rows rather than a table: the same wrapping-flex shape the
                        organizer overview uses for its event list, and it holds
                        together from 340px to full width without a second
                        markup path or a horizontal scrollbar. */}
                    {a.ticketTypeBreakdown.length === 0 && !addOpen ? (
                      <div className="px-4 py-10 text-center">
                        <TicketIcon
                          className="mx-auto size-5 text-muted-foreground/60"
                          aria-hidden="true"
                        />
                        <p className="mt-2 text-sm font-medium">No ticket types yet</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Add one to put this event on sale.
                        </p>
                        <Button
                          size="sm"
                          className="mt-3 cursor-pointer"
                          onClick={() => setAddOpen(true)}
                        >
                          <Plus className="size-3.5" aria-hidden="true" /> Add ticket type
                        </Button>
                      </div>
                    ) : (
                      <ul className="divide-y divide-border/70">
                        {a.ticketTypeBreakdown.map((t) => {
                          const fill = pctOf(t.soldQuantity, t.totalQuantity)
                          const editing = editId === t.id
                          const busy = deleteMutation.isPending && deleteMutation.variables === t.id

                          if (editing) {
                            return (
                              <li key={t.id} className="bg-primary/[0.04] px-4 py-4">
                                <Eyebrow className="mb-2.5 text-[10px]">Editing {t.name}</Eyebrow>
                                <div className="grid gap-3 sm:grid-cols-5">
                                  <TypeFields
                                    form={editForm}
                                    onChange={setEditForm}
                                    idPrefix={`et-${t.id}`}
                                    // Never below what is already sold, or the
                                    // API would have to reject the save.
                                    minQuantity={t.soldQuantity || 1}
                                  />
                                </div>
                                <div className="mt-3 flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    className="h-8 cursor-pointer"
                                    disabled={updateMutation.isPending}
                                    onClick={() =>
                                      updateMutation.mutate({ id: t.id, form: editForm })
                                    }
                                  >
                                    {updateMutation.isPending && (
                                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                                    )}
                                    Save changes
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 cursor-pointer"
                                    onClick={() => setEditId(null)}
                                  >
                                    Cancel
                                  </Button>
                                  {t.soldQuantity > 0 && (
                                    <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                                      {t.soldQuantity} already sold
                                    </span>
                                  )}
                                </div>
                              </li>
                            )
                          }

                          return (
                            <li
                              key={t.id}
                              className={cn(
                                'px-4 py-3 transition-colors duration-200 hover:bg-muted/40',
                                busy && 'opacity-60',
                              )}
                            >
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                                  <div className="flex items-baseline gap-2">
                                    <p className="truncate text-sm font-medium">{t.name}</p>
                                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                      {formatMinor(t.priceMinor)}
                                    </span>
                                  </div>
                                  {/* Bullet row: bar plus the value and the
                                      percentage as text, never the bar alone. */}
                                  <div className="mt-1.5 flex items-center gap-2">
                                    <Meter
                                      value={t.soldQuantity}
                                      max={t.totalQuantity}
                                      label={`${t.name}: ${t.soldQuantity} of ${t.totalQuantity} sold, ${fill}%`}
                                      className="w-20 shrink-0"
                                    />
                                    <span className="text-[11px] text-muted-foreground tabular-nums">
                                      {t.soldQuantity}/{t.totalQuantity} · {fill}%
                                    </span>
                                  </div>
                                </div>

                                <p className="shrink-0 text-sm font-semibold tabular-nums">
                                  {formatMinor(t.revenueMinor)}
                                </p>

                                <div className="flex shrink-0 items-center gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 cursor-pointer"
                                    aria-label={`Edit ${t.name}`}
                                    onClick={() => startEdit(t)}
                                  >
                                    <Pencil className="size-3.5" aria-hidden="true" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 cursor-pointer text-destructive hover:text-destructive"
                                    disabled={t.soldQuantity > 0 || busy}
                                    title={
                                      t.soldQuantity > 0
                                        ? 'Cannot delete — tickets already sold'
                                        : `Delete ${t.name}`
                                    }
                                    aria-label={`Delete ${t.name}`}
                                    onClick={() => setDeleteTarget({ id: t.id, name: t.name })}
                                  >
                                    {busy ? (
                                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                                    ) : (
                                      <Trash2 className="size-3.5" aria-hidden="true" />
                                    )}
                                  </Button>
                                </div>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}

                    {/* ── add form, progressive disclosure ── */}
                    {addOpen && (
                      <div
                        id="tt-add"
                        className="border-t border-border/70 bg-muted/30 px-4 py-4"
                      >
                        <Eyebrow className="mb-2.5 text-[10px]">New ticket type</Eyebrow>
                        <div className="grid gap-3 sm:grid-cols-5">
                          <TypeFields form={addForm} onChange={setAddForm} idPrefix="at" />
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <Button
                            size="sm"
                            className="h-8 cursor-pointer"
                            disabled={addMutation.isPending}
                            onClick={() => {
                              if (
                                !addForm.name.trim() ||
                                addForm.price === '' ||
                                !addForm.totalQuantity
                              ) {
                                toast.error('Fill in name, price and quantity')
                                return
                              }
                              addMutation.mutate()
                            }}
                          >
                            {addMutation.isPending && (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                            )}
                            Add ticket type
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 cursor-pointer"
                            onClick={() => {
                              setAddOpen(false)
                              setAddForm(emptyForm)
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </section>

                  {/* ── right rail ── */}
                  <div className="space-y-4 lg:col-span-5">
                    {/* Check-in */}
                    <section aria-labelledby="ci-heading" className={cn(panelClass, 'p-4')}>
                      <div className="flex items-center justify-between gap-3">
                        <h3
                          id="ci-heading"
                          className="flex items-center gap-1.5 text-sm font-semibold tracking-tight"
                        >
                          <ScanLine className="size-4 text-primary" aria-hidden="true" />
                          Gate check-in
                        </h3>
                        <span className="text-sm font-semibold tabular-nums">
                          {arrivedOf > 0 ? `${arrivedPct}%` : '—'}
                        </span>
                      </div>
                      <Meter
                        value={a.checkIns}
                        max={arrivedOf}
                        label={
                          arrivedOf > 0
                            ? `${a.checkIns} of ${arrivedOf} sold tickets checked in, ${arrivedPct}%`
                            : 'No sold tickets yet'
                        }
                        // Arrivals rising is good news, so this bar should never
                        // flip to the warning tone the way sell-through does.
                        hot={1.1}
                        className="mt-3"
                      />
                      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <dt className="text-xs text-muted-foreground">Arrived</dt>
                          <dd className="font-semibold tabular-nums">{a.checkIns}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Not arrived</dt>
                          <dd className="font-semibold tabular-nums">{a.notArrived}</dd>
                        </div>
                      </dl>
                    </section>

                    {/* Recent orders */}
                    <section aria-labelledby="ro-heading" className={cn(panelClass, 'overflow-hidden')}>
                      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                        <h3
                          id="ro-heading"
                          className="flex items-center gap-1.5 text-sm font-semibold tracking-tight"
                        >
                          <Users className="size-4" aria-hidden="true" /> Recent orders
                        </h3>
                        <span className="text-xs text-muted-foreground">Latest 10</span>
                      </div>
                      {a.recentOrders.length === 0 ? (
                        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                          No orders yet.
                        </p>
                      ) : (
                        <ul className="max-h-[19rem] divide-y divide-border/70 overflow-y-auto">
                          {a.recentOrders.map((o) => (
                            <li key={o.id} className="px-4 py-2.5">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{o.user.name}</p>
                                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                                    {o.orderNumber}
                                  </p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-sm font-semibold tabular-nums">
                                    {formatMinor(o.totalMinor)}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground tabular-nums">
                                    {timeAgo(o.createdAt)}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-1.5 flex items-center gap-1.5">
                                <PaymentStatusBadge status={o.paymentStatus} />
                                <Badge variant="outline" className="font-normal tabular-nums">
                                  {o._count.tickets}{' '}
                                  {o._count.tickets === 1 ? 'ticket' : 'tickets'}
                                </Badge>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Replaces `window.confirm`, which cannot be styled, cannot be themed and
          is trivially suppressed by the browser. */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this ticket type?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} will be removed from this event. Types with tickets already
              sold cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer bg-destructive text-white hover:bg-destructive/90"
              onClick={(ev) => {
                ev.preventDefault()
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
              }}
            >
              {deleteMutation.isPending && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              Delete type
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
