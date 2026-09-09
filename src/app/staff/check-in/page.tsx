import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Protected } from '@/components/app/protected'
import { StaffScanner } from '@/components/staff/staff-scanner'
import { paths } from '@/lib/routes'

export const metadata: Metadata = {
  title: 'Check-in scanner',
  robots: { index: false, follow: false },
}

export default async function StaffCheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>
}) {
  const { event } = await searchParams

  // The scanner is meaningless without an event, so send the staffer to pick
  // one rather than rendering an empty gate.
  if (!event) redirect(paths.staff())

  return (
    <Protected roles={['EVENT_STAFF']}>
      {/* The assignment is re-checked server-side on every validate and
          check-in call — the event id in the URL grants nothing. */}
      <StaffScanner eventId={event} />
    </Protected>
  )
}
