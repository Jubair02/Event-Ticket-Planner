'use client'

import { AlertTriangle, Clock } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { EVENT_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/lib/constants'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Overview } from './overview'
import { EventsManager } from './events-manager'
import { StaffManager } from './staff-manager'

/** Shared event-status badge (also used by the admin dashboard). */
export function EventStatusBadge({ status }: { status: string }) {
  const label = EVENT_STATUS_LABELS[status] ?? status
  switch (status) {
    case 'PUBLISHED':
      return <Badge>{label}</Badge>
    case 'ONGOING':
      return (
        <Badge className="gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
          </span>
          {label}
        </Badge>
      )
    case 'PENDING_APPROVAL':
      return (
        <Badge variant="outline" className="border-amber-400/60 text-amber-600 dark:text-amber-400">
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

/** Shared payment-status badge (also used by the admin dashboard). */
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
      return <Badge variant="secondary">{label}</Badge>
    default:
      return <Badge variant="secondary">{label}</Badge>
  }
}

type OrganizerTab = 'overview' | 'events' | 'staff'

export function OrganizerDashboard({ initialTab }: { initialTab?: OrganizerTab }) {
  const navigate = useAppStore((s) => s.navigate)
  const user = useAppStore((s) => s.user)
  const view = useAppStore((s) => s.view)
  // Tab is derived from the store view (single source of truth — no sync effect needed)
  const tab: OrganizerTab = (view.name === 'organizer' ? view.tab : initialTab) ?? 'overview'

  const orgStatus = user?.organizer?.status

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Organizer Dashboard</h1>
          <Badge variant="outline" className="border-primary/40 text-primary">Organizer</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {user?.organizer?.organizationName || user?.name || 'Your events'}
        </p>
      </header>

      {orgStatus === 'PENDING' && (
        <Alert className="mb-6 border-amber-400/50 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
          <Clock className="h-4 w-4" />
          <AlertTitle>Awaiting admin approval</AlertTitle>
          <AlertDescription>
            Your organizer account is awaiting admin approval. You can create events as drafts; publishing unlocks
            after approval.
          </AlertDescription>
        </Alert>
      )}
      {orgStatus === 'REJECTED' && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Application rejected</AlertTitle>
          <AlertDescription>Your organizer application was rejected. Contact support.</AlertDescription>
        </Alert>
      )}

      <Tabs
        value={tab}
        onValueChange={(t) => navigate({ name: 'organizer', tab: t as OrganizerTab })}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="events">My Events</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-2">
          <Overview />
        </TabsContent>
        <TabsContent value="events" className="mt-2">
          <EventsManager />
        </TabsContent>
        <TabsContent value="staff" className="mt-2">
          <StaffManager />
        </TabsContent>
      </Tabs>
    </div>
  )
}
