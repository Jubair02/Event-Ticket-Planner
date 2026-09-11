import type { Metadata } from 'next'
import { OrganizerOrders } from '@/components/organizer/orders'

export const metadata: Metadata = { title: 'Orders' }

export default async function OrganizerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; eventId?: string }>
}) {
  const { status, q, eventId } = await searchParams
  return (
    <OrganizerOrders
      initialStatus={status || 'ALL'}
      initialSearch={q || ''}
      initialEventId={eventId || 'ALL'}
    />
  )
}
