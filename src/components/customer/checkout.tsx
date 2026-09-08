'use client'

import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CalendarDays,
  Loader2,
  MapPin,
  Minus,
  Plus,
  ShieldCheck,
} from 'lucide-react'
import { apiGet, apiPost } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { categoryEmoji, formatBDT, formatEventDate, formatTime } from '@/lib/format'
import { PLATFORM_FEE_RATE } from '@/lib/constants'
import type { EventDetail as EventDetailDTO, TicketTypeDTO } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/app/empty-state'
import { ticketWindow } from '@/lib/ticket-window'

interface CreateOrderResponse {
  order: {
    id: string
    orderNumber: string
    subtotal: number
    platformFee: number
    totalAmount: number
    eventId: string
  }
}

export function Checkout({ eventId }: { eventId: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const user = useAppStore((s) => s.user)
  const view = useAppStore((s) => s.view)

  // Selection handed over from the event page, when the user came that way.
  const handoffItems = view.name === 'checkout' && view.eventId === eventId ? view.items : undefined

  const [name, setName] = useState(() => user?.name ?? '')
  const [email, setEmail] = useState(() => user?.email ?? '')
  const [phone, setPhone] = useState(() => user?.phone ?? '')
  const [agreed, setAgreed] = useState(false)
  const [qtys, setQtys] = useState<Record<string, number>>({})

  const initedRef = useRef<string | null>(null)

  const query = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => apiGet<{ event: EventDetailDTO }>(`/api/events/${eventId}`),
  })
  const event = query.data?.event

  // Initial selection, derived until the user interacts (no setState-in-effect):
  // honour what was picked on the event page, clamped to what is still
  // available, and only fall back to "1 of the first purchasable type" when
  // the user arrived without a selection.
  const effQtys = useMemo<Record<string, number>>(() => {
    if (!event) return {}
    if (initedRef.current === event.id) return qtys

    const requested = new Map((handoffItems ?? []).map((i) => [i.ticketTypeId, i.quantity]))
    const initial: Record<string, number> = {}
    let seeded = false
    for (const t of event.ticketTypes) {
      const win = ticketWindow(t)
      const want = requested.get(t.id) ?? 0
      if (win.purchasable && want > 0) {
        initial[t.id] = Math.min(want, win.max)
        seeded = true
      } else {
        initial[t.id] = 0
      }
    }
    if (!seeded) {
      for (const t of event.ticketTypes) {
        if (ticketWindow(t).purchasable) {
          initial[t.id] = 1
          break
        }
      }
    }
    return initial
  }, [event, qtys, handoffItems])

  const subtotal = useMemo(
    () => (event ? event.ticketTypes.reduce((acc, t) => acc + (effQtys[t.id] ?? 0) * t.price, 0) : 0),
    [event, effQtys],
  )
  const fee = Math.round(subtotal * PLATFORM_FEE_RATE)
  const total = subtotal + fee
  const totalQty = event ? event.ticketTypes.reduce((acc, t) => acc + (effQtys[t.id] ?? 0), 0) : 0

  function changeQty(t: TicketTypeDTO, delta: number) {
    const win = ticketWindow(t)
    if (event && initedRef.current !== event.id) initedRef.current = event.id
    const cur = effQtys[t.id] ?? 0
    const next = win.purchasable ? Math.min(Math.max(0, cur + delta), Math.max(0, win.max)) : 0
    setQtys((prev) => ({ ...prev, [t.id]: next }))
  }

  const createOrder = useMutation({
    mutationFn: (payload: {
      eventId: string
      items: Array<{ ticketTypeId: string; quantity: number }>
      attendee: { name: string; email: string; phone: string }
    }) => apiPost<CreateOrderResponse>('/api/orders', payload),
    onSuccess: (data) => {
      toast.success('Order created — redirecting to payment…')
      navigate({ name: 'payment', orderId: data.order.id })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create order')
    },
  })

  function handleSubmit() {
    if (!event) return
    if (!name.trim() || !email.trim() || !phone.trim()) {
      toast.error('Please fill in your name, email and phone number.')
      return
    }
    const items = event.ticketTypes
      .filter((t) => (effQtys[t.id] ?? 0) > 0)
      .map((t) => ({ ticketTypeId: t.id, quantity: effQtys[t.id] ?? 0 }))
    if (items.length === 0) {
      toast.error('Please select at least one ticket.')
      return
    }
    if (!agreed) {
      toast.error('Please agree to the event terms & refund policy to continue.')
      return
    }
    createOrder.mutate({
      eventId,
      items,
      attendee: { name: name.trim(), email: email.trim(), phone: phone.trim() },
    })
  }

  if (query.isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <EmptyState
          icon={CalendarDays}
          title="Event not found"
          description="We could not load this event for checkout."
          action={
            <Button onClick={() => navigate({ name: 'home' })}>
              <ArrowLeft className="h-4 w-4" /> Back to Events
            </Button>
          }
        />
      </div>
    )
  }

  if (query.isLoading || !event) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Skeleton className="h-72 w-full rounded-xl lg:col-span-3" />
          <Skeleton className="h-96 w-full rounded-xl lg:col-span-2" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Checkout</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review your tickets and complete attendee details.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'event-detail', eventId })}>
          <ArrowLeft className="h-4 w-4" /> Back to event
        </Button>
      </div>

      {/* Event strip */}
      <Card className="mt-4 p-4">
        <div className="flex items-center gap-4">
          <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
            {event.banner ? (
               
              <img src={event.banner} alt={`${event.title} banner`} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-accent text-2xl">
                {categoryEmoji(event.category)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <button
              onClick={() => navigate({ name: 'event-detail', eventId })}
              className="line-clamp-1 text-left font-semibold hover:text-primary"
            >
              {event.title}
            </button>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                {formatEventDate(event.startDate)} · {formatTime(event.startTime)}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {event.venue}, {event.city}
              </span>
            </p>
          </div>
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Attendee form */}
        <Card className="p-4 sm:p-6 lg:col-span-3">
          <h2 className="font-semibold">Attendee Information</h2>
          <p className="mt-1 text-sm text-muted-foreground">Tickets will be issued under this attendee&apos;s name.</p>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="attendee-name">Full name *</Label>
              <Input
                id="attendee-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jubair Hossain"
                autoComplete="name"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="attendee-email">Email *</Label>
                <Input
                  id="attendee-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="attendee-phone">Phone *</Label>
                <Input
                  id="attendee-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  autoComplete="tel"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Order summary */}
        <Card className="h-fit p-4 sm:p-6 lg:sticky lg:top-24 lg:col-span-2">
          <h2 className="font-semibold">Order Summary</h2>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {event.ticketTypes.map((t) => {
                  const win = ticketWindow(t)
                  const qty = effQtys[t.id] ?? 0
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="max-w-[160px]">
                        <p className="truncate font-medium">{t.name}</p>
                        {!win.purchasable && (
                          <Badge variant="secondary" className="mt-1">
                            {win.soldOut ? 'Sold out' : win.closed ? 'Sales closed' : 'Sales start soon'}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{t.price === 0 ? 'Free' : formatBDT(t.price)}</TableCell>
                      <TableCell>
                        {win.purchasable ? (
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              disabled={qty === 0}
                              onClick={() => changeQty(t, -1)}
                              aria-label={`Remove one ${t.name} ticket`}
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </Button>
                            <span className="w-6 text-center text-sm font-semibold tabular-nums">{qty}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              disabled={qty >= win.max}
                              onClick={() => changeQty(t, 1)}
                              aria-label={`Add one ${t.name} ticket`}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">{qty > 0 ? formatBDT(qty * t.price) : '—'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <Separator className="my-4" />

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal ({totalQty} ticket{totalQty === 1 ? '' : 's'})</span>
              <span>{formatBDT(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Platform fee (3%)</span>
              <span>{formatBDT(fee)}</span>
            </div>
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span className="text-primary">{formatBDT(total)}</span>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2">
            <Checkbox
              id="terms"
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="terms" className="text-sm font-normal leading-snug text-muted-foreground">
              I agree to the event terms &amp; refund policy.
            </Label>
          </div>

          <Button className="mt-4 w-full" size="lg" onClick={handleSubmit} disabled={createOrder.isPending}>
            {createOrder.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Processing…
              </>
            ) : (
              <>Proceed to Payment · {formatBDT(total)}</>
            )}
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> You will pay securely via SSLCOMMERZ
          </p>
        </Card>
      </div>
    </div>
  )
}
