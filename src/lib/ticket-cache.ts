import type { OrderDTO, TicketDTO } from '@/lib/types'

/**
 * A self-contained copy of one e-ticket, kept in localStorage.
 *
 * Why this exists: the e-ticket is the one screen that has to work in the worst
 * network conditions the user will ever meet — a basement venue, a field
 * outside the city, or a few thousand phones on one cell tower at the gate.
 * The view previously refetched `/api/orders/mine` on every mount, so a failed
 * request meant the attendee simply had no ticket.
 *
 * Only what the ticket renders is stored. The QR itself is not cached: it is
 * regenerated locally from `qrToken`, which works offline and keeps each entry
 * small.
 */
export interface TicketSnapshot {
  savedAt: number
  orderNumber: string
  ticket: {
    id: string
    ticketCode: string
    qrToken: string
    attendeeName: string
    status: TicketDTO['status']
    checkedInAt: string | null
    ticketTypeName: string | null
  }
  event: {
    title: string
    banner: string | null
    venue: string
    city: string
    startDate: string
    startTime: string
    category: string
  }
}

const KEY_PREFIX = 'ticketbd:ticket:'
/** Long enough to cover any realistic gap between purchase and event day. */
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 120

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    // Private mode / blocked site data.
    return null
  }
}

export function buildTicketSnapshot(
  order: OrderDTO,
  ticket: TicketDTO,
  event: NonNullable<OrderDTO['event']>,
): Omit<TicketSnapshot, 'savedAt'> {
  return {
    orderNumber: order.orderNumber,
    ticket: {
      id: ticket.id,
      ticketCode: ticket.ticketCode,
      qrToken: ticket.qrToken,
      attendeeName: ticket.attendeeName,
      status: ticket.status,
      checkedInAt: ticket.checkedInAt,
      ticketTypeName: ticket.ticketType?.name ?? null,
    },
    event: {
      title: event.title,
      banner: event.banner,
      venue: event.venue,
      city: event.city,
      startDate: event.startDate,
      startTime: event.startTime,
      category: event.category,
    },
  }
}

/** Best-effort persist. Storage being unavailable or full is never fatal. */
export function saveTicketSnapshot(ticketId: string, snapshot: Omit<TicketSnapshot, 'savedAt'>): void {
  const store = storage()
  if (!store) return
  try {
    const payload: TicketSnapshot = { ...snapshot, savedAt: Date.now() }
    store.setItem(KEY_PREFIX + ticketId, JSON.stringify(payload))
  } catch {
    // Quota exceeded, or writes are blocked — the live fetch still works.
  }
}

/** Returns the cached ticket, or null when absent, unreadable, or stale. */
export function readTicketSnapshot(ticketId: string): TicketSnapshot | null {
  const store = storage()
  if (!store) return null
  const key = KEY_PREFIX + ticketId
  try {
    const raw = store.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as TicketSnapshot
    if (
      !parsed ||
      typeof parsed.savedAt !== 'number' ||
      !parsed.ticket?.qrToken ||
      !parsed.ticket?.ticketCode ||
      !parsed.event?.title
    ) {
      store.removeItem(key)
      return null
    }
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      store.removeItem(key)
      return null
    }
    return parsed
  } catch {
    try {
      store.removeItem(key)
    } catch {
      /* nothing further to do */
    }
    return null
  }
}
