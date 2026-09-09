import type { Metadata } from 'next'
import { Protected } from '@/components/app/protected'
import { StaffEventPicker } from '@/components/staff/staff-scanner'

export const metadata: Metadata = {
  title: 'My events',
  robots: { index: false, follow: false },
}

export default function StaffPage() {
  return (
    <Protected roles={['EVENT_STAFF']}>
      <StaffEventPicker />
    </Protected>
  )
}
