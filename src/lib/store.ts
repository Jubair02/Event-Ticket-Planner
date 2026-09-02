'use client'

import { create } from 'zustand'
import type { SafeUser } from '@/lib/types'

export type View =
  | { name: 'home' }
  | { name: 'event-detail'; eventId: string }
  | { name: 'checkout'; eventId: string }
  | { name: 'payment'; orderId: string }
  | { name: 'payment-success'; orderId: string }
  | { name: 'my-tickets'; tab?: 'upcoming' | 'past' | 'cancelled' }
  | { name: 'ticket-detail'; ticketId: string }
  | { name: 'organizer'; tab?: 'overview' | 'events' | 'staff' }
  | { name: 'admin'; tab?: 'overview' | 'organizers' | 'events' | 'users' }
  | { name: 'staff' }
  | { name: 'profile' }

interface AppState {
  user: SafeUser | null
  authLoaded: boolean
  view: View
  authOpen: boolean
  authMode: 'login' | 'register'
  setUser: (user: SafeUser | null) => void
  setAuthLoaded: (loaded: boolean) => void
  navigate: (view: View) => void
  openAuth: (mode?: 'login' | 'register') => void
  setAuthOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  authLoaded: false,
  view: { name: 'home' },
  authOpen: false,
  authMode: 'login',
  setUser: (user) => set({ user }),
  setAuthLoaded: (authLoaded) => set({ authLoaded }),
  navigate: (view) => {
    set({ view, authOpen: false })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  },
  openAuth: (mode = 'login') => set({ authOpen: true, authMode: mode }),
  setAuthOpen: (authOpen) => set({ authOpen }),
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
