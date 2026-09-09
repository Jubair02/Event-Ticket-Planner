import type { Metadata } from 'next'
import { Protected } from '@/components/app/protected'
import { PaymentSuccess } from '@/components/customer/payment-success'

export const metadata: Metadata = {
  title: 'Order confirmed',
  robots: { index: false, follow: false },
}

export default async function OrderSuccessPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  return (
    <Protected>
      {/* Payment is verified against the server inside this component — the URL
          alone never implies a completed order. */}
      <PaymentSuccess orderId={orderId} />
    </Protected>
  )
}
