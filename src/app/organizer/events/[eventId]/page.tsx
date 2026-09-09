import type { Metadata } from 'next'
import { EventsManager } from '@/components/organizer/events-manager'

export const metadata: Metadata = { title: 'Event analytics' }

export default async function OrganizerEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = await params

  // A deep link to one event's analytics: the events list renders behind the
  // analytics panel, so the URL is shareable and closing the panel returns to
  // the list rather than to an empty page.
  return <EventsManager initialAnalyticsEventId={eventId} />
}
