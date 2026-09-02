'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Copy,
  Info,
  Loader2,
  MapPin,
  Printer,
  QrCode,
} from 'lucide-react'
import { apiGet } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { categoryEmoji, categoryLabel, formatDateTimeTime, formatEventDate, formatTime } from '@/lib/format'
import type { OrderDTO, TicketDTO } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/empty-state'

interface FoundTicket {
  order: OrderDTO
  ticket: TicketDTO
  event: NonNullable<OrderDTO['event']>
}

function statusBadge(status: TicketDTO['status']): {
  variant: 'default' | 'outline' | 'destructive'
  label: string
  className?: string
} {
  if (status === 'ACTIVE') return { variant: 'outline', label: 'Valid', className: 'border-primary/50 text-primary' }
  if (status === 'CHECKED_IN') return { variant: 'default', label: 'Checked In' }
  if (status === 'CANCELLED') return { variant: 'destructive', label: 'Cancelled' }
  return { variant: 'destructive', label: 'Invalid' }
}

function findTicket(orders: OrderDTO[], ticketId: string): FoundTicket | null {
  for (const order of orders) {
    const ticket = order.tickets?.find((t) => t.id === ticketId)
    if (ticket && order.event) return { order, ticket, event: order.event }
  }
  return null
}

export function TicketDetail({ ticketId }: { ticketId: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['orders', 'mine'],
    queryFn: () => apiGet<{ orders: OrderDTO[] }>('/api/orders/mine'),
  })

  // Locate the ticket across the user's orders (plain computation — React Compiler memoizes)
  const found = query.data ? findTicket(query.data.orders, ticketId) : null

  // Client-side QR generation from the ticket's qrToken
  useEffect(() => {
    if (!found) return
    let cancelled = false
    QRCode.toDataURL(found.ticket.qrToken, {
      width: 420,
      margin: 1,
      color: { dark: '#0B7A4B', light: '#FFFFFF' },
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
  }, [found])

  function handleCopy() {
    if (!found) return
    navigator.clipboard
      .writeText(found.ticket.qrToken)
      .then(() => toast.success('QR token copied — demo helper for staff scanner'))
      .catch(() => toast.error('Could not copy the QR token'))
  }

  if (query.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Loading your ticket…</p>
      </div>
    )
  }

  if (query.isError || !found) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <EmptyState
          icon={AlertCircle}
          title="Ticket not found"
          description="This ticket does not exist or does not belong to your account."
          action={
            <Button onClick={() => navigate({ name: 'my-tickets' })}>
              <ArrowLeft className="h-4 w-4" /> Back to My Tickets
            </Button>
          }
        />
      </div>
    )
  }

  const { ticket, event } = found
  const badge = statusBadge(ticket.status)

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="print:hidden flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'my-tickets' })}>
          <ArrowLeft className="h-4 w-4" /> My Tickets
        </Button>
        <h1 className="text-sm font-medium text-muted-foreground">E-Ticket</h1>
      </div>

      {ticket.status === 'CHECKED_IN' && (
        <Alert className="print:hidden mx-auto mt-4 max-w-md border-primary/40">
          <Info className="h-4 w-4" />
          <AlertTitle>Already checked in</AlertTitle>
          <AlertDescription>
            This ticket was scanned at{' '}
            {ticket.checkedInAt ? formatDateTimeTime(ticket.checkedInAt) : 'an earlier time'}. Entry has been recorded.
          </AlertDescription>
        </Alert>
      )}

      {/* Printable ticket */}
      <Card className="print-ticket relative mx-auto mt-4 w-full max-w-md gap-0 bg-card p-0 shadow-lg">
        {/* Banner strip */}
        <div className="relative h-32 w-full overflow-hidden rounded-t-xl bg-muted">
          {event.banner ? (
             
            <img src={event.banner} alt={`${event.title} banner`} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 via-primary/10 to-accent text-5xl">
              {categoryEmoji(event.category)}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <Badge className="absolute left-3 top-3 bg-background/90 text-foreground backdrop-blur hover:bg-background/90">
            {categoryEmoji(event.category)} {categoryLabel(event.category)}
          </Badge>
        </div>

        {/* Event info */}
        <div className="space-y-1.5 p-6 pb-5">
          <h2 className="text-lg font-bold leading-snug">{event.title}</h2>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4 shrink-0" />
            {formatEventDate(event.startDate)} · {formatTime(event.startTime)}
          </p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" />
            {event.venue}, {event.city}
          </p>
        </div>

        {/* Perforated divider */}
        <div className="ticket-notch border-t-2 border-dashed" />

        {/* QR section */}
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">E-Ticket</p>
          {qrDataUrl ? (
             
            <img
              src={qrDataUrl}
              alt={`QR code for ticket ${ticket.ticketCode}`}
              className="h-56 w-56 object-contain"
            />
          ) : (
            <Skeleton className="h-56 w-56 rounded-lg" />
          )}
          <p className="font-mono text-lg font-bold tracking-widest">{ticket.ticketCode}</p>
          <p className="text-sm text-muted-foreground">
            {ticket.attendeeName} · {ticket.ticketType?.name ?? 'Ticket'}
          </p>
          <Badge variant={badge.variant} className={badge.className}>
            {badge.label}
          </Badge>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <QrCode className="h-3.5 w-3.5" /> Present this QR at the entrance
          </p>
        </div>
      </Card>

      {/* Actions */}
      <div className="print:hidden mx-auto mt-6 flex w-full max-w-md flex-col gap-2 sm:flex-row">
        <Button className="flex-1" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print / Download
        </Button>
        <Button variant="outline" className="flex-1" onClick={handleCopy}>
          <Copy className="h-4 w-4" /> Copy QR Token
        </Button>
      </div>
    </div>
  )
}
