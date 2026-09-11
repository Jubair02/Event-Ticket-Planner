// ===== Shared DTO types (JSON over the wire — dates are ISO strings) =====
//
// Money crosses the wire as an integer number of paisa and every such field is
// named with a `Minor` suffix. Never a float, never taka. `@/lib/money` has the
// reasoning and the only conversions; `formatMinor` is what renders one.

export type Role = 'SUPER_ADMIN' | 'ORGANIZER' | 'CUSTOMER' | 'EVENT_STAFF'

export interface SafeUser {
  id: string
  name: string
  email: string
  phone: string | null
  role: Role
  status: string
  createdAt: string
  organizer?: {
    id: string
    organizationName: string
    status: 'PENDING' | 'APPROVED' | 'REJECTED'
  }
}

export interface StaffEventRef {
  id: string
  title: string
  status: string
  startDate: string
}

export interface TicketTypeDTO {
  id: string
  eventId: string
  name: string
  description: string | null
  /** Unit price in paisa. */
  priceMinor: number
  totalQuantity: number
  soldQuantity: number
  maxPerOrder: number
  salesStart: string | null
  salesEnd: string | null
  createdAt: string
}

export interface OrganizerInfo {
  id: string
  organizationName: string
  status: string
  user?: { name: string | null }
  userId?: string
}

export interface EventListItem {
  id: string
  /** URL slug. Null only for rows created before slugs existed. */
  slug: string | null
  title: string
  description: string
  category: string
  banner: string | null
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  venue: string
  address: string
  city: string
  mapUrl: string | null
  status: string
  featured: boolean
  createdAt: string
  ticketTypes: TicketTypeDTO[]
  organizer: OrganizerInfo
}

export type EventDetail = EventListItem

export interface TicketDTO {
  id: string
  ticketCode: string
  qrToken: string
  attendeeName: string
  status: 'ACTIVE' | 'CHECKED_IN' | 'CANCELLED' | 'INVALID'
  checkedInAt: string | null
  createdAt: string
  ticketType?: { id: string; name: string; priceMinor: number }
}

export interface PaymentDTO {
  id: string
  /** Captured from the customer, in paisa. */
  amountMinor: number
  /** What the gateway keeps, in paisa. Borne by the organizer, not the buyer. */
  gatewayFeeMinor: number
  currency: string
  provider: string
  method: string | null
  transactionId: string | null
  status: string
  paidAt: string | null
}

export interface OrderDTO {
  id: string
  orderNumber: string
  eventId: string
  /** Paisa. `totalMinor = subtotalMinor - discountMinor + platformFeeMinor`. */
  subtotalMinor: number
  discountMinor: number
  platformFeeMinor: number
  totalMinor: number
  currency: string
  paymentStatus: PaymentStatus
  status: string
  /** Attendee captured at checkout; null on orders created before this existed. */
  attendeeName?: string | null
  attendeeEmail?: string | null
  attendeePhone?: string | null
  createdAt: string
  event?: {
    id: string
    slug?: string | null
    title: string
    banner: string | null
    venue: string
    city: string
    startDate: string
    endDate: string
    startTime: string
    endTime: string
    category: string
    status: string
  }
  tickets?: TicketDTO[]
  payments?: PaymentDTO[]
  user?: { id: string; name: string; email: string }
}

export type OrderWithDetails = OrderDTO

export interface OrganizerStats {
  totalEvents: number
  activeEvents: number
  ticketsSold: number
  /** Gross paid-order value in paisa, before refunds, fees and payouts. */
  revenueMinor: number
  checkIns: number
  /** Events in PENDING_APPROVAL. Returned by the API; drives the overview's next steps. */
  pendingApprovals?: number
}

export interface EventAnalytics {
  event: EventListItem
  totalTickets: number
  sold: number
  available: number
  /** Gross paid-order value in paisa. */
  revenueMinor: number
  checkIns: number
  notArrived: number
  recentOrders: Array<{
    id: string
    orderNumber: string
    totalMinor: number
    paymentStatus: string
    createdAt: string
    user: { name: string }
    _count: { tickets: number }
  }>
  ticketTypeBreakdown: Array<{
    id: string
    name: string
    priceMinor: number
    totalQuantity: number
    soldQuantity: number
    revenueMinor: number
  }>
}

export interface AdminStats {
  totalUsers: number
  totalCustomers: number
  totalOrganizers: number
  totalStaff: number
  totalEvents: number
  publishedEvents: number
  pendingEvents: number
  pendingOrganizers: number
  totalOrders: number
  paidOrders: number
  /** Gross paid-order value in paisa. */
  totalRevenueMinor: number
  totalTicketsSold: number
  totalCheckIns: number
  /**
   * Everything waiting on an operator, in one payload.
   *
   * The overview used to know only about pending organizers and events, so an
   * admin had to open the refund and payout queues to discover whether either
   * needed them. A command centre that hides half the work is not one.
   */
  pendingRefunds: number
  failedRefunds: number
  pendingPayouts: number
  /** Ledger account balances in paisa — the platform's actual position. */
  ledger: {
    gatewayClearingMinor: number
    cashMinor: number
    platformRevenueMinor: number
    organizerPayableMinor: number
  }
}

export interface AdminUserRow {
  id: string
  name: string
  email: string
  phone: string | null
  role: Role
  status: string
  createdAt: string
  organizer?: { id: string; organizationName: string; status: string } | null
}

export interface AdminOrganizerRow {
  id: string
  organizationName: string
  phone: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
  user: { id: string; name: string; email: string; phone: string | null; status: string }
  eventCount: number
}

export interface StaffAssignmentRow {
  id: string
  checkedInCount: number
  totalTickets: number
  event: {
    id: string
    title: string
    venue: string
    city: string
    banner: string | null
    startDate: string
    startTime: string
    status: string
    ticketTypes: Array<{ totalQuantity: number; soldQuantity: number }>
  }
}

export interface ValidateResult {
  result: 'VALID' | 'ALREADY_CHECKED_IN' | 'CANCELLED' | 'INVALID' | 'NOT_ASSIGNED'
  ticket?: {
    id: string
    ticketCode: string
    attendeeName: string
    status: string
    checkedInAt: string | null
    ticketType: { name: string; priceMinor: number }
    event: { id: string; title: string; startDate: string; startTime: string; venue: string }
    user: { name: string }
    order: { orderNumber: string }
  }
  error?: string
}

export interface CheckInRow {
  id: string
  ticketCode: string
  attendeeName: string
  checkedInAt: string
  ticketType: { name: string }
  user: { name: string }
}

/**
 * A ticket selection handed from the event page to checkout. Travels in the
 * `/checkout/[eventId]?t=…` query string, so a refresh keeps the choice.
 */
export interface CheckoutItem {
  ticketTypeId: string
  quantity: number
}

// ===== Financial status values =====
//
// The database stores these as text (matching the convention used for every
// other status in this schema). These unions are what code should narrow to,
// and what a write path should validate against.

export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'

export type RefundStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'

export type PayoutStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED'

export type SettlementStatus = 'DRAFT' | 'OPEN' | 'APPROVED' | 'PAID' | 'CANCELLED'

export type PayoutMethodType = 'BANK_TRANSFER' | 'BKASH' | 'NAGAD'

export type PayoutMethodStatus = 'UNVERIFIED' | 'VERIFIED' | 'REJECTED' | 'DISABLED'
