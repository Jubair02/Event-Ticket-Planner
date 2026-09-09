'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ban, CalendarDays, History, MapPin, QrCode, Ticket } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { useRouter } from 'next/navigation'
import { paths } from '@/lib/routes'
import { categoryEmoji, formatEventDate, formatTime } from '@/lib/format'
import type { OrderDTO, TicketDTO } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/app/empty-state'
import { TicketStatusBadge } from '@/components/customer/ticket-status-badge'

type TabKey = 'upcoming' | 'past' | 'cancelled'

interface TicketRow {
  order: OrderDTO
  ticket: TicketDTO
  event: NonNullable<OrderDTO['event']>
}

function isCancelledRow(r: TicketRow): boolean {
  return r.ticket.status === 'CANCELLED' || r.ticket.status === 'INVALID' || r.event.status === 'CANCELLED'
}

function TicketRowCard({ row }: { row: TicketRow }) {
  const router = useRouter()
  const { ticket, event } = row

  return (
    <Card className="p-4">
      <div className="flex gap-4">
        <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-muted">
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
            onClick={() => router.push(paths.event(event.id))}
            className="line-clamp-1 text-left font-semibold hover:text-primary"
          >
            {event.title}
          </button>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {formatEventDate(event.startDate)} · {formatTime(event.startTime)}
          </p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-1">
              {event.venue}, {event.city}
            </span>
          </p>
        </div>
      </div>
      <Separator className="my-3" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="outline">{ticket.ticketType?.name ?? 'Ticket'}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{ticket.ticketCode}</span>
          <span className="text-xs text-muted-foreground">· {ticket.attendeeName}</span>
          <TicketStatusBadge status={ticket.status} />
        </div>
        <Button size="sm" onClick={() => router.push(paths.ticket(ticket.id))}>
          View Ticket
        </Button>
      </div>
    </Card>
  )
}

export function MyTickets({ initialTab }: { initialTab?: 'upcoming' | 'past' | 'cancelled' }) {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'upcoming')

  const query = useQuery({
    queryKey: ['orders', 'mine'],
    queryFn: () => apiGet<{ orders: OrderDTO[] }>('/api/orders/mine'),
  })

  const groups = useMemo(() => {
    const now = Date.now()
    const rows: TicketRow[] = []
    for (const order of query.data?.orders ?? []) {
      if (!order.event) continue
      for (const ticket of order.tickets ?? []) rows.push({ order, ticket, event: order.event })
    }
    const cancelled = rows.filter(isCancelledRow)
    // An event is over when it *ends*, not when it starts. Splitting on
    // startDate filed a multi-day festival under "Past" from its second day
    // onward — while the customer was still attending it and still needed the
    // QR code to get back in. endDate falls back to startDate for the older
    // rows that predate it.
    const endsAt = (r: TicketRow) =>
      new Date(r.event.endDate ?? r.event.startDate).getTime()
    const upcoming = rows
      .filter(
        (r) =>
          !isCancelledRow(r) &&
          r.order.paymentStatus === 'PAID' &&
          (r.ticket.status === 'ACTIVE' || r.ticket.status === 'CHECKED_IN') &&
          endsAt(r) >= now,
      )
      .sort((a, b) => new Date(a.event.startDate).getTime() - new Date(b.event.startDate).getTime())
    const past = rows
      .filter(
        (r) =>
          !isCancelledRow(r) &&
          r.order.paymentStatus === 'PAID' &&
          endsAt(r) < now,
      )
      .sort((a, b) => new Date(b.event.startDate).getTime() - new Date(a.event.startDate).getTime())
    const cancelledSorted = [...cancelled].sort(
      (a, b) => new Date(b.event.startDate).getTime() - new Date(a.event.startDate).getTime(),
    )
    return { upcoming, past, cancelled: cancelledSorted }
  }, [query.data])

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-full max-w-sm rounded-lg" />
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-4">
            <div className="flex gap-4">
              <Skeleton className="h-20 w-28 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-bold">My Tickets</h1>
      <p className="mt-1 text-sm text-muted-foreground">All your tickets in one place — show the QR at the venue.</p>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="mt-6">
        <TabsList className="w-full max-w-md sm:w-auto">
          <TabsTrigger value="upcoming">Upcoming ({groups.upcoming.length})</TabsTrigger>
          <TabsTrigger value="past">Past ({groups.past.length})</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled ({groups.cancelled.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="mt-4 space-y-4">
          <Card className="border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <QrCode className="h-5 w-5" />
              </span>
              <div>
                <p className="font-medium">Show QR at the venue — no printout needed.</p>
                <p className="text-sm text-muted-foreground">
                  Open any ticket below and present the QR code at the entrance for scanning.
                </p>
              </div>
            </div>
          </Card>
          {groups.upcoming.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title="No upcoming tickets"
              description="You haven't booked any upcoming events yet. Browse events and grab your next ticket!"
              action={<Button onClick={() => router.push(paths.events())}>Browse Events</Button>}
            />
          ) : (
            groups.upcoming.map((r) => <TicketRowCard key={r.ticket.id} row={r} />)
          )}
        </TabsContent>

        <TabsContent value="past" className="mt-4 space-y-4">
          {groups.past.length === 0 ? (
            <EmptyState
              icon={History}
              title="No past tickets"
              description="Tickets from events you attended will appear here."
            />
          ) : (
            groups.past.map((r) => <TicketRowCard key={r.ticket.id} row={r} />)
          )}
        </TabsContent>

        <TabsContent value="cancelled" className="mt-4 space-y-4">
          {groups.cancelled.length === 0 ? (
            <EmptyState
              icon={Ban}
              title="No cancelled tickets"
              description="Great — all of your tickets are still valid."
            />
          ) : (
            groups.cancelled.map((r) => <TicketRowCard key={r.ticket.id} row={r} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
