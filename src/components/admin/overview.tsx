'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ClipboardCheck } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatBDT } from '@/lib/format'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { AdminStats } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MetricGroup, entrance, panelClass } from '@/components/dashboard/primitives'

// ============================= Overview =============================

function QueueRow({
  count,
  label,
  hint,
  cta,
  href,
  loading,
}: {
  count: number
  label: string
  hint: string
  cta: string
  /** Deep link into the section, with its filter already narrowed to the queue. */
  href: string
  loading: boolean
}) {
  const waiting = count > 0
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <span
        className={cn(
          'w-12 shrink-0 text-2xl font-semibold tabular-nums',
          waiting ? 'text-foreground' : 'text-muted-foreground/50',
        )}
      >
        {loading ? <Skeleton className="h-7 w-9" /> : count}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm font-medium', !waiting && 'text-muted-foreground')}>{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      {waiting && (
        <Button asChild size="sm" className="active:scale-[0.98]">
          <Link href={href}>{cta}</Link>
        </Button>
      )}
    </li>
  )
}

export function AdminOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => apiGet<{ stats: AdminStats }>('/api/admin/stats'),
  })
  const s = data?.stats
  const pendingEvents = s?.pendingEvents ?? 0
  const pendingOrganizers = s?.pendingOrganizers ?? 0
  const waiting = pendingEvents + pendingOrganizers
  // Counts default to 0 while loading, so only warn once real data has arrived.
  const hasQueue = !isLoading && waiting > 0

  return (
    <div className="space-y-6">
      {/* The one job this page exists for, given the weight to match. */}
      <section
        aria-labelledby="admin-queue-heading"
        {...entrance(0)}
        className={cn(
          panelClass,
          'p-5 sm:p-6',
          entrance(0).className,
          hasQueue && 'border-chart-5/50 bg-chart-5/10 shadow-chart-5/10',
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl',
              hasQueue ? 'bg-chart-5/25 text-foreground' : 'bg-primary/10 text-primary',
            )}
          >
            {hasQueue ? <ClipboardCheck className="size-5" /> : <CheckCircle2 className="size-5" />}
          </span>
          <div className="min-w-0">
            <h2 id="admin-queue-heading" className="text-lg font-semibold tracking-tight">
              Needs review
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isLoading
                ? 'Checking for submissions…'
                : hasQueue
                  ? 'Submissions are held from the public site until you decide.'
                  : 'Nothing is waiting on you right now.'}
            </p>
          </div>
        </div>

        {(isLoading || hasQueue) && (
          <ul className="mt-4 divide-y border-t pt-4">
            <QueueRow
              count={pendingEvents}
              label="Events awaiting approval"
              hint="Not visible to customers until approved"
              cta="Review events"
              href={paths.adminEvents({ status: 'PENDING_APPROVAL' })}
              loading={isLoading}
            />
            <QueueRow
              count={pendingOrganizers}
              label="Organizer applications"
              hint="Cannot publish events until approved"
              cta="Review applications"
              href={paths.adminOrganizers('PENDING')}
              loading={isLoading}
            />
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Revenue is the one number worth reading at a glance, so it gets the size. */}
        <section
          aria-labelledby="admin-revenue-heading"
          {...entrance(1)}
          className={cn(panelClass, 'relative overflow-hidden p-5 sm:p-6', entrance(1).className)}
        >
          <div
            className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
            aria-hidden="true"
          />
          <h3
            id="admin-revenue-heading"
            className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase"
          >
            Revenue
          </h3>
          {isLoading ? (
            <Skeleton className="mt-3 h-9 w-40" />
          ) : (
            <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
              {formatBDT(s?.totalRevenue ?? 0)}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {s?.paidOrders ?? 0} paid of {s?.totalOrders ?? 0} orders
          </p>
          <dl className="mt-4 divide-y border-t">
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-sm text-muted-foreground">Tickets sold</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {isLoading ? <Skeleton className="h-4 w-12" /> : (s?.totalTicketsSold ?? 0)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2 last:pb-0">
              <dt className="text-sm text-muted-foreground">Check-ins</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {isLoading ? <Skeleton className="h-4 w-12" /> : (s?.totalCheckIns ?? 0)}
              </dd>
            </div>
          </dl>
        </section>

        <div {...entrance(2)}>
        <MetricGroup
          title="People"
          loading={isLoading}
          items={[
            { label: 'All accounts', value: s?.totalUsers ?? 0 },
            { label: 'Customers', value: s?.totalCustomers ?? 0 },
            { label: 'Organizers', value: s?.totalOrganizers ?? 0 },
            { label: 'Event staff', value: s?.totalStaff ?? 0 },
          ]}
        />
        </div>

        <div {...entrance(3)}>
        <MetricGroup
          title="Events"
          loading={isLoading}
          items={[
            { label: 'All events', value: s?.totalEvents ?? 0 },
            { label: 'Published', value: s?.publishedEvents ?? 0 },
            { label: 'Awaiting approval', value: pendingEvents },
          ]}
        />
        </div>
      </div>
    </div>
  )
}
