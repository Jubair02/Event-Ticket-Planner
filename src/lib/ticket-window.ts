import type { TicketTypeDTO } from '@/lib/types'

export interface TicketWindow {
  available: number
  soldOut: boolean
  closed: boolean
  notOpen: boolean
  /** Highest quantity a single order may take right now. */
  max: number
  purchasable: boolean
}

/**
 * Buyability of a ticket type at this moment.
 *
 * Shared by the event detail and checkout views so the two screens can never
 * disagree about what is on sale — they previously held identical copies of
 * this logic.
 */
export function ticketWindow(t: TicketTypeDTO): TicketWindow {
  const now = Date.now()
  const available = Math.max(0, t.totalQuantity - t.soldQuantity)
  const closed = t.salesEnd ? new Date(t.salesEnd).getTime() < now : false
  const notOpen = t.salesStart ? new Date(t.salesStart).getTime() > now : false
  return {
    available,
    soldOut: available <= 0,
    closed,
    notOpen,
    max: Math.min(t.maxPerOrder, available),
    purchasable: available > 0 && !closed && !notOpen,
  }
}
