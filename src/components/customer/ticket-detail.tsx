'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Copy,
  Download,
  MapPin,
  Printer,
  QrCode,
  TicketX,
  WifiOff,
} from 'lucide-react'
import { apiGet } from '@/lib/api'
import { useRouter } from 'next/navigation'
import { paths } from '@/lib/routes'
import { categoryEmoji, categoryLabel, formatDateTimeTime, formatEventDate, formatTime } from '@/lib/format'
import type { OrderDTO, TicketDTO } from '@/lib/types'
import {
  buildTicketSnapshot,
  readTicketSnapshot,
  saveTicketSnapshot,
  type TicketSnapshot,
} from '@/lib/ticket-cache'
import { renderTicketImage } from '@/lib/ticket-image'
import { ticketStatusMeta, TicketStatusBadge } from '@/components/customer/ticket-status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/empty-state'
import { cn } from '@/lib/utils'

/** Flat shape the ticket renders from, whether live or restored from cache. */
interface TicketView {
  orderNumber: string
  ticketCode: string
  qrToken: string
  attendeeName: string
  status: TicketDTO['status']
  checkedInAt: string | null
  ticketTypeName: string
  eventTitle: string
  eventBanner: string | null
  venue: string
  city: string
  startDate: string
  startTime: string
  category: string
}

function fromSnapshot(s: TicketSnapshot): TicketView {
  return {
    orderNumber: s.orderNumber,
    ticketCode: s.ticket.ticketCode,
    qrToken: s.ticket.qrToken,
    attendeeName: s.ticket.attendeeName,
    status: s.ticket.status,
    checkedInAt: s.ticket.checkedInAt,
    ticketTypeName: s.ticket.ticketTypeName ?? 'Ticket',
    eventTitle: s.event.title,
    eventBanner: s.event.banner,
    venue: s.event.venue,
    city: s.event.city,
    startDate: s.event.startDate,
    startTime: s.event.startTime,
    category: s.event.category,
  }
}

function findTicket(orders: OrderDTO[], ticketId: string) {
  for (const order of orders) {
    const ticket = order.tickets?.find((t) => t.id === ticketId)
    if (ticket && order.event) return { order, ticket, event: order.event }
  }
  return null
}

