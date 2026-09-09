'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { Providers, useSessionLoader } from '@/components/app/providers'
import { useAppStore } from '@/lib/store'
import { Navbar } from '@/components/app/navbar'
import { Footer } from '@/components/app/footer'
import { AuthDialog } from '@/components/app/auth-dialog'
import { ProfileDialog } from '@/components/app/profile-dialog'

/**
 * Dismisses the auth and profile overlays whenever the route changes.
 *
 * The old `navigate()` action cleared them as part of every screen change.
 * Doing it here instead covers all the ways a route can change now — a link, a
 * `router.push`, the Back button — rather than only the ones that go through a
 * single function.
 */
function useCloseOverlaysOnNavigate() {
  const pathname = usePathname()
  const closeOverlays = useAppStore((s) => s.closeOverlays)
  const firstRender = useRef(true)

  useEffect(() => {
    // Nothing is open on mount, and closing here would fight a dialog that a
    // page opened during its own first render.
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    closeOverlays()
  }, [pathname, closeOverlays])
}

function Chrome({ children }: { children: React.ReactNode }) {
  // One session fetch for the whole app, rather than per route.
  useSessionLoader()
  useCloseOverlaysOnNavigate()

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
      <AuthDialog />
      <ProfileDialog />
    </div>
  )
}

/**
 * Persistent app frame. Lives in the root layout so navigating between routes
 * keeps the navbar, footer and dialogs mounted — and keeps the TanStack Query
 * cache and session alive across navigations.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Chrome>{children}</Chrome>
    </Providers>
  )
}
