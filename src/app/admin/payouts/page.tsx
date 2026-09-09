import type { Metadata } from 'next'
import { AdminPayouts } from '@/components/admin/payouts'

export const metadata: Metadata = { title: 'Payouts' }

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const { status, q } = await searchParams
  return <AdminPayouts initialStatus={status || 'ALL'} initialSearch={q || ''} />
}
