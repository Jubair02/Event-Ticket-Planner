import type { CheckoutItem } from '@/lib/types'

/**
 * Every URL the app can navigate to, in one place.
 *
 * The app used to be a single route whose current screen lived in a zustand
 * `View` union, with a bridge translating that union to and from the address
 * bar. The routes are real now, so this module is just a typed path builder:
 * one function per destination, so a rename is a compiler error rather than a
 * broken string somewhere in a component.
 */

/** `[{ ticketTypeId: 'tt1', quantity: 2 }]` <-> `tt1:2,tt2:1` */
export function encodeItems(items: CheckoutItem[] | undefined): string | null {
  if (!items || items.length === 0) return null
  return items.map((i) => `${i.ticketTypeId}:${i.quantity}`).join(',')
}

export function decodeItems(raw: string | null | undefined): CheckoutItem[] | undefined {
  if (!raw) return undefined
  const items: CheckoutItem[] = []
  for (const part of raw.split(',')) {
    const [ticketTypeId, rawQty] = part.split(':')
    const quantity = Number(rawQty)
    if (!ticketTypeId || !Number.isInteger(quantity) || quantity < 1) continue
    items.push({ ticketTypeId, quantity })
  }
  return items.length > 0 ? items : undefined
}

/** Appends a query string, skipping empty and default values. */
function withQuery(path: string, query: Record<string, string | undefined | null>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value)
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

export const paths = {
  home: () => '/',
  events: () => '/events',

  /**
   * Prefers the slug and falls back to the id: call sites that only hold an id
   * still produce a working URL, and `/events/[slug]` redirects an id to its
   * canonical slug.
   */
  event: (event: { slug?: string | null; id: string } | string) =>
    typeof event === 'string'
      ? `/events/${encodeURIComponent(event)}`
      : `/events/${encodeURIComponent(event.slug || event.id)}`,

  /** Carries the ticket selection made on the event page, so a refresh keeps it. */
  checkout: (eventId: string, items?: CheckoutItem[]) =>
    withQuery(`/checkout/${eventId}`, { t: encodeItems(items) }),

  order: (orderId: string) => `/order/${orderId}`,
  orderSuccess: (orderId: string) => `/order/${orderId}/success`,

  tickets: (tab?: 'upcoming' | 'past' | 'cancelled') =>
    withQuery('/tickets', { tab: tab && tab !== 'upcoming' ? tab : undefined }),
  ticket: (ticketId: string) => `/tickets/${ticketId}`,

  organizer: () => '/organizer',
  organizerEvents: (status?: string) =>
    withQuery('/organizer/events', { status: status && status !== 'ALL' ? status : undefined }),
  organizerEvent: (eventId: string) => `/organizer/events/${eventId}`,
  organizerOrders: (query?: { status?: string; q?: string; eventId?: string }) =>
    withQuery('/organizer/orders', {
      status: query?.status && query.status !== 'ALL' ? query.status : undefined,
      q: query?.q,
      eventId: query?.eventId && query.eventId !== 'ALL' ? query.eventId : undefined,
    }),
  organizerAnalytics: () => '/organizer/analytics',
  organizerPayouts: () => '/organizer/payouts',
  organizerStaff: () => '/organizer/staff',

  admin: () => '/admin',
  adminEvents: (query?: { status?: string; q?: string }) =>
    withQuery('/admin/events', {
      status: query?.status && query.status !== 'ALL' ? query.status : undefined,
      q: query?.q,
    }),
  adminOrganizers: (query?: { status?: string; q?: string }) =>
    withQuery('/admin/organizers', {
      status: query?.status && query.status !== 'ALL' ? query.status : undefined,
      q: query?.q,
    }),
  adminUsers: (query?: { role?: string; q?: string }) =>
    withQuery('/admin/users', {
      role: query?.role && query.role !== 'ALL' ? query.role : undefined,
      q: query?.q,
    }),
  adminPayments: (query?: { status?: string; q?: string }) =>
    withQuery('/admin/payments', {
      status: query?.status && query.status !== 'ALL' ? query.status : undefined,
      q: query?.q,
    }),
  adminRefunds: (query?: { status?: string; q?: string }) =>
    withQuery('/admin/refunds', {
      status: query?.status && query.status !== 'ALL' ? query.status : undefined,
      q: query?.q,
    }),
  adminPayouts: (query?: { status?: string; q?: string }) =>
    withQuery('/admin/payouts', {
      status: query?.status && query.status !== 'ALL' ? query.status : undefined,
      q: query?.q,
    }),
  adminAudit: (source?: string) =>
    withQuery('/admin/audit', { source: source && source !== 'ALL' ? source : undefined }),

  staff: () => '/staff',
  /** The scanner itself; the event being scanned is URL state, so refresh keeps it. */
  staffCheckIn: (eventId?: string) => withQuery('/staff/check-in', { event: eventId }),
} as const

/** Where each role lands after signing in. */
export function landingPathForRole(role: string): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return paths.admin()
    case 'ORGANIZER':
      return paths.organizer()
    case 'EVENT_STAFF':
      return paths.staff()
    default:
      return paths.home()
  }
}

/**
 * Absolute site origin, for canonical URLs, Open Graph and the sitemap.
 * Set NEXT_PUBLIC_SITE_URL in production; Vercel's own domain is the fallback.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  if (explicit) return explicit
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (vercel) return `https://${vercel.replace(/\/$/, '')}`
  return 'http://localhost:3000'
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith('/') ? path : `/${path}`}`
}
