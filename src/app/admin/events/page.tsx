import type { Metadata } from 'next'
import { AdminEvents } from '@/components/admin/events'

export const metadata: Metadata = { title: 'Events' }

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const { status, q } = await searchParams
  return <AdminEvents initialStatus={status || 'ALL'} initialSearch={q || ''} />
}
