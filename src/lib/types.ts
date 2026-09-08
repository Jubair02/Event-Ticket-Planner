// ===== Shared DTO types (JSON over the wire — dates are ISO strings) =====

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
  price: number
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
  ticketType?: { id: string; name: string; price: number }
}

export interface PaymentDTO {
  id: string
  amount: number
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
  subtotal: number
  platformFee: number
  totalAmount: number
  paymentStatus: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED'
  status: string
  /** Attendee captured at checkout; null on orders created before this existed. */
  attendeeName?: string | null
  attendeeEmail?: string | null
  attendeePhone?: string | null
  createdAt: string
  event?: {
    id: string
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
  revenue: number
  checkIns: number
}

export interface EventAnalytics {
  event: EventListItem
  totalTickets: number
  sold: number
  available: number
  revenue: number
  checkIns: number
  notArrived: number
  recentOrders: Array<{
    id: string
    orderNumber: string
    totalAmount: number
    paymentStatus: string
    createdAt: string
    user: { name: string }
    _count: { tickets: number }
  }>
  ticketTypeBreakdown: Array<{
    id: string
    name: string
    price: number
    totalQuantity: number
    soldQuantity: number
    revenue: number
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
  totalRevenue: number
  totalTicketsSold: number
  totalCheckIns: number
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
    ticketType: { name: string; price: number }
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