export function TicketDetail({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)

  // Read the cached copy synchronously on first render so an offline visit
  // shows the ticket immediately instead of an error.
  const [cached] = useState<TicketSnapshot | null>(() => readTicketSnapshot(ticketId))

  const query = useQuery({
    queryKey: ['orders', 'mine'],
    queryFn: () => apiGet<{ orders: OrderDTO[] }>('/api/orders/mine'),
    // A gate scan changes this ticket from somebody else's device, so the
    // attendee's own screen has to keep looking rather than sit on stale state.
    refetchOnWindowFocus: true,
    refetchInterval: (q) => {
      const orders = q.state.data?.orders
      if (!orders) return false
      const hit = findTicket(orders, ticketId)
      return hit?.ticket.status === 'ACTIVE' ? 20_000 : false
    },
  })

  const live = query.data ? findTicket(query.data.orders, ticketId) : null

  // Refresh the offline copy whenever the server tells us something new.
  useEffect(() => {
    if (!live) return
    saveTicketSnapshot(ticketId, buildTicketSnapshot(live.order, live.ticket, live.event))
  }, [live, ticketId])

  const view: TicketView | null = live
    ? {
        orderNumber: live.order.orderNumber,
        ticketCode: live.ticket.ticketCode,
        qrToken: live.ticket.qrToken,
        attendeeName: live.ticket.attendeeName,
        status: live.ticket.status,
        checkedInAt: live.ticket.checkedInAt,
        ticketTypeName: live.ticket.ticketType?.name ?? 'Ticket',
        eventTitle: live.event.title,
        eventBanner: live.event.banner,
        venue: live.event.venue,
        city: live.event.city,
        startDate: live.event.startDate,
        startTime: live.event.startTime,
        category: live.event.category,
      }
    : cached
      ? fromSnapshot(cached)
      : null

  const usingCache = !live && !!cached

  // QR is generated on the device from the token, so it works with no network.
  // Near-black rather than brand green: cheap gate scanners and dim screens
  // need the contrast far more than the ticket needs the colour.
  useEffect(() => {
    if (!view?.qrToken) return
    let cancelled = false
    QRCode.toDataURL(view.qrToken, {
      width: 480,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0A0A0A', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [view?.qrToken])

  function copyCode() {
    if (!view) return
    // The ticket code, not the raw qrToken: this is the value a person reads
    // out at the gate or quotes to support. The scanner accepts either.
    navigator.clipboard
      .writeText(view.ticketCode)
      .then(() => {
        setCopied(true)
        toast.success('Ticket code copied')
        window.setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => toast.error('Could not copy the ticket code'))
  }

  async function saveImage() {
    if (!view || !qrDataUrl) return
    setSaving(true)
    try {
      const blob = await renderTicketImage({
        eventTitle: view.eventTitle,
        when: `${formatEventDate(view.startDate)} · ${formatTime(view.startTime)}`,
        venue: `${view.venue}, ${view.city}`,
        attendee: view.attendeeName,
        ticketType: view.ticketTypeName,
        ticketCode: view.ticketCode,
        statusLabel: ticketStatusMeta(view.status).label,
        qrDataUrl,
      })
      // A blob URL rather than a data URL: iOS Safari handles it far better,
      // opening the image so it can be added to the photo library.
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ticketbd-${view.ticketCode}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast.success('Ticket image saved')
    } catch {
      toast.error('Could not save the ticket image. Try the print option instead.')
    } finally {
      setSaving(false)
    }
  }

  // ---------- Loading: shaped like the ticket, not a bare spinner ----------
  if (query.isLoading && !view) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Skeleton className="h-9 w-28" />
        <div className="mx-auto mt-4 w-full max-w-md space-y-0 overflow-hidden rounded-2xl border">
          <Skeleton className="h-32 w-full rounded-none" />
          <div className="space-y-3 p-6">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="flex flex-col items-center gap-3 border-t-2 border-dashed p-6">
            <Skeleton className="h-56 w-56 rounded-xl" />
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      </div>
    )
  }

  if (!view) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <EmptyState
          icon={AlertCircle}
          title="We couldn't find this ticket"
          description={
            query.isError
              ? "The connection dropped and there's no saved copy of this ticket on this device."
              : 'This ticket does not exist, or it belongs to another account.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {query.isError && (
                <Button onClick={() => query.refetch()} disabled={query.isFetching}>
                  {query.isFetching ? 'Retrying…' : 'Try again'}
                </Button>
              )}
              <Button variant="outline" onClick={() => router.push(paths.tickets())}>
                <ArrowLeft className="h-4 w-4" /> Back to my tickets
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  const meta = ticketStatusMeta(view.status)
  const checkedIn = view.status === 'CHECKED_IN'
  const isVoid = meta.void

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* ---------- Top bar (never printed) ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" size="sm" onClick={() => router.push(paths.tickets())}>
          <ArrowLeft className="h-4 w-4" /> My tickets
        </Button>
        <div className="flex items-center gap-2">
          {usingCache && (
            <Badge variant="outline" className="gap-1.5 border-chart-5/60 text-foreground">
              <WifiOff className="h-3.5 w-3.5" /> Offline copy
            </Badge>
          )}
          <span className="font-mono text-xs text-muted-foreground">{view.orderNumber}</span>
        </div>
      </div>

      {/* ---------- The ticket ---------- */}
      <Card
        className={cn(
          'print-ticket relative mx-auto mt-4 w-full max-w-md gap-0 overflow-hidden p-0 shadow-xl shadow-primary/5',
          isVoid && 'shadow-none',
        )}
      >
        {/* Status rail: the ticket's own state, not a separate alert above it */}
        <div
          className={cn(
            'h-1.5 w-full',
            checkedIn ? 'bg-primary' : isVoid ? 'bg-destructive' : 'bg-gradient-to-r from-primary to-chart-2',
          )}
          aria-hidden="true"
        />

        {/* Banner strip */}
        <div className="relative h-32 w-full overflow-hidden bg-muted">
          {view.eventBanner ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={view.eventBanner}
              alt=""
              className={cn('h-full w-full object-cover', isVoid && 'grayscale')}
              decoding="async"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 via-primary/10 to-accent text-5xl">
              <span aria-hidden="true">{categoryEmoji(view.category)}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <Badge className="absolute left-3 top-3 bg-background/90 text-foreground backdrop-blur hover:bg-background/90">
            <span aria-hidden="true">{categoryEmoji(view.category)}</span> {categoryLabel(view.category)}
          </Badge>
        </div>

        {/* Event identity — the title is the page's h1, it was previously an h2
            under a muted "E-Ticket" heading. */}
        <div className="space-y-2 p-6 pb-5">
          <h1 className="text-pretty text-xl font-bold leading-snug tracking-tight">{view.eventTitle}</h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span className="tabular-nums">
              {formatEventDate(view.startDate)} · {formatTime(view.startTime)}
            </span>
          </p>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {view.venue}, {view.city}
            </span>
          </p>
        </div>

        {/* Perforation */}
        <div className="ticket-notch border-t-2 border-dashed" />

        {/* QR + credentials */}
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          {/* Always a white plate, even in dark mode — a QR inverted by the
              theme will not scan. */}
          <div className="relative rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5">
            {qrDataUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={qrDataUrl}
                alt={`QR code for ticket ${view.ticketCode}`}
                className={cn('h-56 w-56 object-contain', isVoid && 'opacity-25')}
              />
            ) : (
              <Skeleton className="h-56 w-56 rounded-lg" />
            )}

            {/* A void ticket must not present a clean, scannable code */}
            {isVoid && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="rotate-[-8deg] rounded-md border-2 border-destructive px-3 py-1 text-sm font-bold uppercase tracking-widest text-destructive">
                  {meta.label}
                </span>
              </div>
            )}
            {checkedIn && (
              <div className="absolute inset-x-0 bottom-2 flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Scanned
                </span>
              </div>
            )}
          </div>

          <p className="select-all font-mono text-xl font-bold tracking-[0.18em] tabular-nums">
            {view.ticketCode}
          </p>

          <dl className="w-full space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Attendee</dt>
              <dd className="truncate font-medium">{view.attendeeName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Ticket</dt>
              <dd className="font-medium">{view.ticketTypeName}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <TicketStatusBadge status={view.status} />
              </dd>
            </div>
          </dl>

          {checkedIn ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Entry recorded
              {view.checkedInAt ? ` at ${formatDateTimeTime(view.checkedInAt)}` : ''}
            </p>
          ) : isVoid ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <TicketX className="h-3.5 w-3.5 shrink-0" /> This ticket cannot be used for entry
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <QrCode className="h-3.5 w-3.5 shrink-0" /> Present this QR at the entrance
            </p>
          )}
        </div>
      </Card>

      {/* Announce a gate scan that arrives while the screen is open */}
      <p className="sr-only" role="status" aria-live="polite">
        {checkedIn
          ? 'This ticket has been checked in. Entry recorded.'
          : isVoid
            ? `This ticket is ${meta.label.toLowerCase()} and cannot be used for entry.`
            : 'Ticket is valid.'}
      </p>

      {/* ---------- Actions ---------- */}
      <div className="mx-auto mt-6 w-full max-w-md print:hidden">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="flex-1 transition-transform active:scale-[0.99] motion-reduce:transform-none"
            onClick={saveImage}
            disabled={!qrDataUrl || saving}
          >
            <Download className="h-4 w-4" /> {saving ? 'Preparing…' : 'Save ticket image'}
          </Button>
          <Button variant="outline" className="flex-1" onClick={copyCode}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy code'}
          </Button>
        </div>
        <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print this ticket
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Saved on this device — your QR works at the gate even without a signal.
        </p>
      </div>
    </div>
  )
}
