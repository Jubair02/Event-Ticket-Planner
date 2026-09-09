import type { Metadata } from 'next'
import { OrganizerPayouts } from '@/components/organizer/payouts'

export const metadata: Metadata = { title: 'Payouts' }

export default function OrganizerPayoutsPage() {
  return <OrganizerPayouts />
}
