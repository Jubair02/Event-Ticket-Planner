import type { Metadata } from 'next'
import { HomePage } from '@/components/app/home'

const TITLE = 'Browse events'
const DESCRIPTION =
  'Search every event on TicketBD by city and category — concerts, tech summits, workshops, sports, cultural nights, food festivals and more across Bangladesh.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/events' },
  openGraph: { title: `${TITLE} · TicketBD`, description: DESCRIPTION, url: '/events' },
  twitter: { title: `${TITLE} · TicketBD`, description: DESCRIPTION },
}

export default function EventsPage() {
  // Same component as the homepage, minus the marketing sections: this route is
  // the searchable index, so the grid and filters are the whole point.
  return <HomePage browseOnly />
}
