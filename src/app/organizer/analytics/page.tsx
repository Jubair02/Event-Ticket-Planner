import type { Metadata } from 'next'
import { OrganizerAnalytics } from '@/components/organizer/analytics'

export const metadata: Metadata = { title: 'Analytics' }

export default function OrganizerAnalyticsPage() {
  return <OrganizerAnalytics />
}
