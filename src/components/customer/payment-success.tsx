'use client'

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import confetti from 'canvas-confetti'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  QrCode,
} from 'lucide-react'
import { apiGet } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { categoryEmoji, formatBDT, formatEventDate, formatTime } from '@/lib/format'
import type { OrderDTO } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/app/empty-state'
import { TicketStatusBadge } from '@/components/customer/ticket-status-badge'

export function PaymentSuccess({ orderId }: { orderId: string }) {
  const navigate = useAppStore((s) => s.navigate)

  // Server-side verification is the ONLY source of truth — never the URL.
  const query = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => apiGet<{ order: OrderDTO }>(`/api/orders/${orderId}`),
  })
  const order = query.data?.order
  const paid = order?.paymentStatus === 'PAID'

  const firedRef = useRef(false)
  useEffect(() => {
    if (!paid || firedRef.current) return
    firedRef.current = true
    confetti({ particleCount: 130, spread: 80, origin: { y: 0.7 } })
  }, [paid])

  if (query.isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <EmptyState
          icon={AlertTriangle}
          title="Order not found"
          description="We could not verify this order. It may not exist or belong to another account."
          action={
            <Button onClick={() => navigate({ name: 'home' })}>
              <ArrowLeft className="h-4 w-4" /> Back to Events
            </Button>
          }
        />
      </div>
    )
  }

  if (query.isLoading || !order) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Verifying your payment…</p>
        <p className="text-xs text-muted-foreground">Checking with the server — do not close this page.</p>
      </div>
    )
  }

  const payment = order.payments?.[0]

  if (!paid) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Card className="mx-auto max-w-lg p-8 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-8 w-8" />
          </span>
          <h1 className="mt-4 text-2xl font-bold">Payment not completed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We could not verify a completed payment for order{' '}
            <span className="font-mono font-semibold text-foreground">{order.orderNumber}</span>. No tickets have been
            issued.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button onClick={() => navigate({ name: 'payment', orderId })}>Try Payment Again</Button>
            <Button variant="outline" onClick={() => navigate({ name: 'home' })}>
              Back to Events
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  const tickets = order.tickets ?? []

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        {/* Success header */}
        <Card className="p-6 sm:p-8">
          <div className="text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
              <CheckCircle2 className="h-9 w-9" />
            </span>
            <h1 className="mt-4 text-2xl font-bold sm:text-3xl">Payment Verified &amp; Confirmed!</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your tickets are confirmed. A copy is saved under My Tickets.
            </p>
          </div>

          <Separator className="my-5" />

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Order Number</p>
              <p className="truncate font-mono font-semibold">{order.orderNumber}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Total Paid</p>
              <p className="font-semibold text-primary">{formatBDT(order.totalAmount)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Payment Method</p>
              <p className="font-semibold">{payment?.method ?? 'SSLCOMMERZ'}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Transaction ID</p>
              <p className="truncate font-mono text-xs font-semibold leading-5">
                {payment?.transactionId ?? '—'}
              </p>
            </div>
          </div>

          {/* Event info card */}
          {order.event && (
            <div className="mt-4 flex items-center gap-4 rounded-xl border p-3">
              <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                {order.event.banner ? (
                   
                  <img
                    src={order.event.banner}
                    alt={`${order.event.title} banner`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-accent text-2xl">
                    {categoryEmoji(order.event.category)}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <button
                  onClick={() => navigate({ name: 'event-detail', eventId: order.event!.id })}
                  className="line-clamp-1 text-left font-semibold hover:text-primary"
                >
                  {order.event.title}
                </button>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {formatEventDate(order.event.startDate)} · {formatTime(order.event.startTime)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {order.event.venue}, {order.event.city}
                </p>
              </div>
            </div>
          )}
        </Card>

        {/* Tickets */}
        <section aria-label="Your tickets">
          <h2 className="mb-3 text-lg font-semibold">Your Tickets ({tickets.length})</h2>
          {tickets.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Tickets are being generated — refresh in a moment.
            </p>
          ) : (
            <div className="space-y-3">
              {tickets.map((ticket) => {
                return (
                  <div
                    key={ticket.id}
                    className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{ticket.ticketType?.name ?? 'Ticket'}</p>
                      <p className="text-sm text-muted-foreground">Attendee: {ticket.attendeeName}</p>
                      <p className="font-mono text-xs text-muted-foreground">{ticket.ticketCode}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <TicketStatusBadge status={ticket.status} />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate({ name: 'ticket-detail', ticketId: ticket.id })}
                      >
                        <QrCode className="h-4 w-4" /> View QR Ticket
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Actions */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={() => navigate({ name: 'my-tickets' })}>
            Go to My Tickets
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => navigate({ name: 'home' })}>
            Back to Events
          </Button>
        </div>
      </div>
    </div>
  )
}
