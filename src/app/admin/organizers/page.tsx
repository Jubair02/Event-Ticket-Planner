import type { Metadata } from 'next'
import { AdminOrganizers } from '@/components/admin/organizers'

export const metadata: Metadata = { title: 'Organizers' }

export default async function AdminOrganizersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  return <AdminOrganizers initialStatus={status || 'ALL'} />
}
