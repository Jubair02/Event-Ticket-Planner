'use client'

import { CheckCircle2, ShieldCheck, TicketX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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

/**
 * The three states a holder actually cares about: can I walk in, have I
 * already, or is this ticket dead.
 *
 * Four statuses collapse to three tones because CANCELLED and INVALID mean the
 * same thing at a door. This lives here rather than in the e-ticket because My
 * Tickets renders the same judgement in list form — two copies of it would
 * drift, which is the problem this module exists to prevent.
 */
export type TicketTone = 'valid' | 'used' | 'void'

export function ticketTone(status: Status): TicketTone {
  if (status === 'CHECKED_IN') return 'used'
  return ticketStatusMeta(status).void ? 'void' : 'valid'
}

/**
 * One icon per tone, so colour is never the only carrier of state — it holds
 * up under colourblindness, greyscale print and `forced-colors`.
 */
export const TICKET_TONE_ICON: Record<TicketTone, LucideIcon> = {
  valid: ShieldCheck,
  used: CheckCircle2,
  void: TicketX,
}

export function TicketStatusBadge({ status, className }: { status: Status; className?: string }) {
  const meta = ticketStatusMeta(status)
  return (
    <Badge variant={meta.variant} className={cn(meta.className, className)}>
      {meta.label}
    </Badge>
  )
}
