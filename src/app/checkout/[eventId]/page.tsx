import type { Metadata } from 'next'
import { Protected } from '@/components/app/protected'
import { Checkout } from '@/components/customer/checkout'
import { decodeItems } from '@/lib/routes'

export const metadata: Metadata = {
  title: 'Checkout',
  // Nothing behind a session should be indexed or previewed.
  robots: { index: false, follow: false },
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const [{ eventId }, { t }] = await Promise.all([params, searchParams])

  // `?t=tt1:2,tt2:1` — the selection made on the event page. Decoded here so a
  // refresh on checkout keeps it, and quantities are re-clamped against live
  // availability inside the component.
  return (
    <Protected>
      <Checkout eventId={eventId} items={decodeItems(t)} />
    </Protected>
  )
}
