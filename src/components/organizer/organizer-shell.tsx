'use client'

import Link from 'next/link'
import { AlertTriangle, CalendarPlus, Clock } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { paths } from '@/lib/routes'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DashboardShell, type DashboardNavItem } from '@/components/dashboard/shell'

const NAV: DashboardNavItem[] = [
  { href: paths.organizer(), label: 'Overview', exact: true },
  { href: paths.organizerEvents(), label: 'My events' },
  { href: paths.organizerOrders(), label: 'Orders' },
  { href: paths.organizerAnalytics(), label: 'Analytics' },
  { href: paths.organizerPayouts(), label: 'Payouts' },
  { href: paths.organizerStaff(), label: 'Staff' },
]

/**
 * Persistent frame for every `/organizer/*` route. Rendered from the segment
 * layout, so the header, the approval notice and the nav rail stay mounted
 * while the section below them changes.
 */
export function OrganizerShell({ children }: { children: React.ReactNode }) {
  const user = useAppStore((s) => s.user)
  const orgStatus = user?.organizer?.status

  const notice =
    orgStatus === 'PENDING' ? (
      <Alert className="border-chart-5/50 bg-chart-5/10 [&>svg]:text-chart-5">
        <Clock className="h-4 w-4" />
        <AlertTitle>Awaiting admin approval</AlertTitle>
        <AlertDescription>
          You can draft events now. Publishing and gate staff unlock once an admin approves your account.
        </AlertDescription>
      </Alert>
    ) : orgStatus === 'REJECTED' ? (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Application not approved</AlertTitle>
        <AlertDescription>Your organizer application was not approved. Contact support to appeal.</AlertDescription>
      </Alert>
    ) : null

  return (
    <DashboardShell
      eyebrow={user?.organizer?.organizationName || 'Organizer'}
      title="Organizer dashboard"
      subtitle="Sell tickets, track sales and run the gate."
      nav={NAV}
      notice={notice}
      actions={
        <Button asChild className="active:scale-[0.98] motion-reduce:transform-none">
          {/* `new=1` opens the create form on arrival, so the button does what it
              says from anywhere in the dashboard. */}
          <Link href={`${paths.organizerEvents()}?new=1`}>
            <CalendarPlus /> Create event
          </Link>
        </Button>
      }
    >
      {children}
    </DashboardShell>
  )
}
