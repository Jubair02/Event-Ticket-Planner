import type { Metadata } from 'next'
import { Protected } from '@/components/app/protected'
import { TicketDetail } from '@/components/customer/ticket-detail'

export const metadata: Metadata = {
  title: 'E-ticket',
  robots: { index: false, follow: false },
}

export default async function TicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params
  return (
    <Protected roles={['CUSTOMER', 'SUPER_ADMIN']}>
      <TicketDetail ticketId={ticketId} />
    </Protected>
  )
}
