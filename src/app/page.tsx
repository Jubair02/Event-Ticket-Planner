'use client'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Providers, useSessionLoader } from '@/components/app/providers'
import { useAppStore } from '@/lib/store'
import { Navbar } from '@/components/app/navbar'
import { Footer } from '@/components/app/footer'
import { AuthDialog } from '@/components/app/auth-dialog'
import { ProfileDialog } from '@/components/app/profile-dialog'
import { HomePage } from '@/components/app/home'
import { EventDetail } from '@/components/customer/event-detail'
import { Checkout } from '@/components/customer/checkout'
import { PaymentGateway } from '@/components/customer/payment-gateway'
import { PaymentSuccess } from '@/components/customer/payment-success'
import { MyTickets } from '@/components/customer/my-tickets'
import { TicketDetail } from '@/components/customer/ticket-detail'
import { OrganizerDashboard } from '@/components/organizer/organizer-dashboard'
import { AdminDashboard } from '@/components/admin/admin-dashboard'
import { StaffScanner } from '@/components/staff/staff-scanner'
import { EmptyState } from '@/components/app/empty-state'
import { Button } from '@/components/ui/button'
import { Loader2, Lock } from 'lucide-react'

function ProtectedGate({ children }: { children: React.ReactNode }) {
  const { user, authLoaded, openAuth } = useAppStore()
  if (!authLoaded) {
    return (
      <div className="flex items-center justify-center py-32 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
      </div>
    )
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <EmptyState
          icon={Lock}
          title="Please sign in"
          description="You need an account to access this page."
          action={<Button onClick={() => openAuth('login')}>Sign in</Button>}
        />
      </div>
    )
  }
  return <>{children}</>
}

function AppShell() {
  useSessionLoader()
  const view = useAppStore((s) => s.view)
  const authLoaded = useAppStore((s) => s.authLoaded)
  const user = useAppStore((s) => s.user)
  const navigate = useAppStore((s) => s.navigate)

  // If auth has loaded and a role lands on a protected view without a session, gate handles it.

  useEffect(() => {
    // redirect wrong-role views once session is known
    if (!authLoaded || !user) return
    if (view.name === 'organizer' && user.role !== 'ORGANIZER') navigate({ name: 'home' })
    if (view.name === 'admin' && user.role !== 'SUPER_ADMIN') navigate({ name: 'home' })
    if (view.name === 'staff' && user.role !== 'EVENT_STAFF') navigate({ name: 'home' })
    if ((view.name === 'my-tickets' || view.name === 'ticket-detail') && user.role !== 'CUSTOMER' && user.role !== 'SUPER_ADMIN')
      navigate({ name: 'home' })
  }, [authLoaded, user, view, navigate])

  function renderView() {
    switch (view.name) {
      case 'home':
        return <HomePage />
      case 'event-detail':
        return <EventDetail eventId={view.eventId} />
      case 'checkout':
        return (
          <ProtectedGate>
            <Checkout eventId={view.eventId} />
          </ProtectedGate>
        )
      case 'payment':
        return (
          <ProtectedGate>
            <PaymentGateway orderId={view.orderId} />
          </ProtectedGate>
        )
      case 'payment-success':
        return (
          <ProtectedGate>
            <PaymentSuccess orderId={view.orderId} />
          </ProtectedGate>
        )
      case 'my-tickets':
        return (
          <ProtectedGate>
            <MyTickets initialTab={view.tab} />
          </ProtectedGate>
        )
      case 'ticket-detail':
        return (
          <ProtectedGate>
            <TicketDetail ticketId={view.ticketId} />
          </ProtectedGate>
        )
      case 'organizer':
        return (
          <ProtectedGate>
            <OrganizerDashboard initialTab={view.tab} />
          </ProtectedGate>
        )
      case 'admin':
        return (
          <ProtectedGate>
            <AdminDashboard initialTab={view.tab} />
          </ProtectedGate>
        )
      case 'staff':
        return (
          <ProtectedGate>
            <StaffScanner />
          </ProtectedGate>
        )
      default:
        return <HomePage />
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${view.name}-${'eventId' in view ? view.eventId : ''}-${'orderId' in view ? view.orderId : ''}-${'ticketId' in view ? view.ticketId : ''}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {renderView()}
          </motion.div>
        </AnimatePresence>
      </main>
      <Footer />
      <AuthDialog />
      <ProfileDialog />
    </div>
  )
}

export default function Home() {
  return (
    <Providers>
      <AppShell />
    </Providers>
  )
}
