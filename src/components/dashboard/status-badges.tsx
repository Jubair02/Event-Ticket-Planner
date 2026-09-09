'use client'

import { Badge } from '@/components/ui/badge'
import { EVENT_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/lib/constants'

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
    case 'CANCELLED':
      return <Badge variant="outline">{label}</Badge>
    case 'REFUNDED':
    case 'PROCESSING':
    default:
      return <Badge variant="secondary">{label}</Badge>
  }
}
