import type { Metadata } from 'next'
import { Protected } from '@/components/app/protected'
import { MyTickets } from '@/components/customer/my-tickets'

export const metadata: Metadata = {
  title: 'My tickets',
  robots: { index: false, follow: false },
}

const TABS = ['upcoming', 'past', 'cancelled'] as const
type Tab = (typeof TABS)[number]

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const initialTab = TABS.includes(tab as Tab) ? (tab as Tab) : undefined

  return (
    <Protected roles={['CUSTOMER', 'SUPER_ADMIN']}>
      <MyTickets initialTab={initialTab} />
    </Protected>
  )
}
