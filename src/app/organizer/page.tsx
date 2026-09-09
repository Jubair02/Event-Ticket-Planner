import type { Metadata } from 'next'
import { Overview } from '@/components/organizer/overview'

export const metadata: Metadata = { title: 'Overview' }

export default function OrganizerOverviewPage() {
  return <Overview />
}
