import type { Metadata } from 'next'
import { OrganizerOrders } from '@/components/organizer/orders'

export const metadata: Metadata = { title: 'Orders' }

export default async function OrganizerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const { status, q } = await searchParams
  return <OrganizerOrders initialStatus={status || 'ALL'} initialSearch={q || ''} />
}
