'use client'

import { useQuery } from '@tanstack/react-query'
import { Activity, Banknote, CalendarDays, CalendarPlus, Compass, ScanLine, Ticket } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { apiGet } from '@/lib/api'
import { formatBDT } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { OrganizerStats } from '@/lib/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: LucideIcon
  label: string
  value: string | number
  loading: boolean
}) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{value}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{label}</p>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

export function Overview() {
  const navigate = useAppStore((s) => s.navigate)
  const { data, isLoading } = useQuery({
    queryKey: ['organizer-stats'],
    queryFn: () => apiGet<{ stats: OrganizerStats }>('/api/organizer/stats'),
  })

  const stats = data?.stats

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
        <StatCard icon={CalendarDays} label="Total Events" value={stats?.totalEvents ?? 0} loading={isLoading} />
        <StatCard icon={Activity} label="Active Events" value={stats?.activeEvents ?? 0} loading={isLoading} />
        <StatCard icon={Ticket} label="Tickets Sold" value={stats?.ticketsSold ?? 0} loading={isLoading} />
        <StatCard icon={Banknote} label="Revenue" value={stats ? formatBDT(stats.revenue) : '৳0'} loading={isLoading} />
        <StatCard icon={ScanLine} label="Check-ins" value={stats?.checkIns ?? 0} loading={isLoading} />
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <h2 className="mb-3 font-semibold">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => navigate({ name: 'organizer', tab: 'events' })}>
              <CalendarPlus className="mr-2 h-4 w-4" /> Create Event
            </Button>
            <Button variant="outline" onClick={() => navigate({ name: 'home' })}>
              <Compass className="mr-2 h-4 w-4" /> Browse Events
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Recent activity — new orders, check-ins and staff updates — will appear here as your events receive
            traffic. Open the <span className="font-medium text-foreground">My Events</span> tab to manage tickets,
            submit events for approval and view per-event analytics.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
