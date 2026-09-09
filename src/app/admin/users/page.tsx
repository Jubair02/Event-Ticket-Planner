import type { Metadata } from 'next'
import { AdminUsers } from '@/components/admin/users'

export const metadata: Metadata = { title: 'Users' }

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; q?: string }>
}) {
  const { role, q } = await searchParams
  return <AdminUsers initialRole={role || 'ALL'} initialSearch={q || ''} />
}
