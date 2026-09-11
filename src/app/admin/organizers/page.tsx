import type { Metadata } from 'next'
import { AdminOrganizers } from '@/components/admin/organizers'

export const metadata: Metadata = { title: 'Organizers' }

export default async function AdminOrganizersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const { status, q } = await searchParams
  return <AdminOrganizers initialStatus={status || 'ALL'} initialSearch={q || ''} />
}
