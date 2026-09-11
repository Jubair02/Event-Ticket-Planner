'use client'

import { Check, CreditCard, QrCode, Ticket as TicketIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type CheckoutStep = 1 | 2 | 3

const STEPS: Array<{ n: CheckoutStep; label: string; icon: LucideIcon }> = [
  { n: 1, label: 'Tickets', icon: TicketIcon },
  { n: 2, label: 'Payment', icon: CreditCard },
  { n: 3, label: 'E-ticket', icon: QrCode },
]

/**
 * Where the buyer is in the three-screen purchase.
 *
 * The funnel used to give no orientation at all — no sign that payment was a
 * separate screen, or that anything came after it. Rendering the same rail on
 * checkout, the gateway and the confirmation is what makes the three read as
 * one flow rather than three unrelated pages.
 *
 * `current` marks the active step; everything before it is shown complete.
 */
export function StepRail({
  current,
  className,
}: {
  current: CheckoutStep
  className?: string
}) {
  return (
    <ol className={cn('flex items-center gap-1.5 sm:gap-3', className)} aria-label="Checkout progress">
      {STEPS.map((s, i) => {
        const done = s.n < current
        const active = s.n === current
        return (
          <li key={s.n} className="flex items-center gap-1.5 sm:gap-3">
            <span
              className={cn(
                'flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-xs font-medium transition-colors duration-200 sm:pr-3',
                active && 'bg-primary/10 text-foreground',
                !active && 'text-muted-foreground',
              )}
              aria-current={active ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  active && 'bg-primary text-primary-foreground',
                  done && 'bg-primary/15 text-primary',
                  !active && !done && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : s.n}
              </span>
              {/* The labels are the point of the rail, so they survive down to
                  360px rather than collapsing to bare numbers. */}
              <span className="whitespace-nowrap">{s.label}</span>
            </span>
            {i < STEPS.length - 1 && (
              <span
                className={cn('h-px w-3 shrink-0 sm:w-8', done ? 'bg-primary/40' : 'bg-border')}
                aria-hidden="true"
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
