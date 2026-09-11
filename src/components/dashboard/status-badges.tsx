'use client'

import { Badge } from '@/components/ui/badge'
import { EVENT_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/lib/constants'
import { REFUND_STATUS_LABELS, type RefundStatus } from '@/lib/refunds'
import { PAYOUT_STATUS_LABELS, type PayoutStatus } from '@/lib/settlement'

/**
 * Event lifecycle badge, shared by the organizer and admin dashboards.
 * Lives in the dashboard kit so the admin side no longer has to import it from
 * an organizer component.
 */
export function EventStatusBadge({ status }: { status: string }) {
  const label = EVENT_STATUS_LABELS[status] ?? status
  switch (status) {
    case 'PUBLISHED':
      return <Badge>{label}</Badge>
    case 'ONGOING':
      return (
        <Badge className="gap-1.5">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
          </span>
          {label}
        </Badge>
      )
    case 'PENDING_APPROVAL':
      // chart-5 is the theme's "needs attention" tone (the admin review queue
      // uses it too), replacing a hardcoded amber that bypassed the tokens.
      return (
        <Badge variant="outline" className="border-chart-5/60 text-foreground">
          {label}
        </Badge>
      )
    case 'DRAFT':
    case 'COMPLETED':
      return <Badge variant="secondary">{label}</Badge>
    case 'CANCELLED':
    case 'REJECTED':
    case 'SUSPENDED':
      return <Badge variant="destructive">{label}</Badge>
    default:
      return <Badge variant="outline">{label}</Badge>
  }
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const label = PAYMENT_STATUS_LABELS[status] ?? status
  switch (status) {
    case 'PAID':
      return <Badge>{label}</Badge>
    case 'FAILED':
      return <Badge variant="destructive">{label}</Badge>
    case 'PENDING':
    case 'PROCESSING':
      // Money still in flight, and the only payment state an operator may need
      // to chase. Both used to be indistinguishable from a dead order —
      // `PENDING` rendered exactly like `CANCELLED` — so they now carry the
      // theme's dedicated caution token instead.
      return (
        <Badge variant="outline" className="border-warning/60 bg-warning/10 text-foreground">
          {label}
        </Badge>
      )
    case 'CANCELLED':
      return (
        <Badge variant="outline" className="text-muted-foreground">
          {label}
        </Badge>
      )
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
    default:
      return <Badge variant="secondary">{label}</Badge>
  }
}

/**
 * Refund lifecycle badge.
 *
 * FAILED is deliberately destructive while REJECTED is not: a rejection is a
 * decision someone made, a failure is the gateway breaking and needing a human.
 * Those should not look the same in a queue.
 */
export function RefundStatusBadge({ status }: { status: string }) {
  const label = REFUND_STATUS_LABELS[status as RefundStatus] ?? status
  switch (status) {
    case 'COMPLETED':
      return <Badge>{label}</Badge>
    case 'FAILED':
      return <Badge variant="destructive">{label}</Badge>
    case 'REQUESTED':
    case 'APPROVED':
      return (
        <Badge variant="outline" className="border-chart-5/60 text-foreground">
          {label}
        </Badge>
      )
    case 'PROCESSING':
      return <Badge variant="secondary">{label}</Badge>
    default:
      return <Badge variant="outline">{label}</Badge>
  }
}

/** Payout lifecycle badge: REQUESTED -> APPROVED -> PAID, or REJECTED. */
export function PayoutStatusBadge({ status }: { status: string }) {
  const label = PAYOUT_STATUS_LABELS[status as PayoutStatus] ?? status
  switch (status) {
    case 'PAID':
      return <Badge>{label}</Badge>
    case 'REQUESTED':
    case 'APPROVED':
      return (
        <Badge variant="outline" className="border-chart-5/60 text-foreground">
          {label}
        </Badge>
      )
    case 'REJECTED':
      return <Badge variant="destructive">{label}</Badge>
    default:
      return <Badge variant="secondary">{label}</Badge>
  }
}

/** Organizer application state. */
export function OrganizerStatusBadge({ status }: { status: string }) {
  if (status === 'APPROVED') return <Badge>Approved</Badge>
  if (status === 'REJECTED') return <Badge variant="destructive">Rejected</Badge>
  return (
    <Badge variant="outline" className="border-chart-5/60 text-foreground">
      Pending
    </Badge>
  )
}

/** Account state. Suspended is destructive; active is deliberately quiet. */
export function AccountStatusBadge({ status }: { status: string }) {
  return status === 'ACTIVE' ? (
    <Badge variant="outline" className="border-primary/40 text-primary">
      Active
    </Badge>
  ) : (
    <Badge variant="destructive">Suspended</Badge>
  )
}

/**
 * Role. Only SUPER_ADMIN gets a solid badge — in a list of hundreds of
 * customers, the accounts with power are the ones worth spotting.
 */
export function RoleBadge({ role }: { role: string }) {
  switch (role) {
    case 'SUPER_ADMIN':
      return <Badge>Admin</Badge>
    case 'ORGANIZER':
      return (
        <Badge variant="outline" className="border-primary/40 text-primary">
          Organizer
        </Badge>
      )
    case 'EVENT_STAFF':
      return <Badge variant="outline">Staff</Badge>
    default:
      return <Badge variant="secondary">Customer</Badge>
  }
}
