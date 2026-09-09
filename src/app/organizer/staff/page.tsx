import type { Metadata } from 'next'
import { StaffManager } from '@/components/organizer/staff-manager'

export const metadata: Metadata = { title: 'Staff' }

export default function OrganizerStaffPage() {
  return <StaffManager />
}
