'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import { paths } from '@/lib/routes'
import type { AdminStats } from '@/lib/types'
import { DashboardShell, type DashboardNavItem } from '@/components/dashboard/shell'

/**
 * Persistent frame for every `/admin/*` route. Rendered from the segment
 * layout, so the header and nav rail stay mounted while the section changes.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  // Same key as the overview's query, so TanStack shares the cache — this only
  // decorates the nav labels with what is waiting for review.
  const { data } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => apiGet<{ stats: AdminStats }>('/api/admin/stats'),
  })

  const nav: DashboardNavItem[] = [
    { href: paths.admin(), label: 'Overview', exact: true },
    { href: paths.adminOrganizers(), label: 'Organizers', count: data?.stats.pendingOrganizers ?? 0 },
    { href: paths.adminEvents(), label: 'Events', count: data?.stats.pendingEvents ?? 0 },
    { href: paths.adminUsers(), label: 'Users' },
    { href: paths.adminPayments(), label: 'Payments' },
    { href: paths.adminRefunds(), label: 'Refunds' },
    { href: paths.adminPayouts(), label: 'Payouts' },
    { href: paths.adminAudit(), label: 'Audit' },
  ]

  return (
    <DashboardShell
      eyebrow="Super admin"
      title="Admin dashboard"
      subtitle="Approvals, moderation and platform health."
      nav={nav}
    >
      {children}
    </DashboardShell>
  )
}
