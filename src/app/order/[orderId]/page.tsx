import type { Metadata } from 'next'
import { Protected } from '@/components/app/protected'
import { PaymentGateway } from '@/components/customer/payment-gateway'

export const metadata: Metadata = {
  title: 'Payment',
  robots: { index: false, follow: false },
}

export default async function OrderPaymentPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  return (
    <Protected>
      <PaymentGateway orderId={orderId} />
    </Protected>
  )
}
