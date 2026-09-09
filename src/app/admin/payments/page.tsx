import type { Metadata } from 'next'
import { AdminPayments } from '@/components/admin/payments'

export const metadata: Metadata = { title: 'Payments' }

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const { status, q } = await searchParams
  return <AdminPayments initialStatus={status || 'ALL'} initialSearch={q || ''} />
}
