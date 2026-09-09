import type { Metadata } from 'next'
import { Protected } from '@/components/app/protected'
import { AdminShell } from '@/components/admin/admin-shell'

export const metadata: Metadata = {
  title: { default: 'Admin dashboard', template: '%s · Admin · TicketBD' },
  robots: { index: false, follow: false },
}

/** Frame for every `/admin/*` route — see the organizer layout for the rationale. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected roles={['SUPER_ADMIN']}>
      <AdminShell>{children}</AdminShell>
    </Protected>
  )
}
