'use client'

import { create } from 'zustand'
import type { SafeUser } from '@/lib/types'

/** A ticket selection handed from the event page to checkout. */
export type CheckoutItem = { ticketTypeId: string; quantity: number }

export type View =
  | { name: 'home' }
  | { name: 'event-detail'; eventId: string }
  // `items` carries the selection made on the event page so checkout does not
  // silently discard it and fall back to "1 of the first type".
  | { name: 'checkout'; eventId: string; items?: CheckoutItem[] }
  | { name: 'payment'; orderId: string }
  | { name: 'payment-success'; orderId: string }
  | { name: 'my-tickets'; tab?: 'upcoming' | 'past' | 'cancelled' }
  | { name: 'ticket-detail'; ticketId: string }
  | { name: 'organizer'; tab?: 'overview' | 'events' | 'staff' }
  | { name: 'admin'; tab?: 'overview' | 'organizers' | 'events' | 'users' }
  | { name: 'staff' }

interface AppState {
  user: SafeUser | null
  authLoaded: boolean
  view: View
  authOpen: boolean
  authMode: 'login' | 'register'
  /** Where to go after a successful auth, when it interrupted something. */
  authReturnTo: View | null
  /** Profile is an overlay, not a view — see `setProfileOpen`. */
  profileOpen: boolean
  setUser: (user: SafeUser | null) => void
  setAuthLoaded: (loaded: boolean) => void
  navigate: (view: View) => void
  openAuth: (mode?: 'login' | 'register', returnTo?: View) => void
  setAuthOpen: (open: boolean) => void
  setProfileOpen: (open: boolean) => void
  /** Reads and clears the pending return target. */
  consumeAuthReturnTo: () => View | null
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  authLoaded: false,
  view: { name: 'home' },
  authOpen: false,
  authMode: 'login',
  authReturnTo: null,
  profileOpen: false,
  setUser: (user) => set({ user }),
  setAuthLoaded: (authLoaded) => set({ authLoaded }),
  navigate: (view) => {
    set({ view, authOpen: false, profileOpen: false })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  },
  openAuth: (mode = 'login', returnTo) =>
    set({ authOpen: true, authMode: mode, authReturnTo: returnTo ?? null, profileOpen: false }),
  // Dismissing the dialog drops the pending target, so a later sign-in from the
  // navbar cannot jump into someone else's abandoned checkout.
  setAuthOpen: (authOpen) => set(authOpen ? { authOpen } : { authOpen, authReturnTo: null }),
  /**
   * The profile dialog is overlay state rather than a `View`, so opening it
   * leaves the page underneath mounted and scrolled where it was: dismissing it
   * (X, overlay click, Escape) returns you there instead of to Home.
   *
   * Opening it also dismisses the auth dialog and its pending target; closing
   * it leaves the rest of the store alone.
   */
  setProfileOpen: (profileOpen) =>
    set(profileOpen ? { profileOpen, authOpen: false, authReturnTo: null } : { profileOpen }),
  consumeAuthReturnTo: () => {
    const target = get().authReturnTo
    if (target) set({ authReturnTo: null })
    return target
  },
}))

/** Role-based landing view after login */
export function landingViewForRole(role: string): View {
  switch (role) {
    case 'SUPER_ADMIN':
      return { name: 'admin', tab: 'overview' }
    case 'ORGANIZER':
      return { name: 'organizer', tab: 'overview' }
    case 'EVENT_STAFF':
      return { name: 'staff' }
    default:
      return { name: 'home' }
  }
}
