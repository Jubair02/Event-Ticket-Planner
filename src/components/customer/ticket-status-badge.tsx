'use client'

import { Badge } from '@/components/ui/badge'
import type { TicketDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

type Status = TicketDTO['status']

interface StatusMeta {
  label: string
  variant: 'default' | 'outline' | 'destructive' | 'secondary'
  className?: string
  /** True when the ticket can no longer be used for entry. */
  void: boolean
}

/**
 * One definition of what a ticket status looks like, shared by My Tickets,
 * Payment Success and the e-ticket. These three screens previously each
 * carried their own copy, so the labels a buyer reads could drift apart.
 */
export const TICKET_STATUS_META: Record<Status, StatusMeta> = {
  ACTIVE: { label: 'Valid', variant: 'outline', className: 'border-primary/50 text-primary', void: false },
  CHECKED_IN: { label: 'Checked in', variant: 'default', void: false },
  CANCELLED: { label: 'Cancelled', variant: 'destructive', void: true },
  INVALID: { label: 'Not valid', variant: 'destructive', void: true },
}

export function ticketStatusMeta(status: Status): StatusMeta {
  return TICKET_STATUS_META[status] ?? TICKET_STATUS_META.INVALID
}

export function TicketStatusBadge({ status, className }: { status: Status; className?: string }) {
  const meta = ticketStatusMeta(status)
  return (
    <Badge variant={meta.variant} className={cn(meta.className, className)}>
      {meta.label}
    </Badge>
  )
}
