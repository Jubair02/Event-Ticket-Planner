import type { Metadata } from 'next'
import { Protected } from '@/components/app/protected'
import { OrganizerShell } from '@/components/organizer/organizer-shell'

export const metadata: Metadata = {
  title: { default: 'Organizer dashboard', template: '%s · Organizer · TicketBD' },
  robots: { index: false, follow: false },
}

/**
 * Frame for every `/organizer/*` route. Because it is a layout, the header,
 * approval notice and nav rail stay mounted across section changes — the
 * section below is the only thing that swaps, and the role check runs once.
 */
export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected roles={['ORGANIZER']}>
      <OrganizerShell>{children}</OrganizerShell>
    </Protected>
  )
}
