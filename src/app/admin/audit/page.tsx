import type { Metadata } from 'next'
import { AdminAudit } from '@/components/admin/audit'

export const metadata: Metadata = { title: 'Audit' }

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>
}) {
  const { source } = await searchParams
  return <AdminAudit initialSource={source || 'ALL'} />
}
