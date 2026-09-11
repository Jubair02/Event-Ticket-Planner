'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BanknoteArrowUp,
  Building2,
  CheckCircle2,
  Scale,
  Ticket,
  TrendingUp,
  Undo2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatMinor } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { AdminStats } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Eyebrow,
  HeroMetric,
  Meter,
  MetricGroup,
  Panel,
  SectionHeading,
  sectionProps,
} from '@/components/dashboard/primitives'

/**
 * The admin command centre.
 *
 * One question first: **is anything waiting on me?** Everything else on this
 * page is context. So the review queue comes before the metrics, it covers all
 * four queues rather than the two the stats endpoint used to know about, and it
 * disappears entirely when there is nothing to do — rather than rendering four
 * reassuring zeros an operator has to read to learn nothing.
 */

interface QueueItem {
  label: string
  count: number
  href: string
  icon: LucideIcon
  /** Failures and money owed are not merely "pending". */
  urgent?: boolean
}

function ReviewQueue({ items }: { items: QueueItem[] }) {
  return (
    <Panel {...sectionProps(0, 'relative overflow-hidden')}>
      <div
        className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-chart-5/15 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative">
        <Eyebrow>Needs review</Eyebrow>
        <h2 className="mt-1.5 text-lg font-semibold tracking-tight">
          {items.length === 1
            ? 'One queue needs you'
            : `${items.length} queues need you`}
        </h2>
      </div>

      <ul className="relative mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.label}>
            <Link
              href={it.href}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                it.urgent
                  ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
                  : 'border-chart-5/40 bg-chart-5/5 hover:bg-chart-5/10',
              )}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-xl',
                  it.urgent ? 'bg-destructive/10 text-destructive' : 'bg-chart-5/20 text-foreground',
                )}
                aria-hidden="true"
              >
                <it.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{it.label}</span>
                <span className="block text-xs text-muted-foreground">Open the queue</span>
              </span>
              <span
                className={cn(
                  'shrink-0 text-2xl font-semibold tabular-nums',
                  it.urgent && 'text-destructive',
                )}
              >
                {it.count}
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function AdminOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => apiGet<{ stats: AdminStats }>('/api/admin/stats'),
  })

  const s = data?.stats
  const ledger = s?.ledger

  const queue: QueueItem[] = [
    {
      label: `${s?.pendingOrganizers ?? 0} organizer application${s?.pendingOrganizers === 1 ? '' : 's'}`,
      count: s?.pendingOrganizers ?? 0,
      href: paths.adminOrganizers({ status: 'PENDING' }),
      icon: Building2,
    },
    {
      label: `${s?.pendingEvents ?? 0} event${s?.pendingEvents === 1 ? '' : 's'} to approve`,
      count: s?.pendingEvents ?? 0,
      href: paths.adminEvents({ status: 'PENDING_APPROVAL' }),
      icon: Ticket,
    },
    {
      label: `${s?.pendingRefunds ?? 0} refund${s?.pendingRefunds === 1 ? '' : 's'} to action`,
      count: s?.pendingRefunds ?? 0,
      href: paths.adminRefunds({ status: 'REQUESTED' }),
      icon: Undo2,
    },
    {
      label: `${s?.failedRefunds ?? 0} refund${s?.failedRefunds === 1 ? '' : 's'} failed at the gateway`,
      count: s?.failedRefunds ?? 0,
      href: paths.adminRefunds({ status: 'FAILED' }),
      icon: Undo2,
      urgent: true,
    },
    {
      label: `${s?.pendingPayouts ?? 0} payout${s?.pendingPayouts === 1 ? '' : 's'} to review`,
      count: s?.pendingPayouts ?? 0,
      href: paths.adminPayouts({ status: 'REQUESTED' }),
      icon: BanknoteArrowUp,
    },
  ].filter((it) => it.count > 0)

  const checkInRate =
    s && s.totalTicketsSold > 0 ? s.totalCheckIns / s.totalTicketsSold : null

  return (
    <div className="space-y-6">
      {isLoading ? (
        <Panel className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-48" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        </Panel>
      ) : queue.length > 0 ? (
        <ReviewQueue items={queue} />
      ) : (
        <Panel {...sectionProps(0, 'flex items-center gap-3')}>
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <p className="font-medium">Nothing is waiting on you</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              No applications, submissions, refunds or payouts need a decision right now.
            </p>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <HeroMetric
          label="Gross ticket revenue"
          icon={TrendingUp}
          loading={isLoading}
          value={formatMinor(s?.totalRevenueMinor ?? 0)}
          hint={
            isLoading
              ? undefined
              : `${s?.paidOrders ?? 0} paid order${s?.paidOrders === 1 ? '' : 's'} of ${s?.totalOrders ?? 0} · ${s?.totalTicketsSold ?? 0} tickets`
          }
          {...sectionProps(1, 'lg:col-span-2')}
        >
          <div className="relative mt-5 flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href={paths.adminPayments()}>
                <Scale /> Payments and ledger
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href={paths.adminAudit()}>
                Audit trail <ArrowRight />
              </Link>
            </Button>
          </div>
        </HeroMetric>

        <div {...sectionProps(2, '')}>
          {/* Ledger balances, not re-summed order totals — the same figures the
              payments page shows, from the same source. */}
          <MetricGroup
            title="Platform position"
            loading={isLoading}
            items={[
              { label: 'Held at gateway', value: formatMinor(ledger?.gatewayClearingMinor ?? 0) },
              { label: 'In our bank', value: formatMinor(ledger?.cashMinor ?? 0) },
              { label: 'Owed to organizers', value: formatMinor(ledger?.organizerPayableMinor ?? 0) },
              { label: 'Our revenue', value: formatMinor(ledger?.platformRevenueMinor ?? 0) },
            ]}
          />
        </div>
      </div>

      <section aria-labelledby="platform-heading" {...sectionProps(3)}>
        <SectionHeading
          id="platform-heading"
          title="Platform"
          description="Who is on it, what is listed, and whether attendees turn up."
        >
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link href={paths.adminUsers()}>
              Manage users <ArrowRight />
            </Link>
          </Button>
        </SectionHeading>

        <div className="grid gap-4 sm:grid-cols-3">
          <MetricGroup
            title="People"
            loading={isLoading}
            items={[
              { label: 'Customers', value: s?.totalCustomers ?? 0 },
              { label: 'Organizers', value: s?.totalOrganizers ?? 0 },
              { label: 'Gate staff', value: s?.totalStaff ?? 0 },
            ]}
          />
          <MetricGroup
            title="Events"
            loading={isLoading}
            items={[
              { label: 'All events', value: s?.totalEvents ?? 0 },
              { label: 'Published', value: s?.publishedEvents ?? 0 },
              { label: 'Awaiting approval', value: s?.pendingEvents ?? 0 },
            ]}
          />
          <Panel className="p-5">
            <Eyebrow>Attendance</Eyebrow>
            {isLoading ? (
              <Skeleton className="mt-2 h-8 w-20" />
            ) : (
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                {checkInRate === null ? '—' : `${Math.round(checkInRate * 100)}%`}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {checkInRate === null
                ? 'No tickets sold yet'
                : `${s?.totalCheckIns ?? 0} of ${s?.totalTicketsSold ?? 0} sold tickets scanned`}
            </p>
            {checkInRate !== null && (
              <Meter
                className="mt-3"
                value={s?.totalCheckIns ?? 0}
                max={s?.totalTicketsSold ?? 0}
                label={`${s?.totalCheckIns ?? 0} of ${s?.totalTicketsSold ?? 0} tickets checked in`}
                hot={1.01}
              />
            )}
          </Panel>
        </div>
      </section>
    </div>
  )
}
