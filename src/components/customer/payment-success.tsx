'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import confetti from 'canvas-confetti'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Loader2,
  MapPin,
  QrCode,
  ScanLine,
  Smartphone,
} from 'lucide-react'
import { apiGet } from '@/lib/api'
import { paths } from '@/lib/routes'
import { formatMinor, formatEventDate, formatTime } from '@/lib/format'
import type { OrderDTO } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/app/empty-state'
import { CategoryIcon } from '@/components/app/category-icon'
import { TicketStatusBadge } from '@/components/customer/ticket-status-badge'
import { StepRail } from '@/components/customer/checkout-steps'

/** Celebration is decoration; anyone who asked for less motion gets none. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function PaymentSuccess({ orderId }: { orderId: string }) {
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
    if (prefersReducedMotion()) return
    confetti({ particleCount: 130, spread: 80, origin: { y: 0.7 } })
  }, [paid])

  if (query.isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <EmptyState
          icon={AlertTriangle}
          title="Order not found"
          description="We could not verify this order. It may not exist, or it belongs to another account."
          action={
            <Button asChild>
              <Link href={paths.events()}>
                <ArrowLeft className="size-4" /> Back to events
              </Link>
            </Button>
          }
        />
      </div>
    )
  }

  if (query.isLoading || !order) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 px-4 py-32 text-center"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">Verifying your payment…</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Checking with the server — please don’t close this page.
        </p>
      </div>
    )
  }

  const payment = order.payments?.[0]

  if (!paid) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6">
        <StepRail current={2} className="mb-6" />
        <div className="rounded-2xl border border-border/70 bg-card p-6 text-center shadow-sm sm:p-8">
          <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="size-8" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Payment not completed</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            We could not verify a completed payment for order{' '}
            <span className="font-mono font-medium text-foreground">{order.orderNumber}</span>. No
            tickets have been issued and nothing has been charged.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button asChild className="h-11 flex-1">
              <Link href={paths.order(orderId)}>Try payment again</Link>
            </Button>
            <Button asChild variant="outline" className="h-11 flex-1">
              <Link href={paths.events()}>Back to events</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const tickets = order.tickets ?? []

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <StepRail current={3} className="mb-6" />

      {/* ── confirmation ── */}
      <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="identity-band relative border-b border-border/70 px-5 py-8 text-center sm:px-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
          />
          <span className="relative mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <CheckCircle2 className="size-9" aria-hidden="true" />
          </span>
          <h1 className="relative mt-4 text-pretty text-2xl font-semibold tracking-tight sm:text-3xl">
            You’re going!
          </h1>
          <p className="relative mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Payment verified and {tickets.length === 1 ? 'your ticket is' : 'your tickets are'}{' '}
            issued. A copy lives in My tickets — you don’t need to print anything.
          </p>
        </div>

        <div className="p-5 sm:p-6">
          {/* A definition list, one column on a phone: the old 2-up grid put
              a 20-character transaction id in a half-width cell at 375px. */}
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Order number', value: order.orderNumber, mono: true },
              { label: 'Total paid', value: formatMinor(order.totalMinor), accent: true },
              { label: 'Paid with', value: payment?.method ?? 'SSLCOMMERZ' },
              { label: 'Transaction ID', value: payment?.transactionId ?? '—', mono: true },
            ].map((row) => (
              <div key={row.label} className="rounded-xl border border-border/70 bg-muted/35 p-3">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {row.label}
                </dt>
                <dd
                  className={[
                    'mt-1 break-all text-sm font-semibold',
                    row.mono ? 'font-mono text-xs leading-5' : '',
                    row.accent ? 'text-primary tabular-nums' : '',
                  ].join(' ')}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          {order.event && (
            <div className="mt-4 flex items-center gap-4 rounded-xl border border-border/70 p-3">
              <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted sm:h-16 sm:w-24">
                {order.event.banner ? (
                   
                  <img
                    src={order.event.banner}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-accent text-primary/70"
                    aria-hidden="true"
                  >
                    <CategoryIcon category={order.event.category} className="size-6" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <Link
                  href={paths.event(order.event)}
                  className="line-clamp-1 font-semibold tracking-tight transition-colors duration-200 hover:text-primary"
                >
                  {order.event.title}
                </Link>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {formatEventDate(order.event.startDate)} · {formatTime(order.event.startTime)}
                  </span>
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="line-clamp-1">
                    {order.event.venue}, {order.event.city}
                  </span>
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── the tickets themselves ── */}
      <section className="mt-6" aria-label="Your tickets">
        <h2 className="mb-3 flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <QrCode className="size-[18px]" aria-hidden="true" />
          </span>
          {tickets.length === 1 ? 'Your ticket' : `Your ${tickets.length} tickets`}
        </h2>

        {tickets.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-muted/25 p-6 text-center text-sm text-muted-foreground">
            Tickets are being generated — refresh in a moment.
          </p>
        ) : (
          <div className="space-y-2.5">
            {tickets.map((ticket) => (
              <Link
                key={ticket.id}
                href={paths.ticket(ticket.id)}
                className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium tracking-tight">
                    {ticket.ticketType?.name ?? 'Ticket'}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {ticket.attendeeName}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {ticket.ticketCode}
                  </p>
                </div>
                <TicketStatusBadge status={ticket.status} className="shrink-0" />
                <span className="hidden shrink-0 items-center gap-1 text-sm font-medium text-primary sm:flex">
                  View QR
                  <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
                </span>
                <QrCode className="size-5 shrink-0 text-primary sm:hidden" aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── what happens next ──
          The old page ended at the ticket list, leaving "so what do I do at
          the door?" unanswered at exactly the moment it is being asked. */}
      <section className="mt-6 rounded-2xl border border-border/70 bg-muted/35 p-5" aria-label="What happens next">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          On the day
        </p>
        <ul className="mt-3 space-y-3">
          {[
            {
              icon: Smartphone,
              text: 'Open the ticket on your phone — it works offline once you have viewed it.',
            },
            { icon: ScanLine, text: 'Staff scan the QR at the gate. Each ticket admits one person.' },
            {
              icon: CheckCircle2,
              text: 'A scanned ticket cannot be reused, so don’t share screenshots.',
            },
          ].map((item) => (
            <li key={item.text} className="flex items-start gap-3 text-sm text-muted-foreground">
              <item.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="leading-relaxed">{item.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button asChild className="h-11 flex-1">
          <Link href={paths.tickets()}>Go to my tickets</Link>
        </Button>
        <Button asChild variant="outline" className="h-11 flex-1">
          <Link href={paths.events()}>Find another event</Link>
        </Button>
      </div>
    </div>
  )
}
