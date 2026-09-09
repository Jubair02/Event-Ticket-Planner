'use client'

import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Banknote,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Compass,
  ScanLine,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatMinor } from '@/lib/format'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { paths } from '@/lib/routes'
import type { OrganizerStats } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Eyebrow, HeroMetric, MetricGroup, Panel, entrance } from '@/components/dashboard/primitives'
import { cn } from '@/lib/utils'

function NextStep({
  icon: Icon,
  title,
  body,
  cta,
  onClick,
  tone = 'default',
}: {
  icon: LucideIcon
  title: string
  body: string
  cta?: string
  onClick?: () => void
  tone?: 'default' | 'attention' | 'done'
}) {
  return (
    <li className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          tone === 'attention' && 'bg-chart-5/20 text-foreground',
          tone === 'done' && 'bg-primary/10 text-primary',
          tone === 'default' && 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      {cta && onClick && (
        <Button size="sm" variant="outline" className="h-8 active:scale-[0.98] motion-reduce:transform-none" onClick={onClick}>
          {cta} <ArrowRight />
        </Button>
      )}
    </li>
  )
}

export function Overview() {
  const router = useRouter()
  const user = useAppStore((s) => s.user)
  const { data, isLoading } = useQuery({
    queryKey: ['organizer-stats'],
    queryFn: () => apiGet<{ stats: OrganizerStats }>('/api/organizer/stats'),
  })

  const s = data?.stats
  const totalEvents = s?.totalEvents ?? 0
  const activeEvents = s?.activeEvents ?? 0
  const ticketsSold = s?.ticketsSold ?? 0
  const checkIns = s?.checkIns ?? 0
  const pending = s?.pendingApprovals ?? 0
  const checkInRate = ticketsSold > 0 ? Math.round((checkIns / ticketsSold) * 100) : 0
  const approved = user?.organizer?.status === 'APPROVED'

  const goEvents = () => router.push(paths.organizerEvents())
  const goStaff = () => router.push(paths.organizerStaff())

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroMetric
          {...entrance(0)}
          label="Revenue"
          icon={Banknote}
          loading={isLoading}
          value={formatMinor(s?.revenueMinor ?? 0)}
          hint={
            isLoading
              ? undefined
              : `${ticketsSold} ticket${ticketsSold === 1 ? '' : 's'} sold across ${activeEvents} live event${activeEvents === 1 ? '' : 's'}`
          }
        />
        <div {...entrance(1)}>
          <MetricGroup
            title="Events"
            loading={isLoading}
            items={[
              { label: 'All events', value: totalEvents },
              { label: 'Live now', value: activeEvents },
              { label: 'Awaiting approval', value: pending },
            ]}
          />
        </div>
        <div {...entrance(2)}>
          <MetricGroup
            title="Attendance"
            loading={isLoading}
            items={[
              { label: 'Tickets sold', value: ticketsSold },
              { label: 'Checked in', value: checkIns },
              { label: 'Check-in rate', value: ticketsSold > 0 ? `${checkInRate}%` : '—' },
            ]}
          />
        </div>
      </div>

      {/* Replaces the old "Recent activity will appear here" copy, which promised a
          feature that does not exist. Everything below is derived from real data. */}
      <Panel {...entrance(3)}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>What&apos;s next</Eyebrow>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">
              {isLoading ? 'Checking your events…' : totalEvents === 0 ? 'Set up your first event' : 'Keep things moving'}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="active:scale-[0.98] motion-reduce:transform-none" onClick={goEvents}>
              <CalendarPlus /> Create event
            </Button>
            <Button size="sm" variant="ghost" onClick={() => router.push(paths.events())}>
              <Compass /> Browse events
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border/70 border-t border-border/70 pt-4">
            {!approved && (
              <NextStep
                icon={Clock}
                tone="attention"
                title="Your account is awaiting approval"
                body="Draft events now; publishing and gate staff unlock as soon as an admin approves you."
              />
            )}
            {totalEvents === 0 ? (
              <>
                <NextStep
                  icon={CalendarPlus}
                  title="Create your first event"
                  body="Add the date, venue and at least one ticket type. Save as a draft or submit straight for approval."
                  cta="Create"
                  onClick={goEvents}
                />
                <NextStep
                  icon={ScanLine}
                  title="Add gate staff before the doors open"
                  body="Staff accounts can only scan tickets for the events you assign them."
                  cta="Add staff"
                  onClick={goStaff}
                />
              </>
            ) : (
              <>
                {pending > 0 && (
                  <NextStep
                    icon={Clock}
                    tone="attention"
                    title={`${pending} event${pending === 1 ? '' : 's'} awaiting admin approval`}
                    body="Not visible to customers yet. Approval usually follows within a day."
                    cta="View"
                    onClick={goEvents}
                  />
                )}
                {activeEvents > 0 && checkIns === 0 && (
                  <NextStep
                    icon={ScanLine}
                    title="Make sure gate staff are assigned"
                    body="Nobody has checked in yet. Confirm each live event has at least one staff account."
                    cta="Staff"
                    onClick={goStaff}
                  />
                )}
                {activeEvents > 0 && checkIns > 0 && (
                  <NextStep
                    icon={CheckCircle2}
                    tone="done"
                    title={`${checkInRate}% of sold tickets have checked in`}
                    body="Open an event's analytics for the per-ticket-type breakdown."
                    cta="Analytics"
                    onClick={goEvents}
                  />
                )}
                {activeEvents === 0 && pending === 0 && (
                  <NextStep
                    icon={Sparkles}
                    title="No events are live right now"
                    body="Submit a draft for approval, or create the next one."
                    cta="Events"
                    onClick={goEvents}
                  />
                )}
              </>
            )}
          </ul>
        )}
      </Panel>
    </div>
  )
}
