import type { Metadata } from 'next'
import { AdminRefunds } from '@/components/admin/refunds'

export const metadata: Metadata = { title: 'Refunds' }

export default async function AdminRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const { status, q } = await searchParams
  return <AdminRefunds initialStatus={status || 'ALL'} initialSearch={q || ''} />
}
