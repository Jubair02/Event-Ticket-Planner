export const CITIES = ['Dhaka', 'Chattogram', 'Sylhet', 'Khulna', 'Rajshahi', "Cox's Bazar"] as const

export const CATEGORIES = [
  'CONCERT',
  'TECH',
  'WORKSHOP',
  'SPORTS',
  'CULTURAL',
  'BUSINESS',
  'GAMING',
  'FOOD',
] as const

export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<string, { label: string; emoji: string }> = {
  CONCERT: { label: 'Concert', emoji: '🎵' },
  TECH: { label: 'Tech Event', emoji: '💻' },
  WORKSHOP: { label: 'Workshop', emoji: '🎓' },
  SPORTS: { label: 'Sports', emoji: '🏏' },
  CULTURAL: { label: 'Cultural', emoji: '🎭' },
  BUSINESS: { label: 'Business', emoji: '💼' },
  GAMING: { label: 'Gaming', emoji: '🎮' },
  FOOD: { label: 'Food Festival', emoji: '🍔' },
}

export const EVENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  PUBLISHED: 'Published',
  ONGOING: 'Ongoing',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  PAID: 'Paid',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
}

export const PAYMENT_METHODS = [
  { value: 'bKash', label: 'bKash', color: '#E2136E', desc: 'Pay with your bKash mobile wallet' },
  { value: 'Nagad', label: 'Nagad', color: '#F6921E', desc: 'Pay with your Nagad mobile wallet' },
  { value: 'CARD', label: 'Card', color: '#0E7A5F', desc: 'Visa / Mastercard / Amex' },
] as const

export const PLATFORM_FEE_RATE = 0.03
export const PLATFORM_NAME = 'TicketBD'
