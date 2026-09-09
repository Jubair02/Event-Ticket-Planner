import type { Metadata } from 'next'
import { EventsManager } from '@/components/organizer/events-manager'

export const metadata: Metadata = { title: 'My events' }

export default async function OrganizerEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; new?: string }>
}) {
  const { status, new: create } = await searchParams
  // Read on the server so the right chip is active on first paint, rather than
  // flashing "All" and then correcting itself.
  return <EventsManager initialStatus={status || 'ALL'} createOnArrival={create === '1'} />
}
