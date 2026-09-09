'use client'

import { create } from 'zustand'
import type { SafeUser } from '@/lib/types'

/** Re-exported for the components that imported it from here. */
export type { CheckoutItem } from '@/lib/types'

/**
 * Session and overlay state.
 *
 * Navigation used to live here too, as a `View` union plus a `navigate` action
 * that a bridge translated into URLs. The router owns navigation now — see
 * `@/lib/routes` for the paths and `next/link` / `useRouter` at the call sites
 * — so this store is only what the URL cannot express: who is signed in, and
 * which overlay is open.
 */
interface AppState {
  user: SafeUser | null
  authLoaded: boolean
  authOpen: boolean
  authMode: 'login' | 'register'
  /** Path to resume after a successful auth, when it interrupted something. */
  authReturnTo: string | null
  /** Profile is an overlay, not a route — see `setProfileOpen`. */
  profileOpen: boolean
  setUser: (user: SafeUser | null) => void
  setAuthLoaded: (loaded: boolean) => void
  openAuth: (mode?: 'login' | 'register', returnTo?: string) => void
  setAuthOpen: (open: boolean) => void
  setProfileOpen: (open: boolean) => void
  /** Dismisses both overlays. Called on every route change. */
  closeOverlays: () => void
  /** Reads and clears the pending return path. */
  consumeAuthReturnTo: () => string | null
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  authLoaded: false,
  authOpen: false,
  authMode: 'login',
  authReturnTo: null,
  profileOpen: false,
  setUser: (user) => set({ user }),
  setAuthLoaded: (authLoaded) => set({ authLoaded }),
  openAuth: (mode = 'login', returnTo) =>
    set({ authOpen: true, authMode: mode, authReturnTo: returnTo ?? null, profileOpen: false }),
  // Dismissing the dialog drops the pending target, so a later sign-in from the
  // navbar cannot jump into someone else's abandoned checkout.
  setAuthOpen: (authOpen) => set(authOpen ? { authOpen } : { authOpen, authReturnTo: null }),
  /**
   * The profile dialog is overlay state rather than a route, so opening it
   * leaves the page underneath mounted and scrolled where it was: dismissing it
   * (X, overlay click, Escape) returns you there instead of to Home.
   *
   * Opening it also dismisses the auth dialog and its pending target; closing
   * it leaves the rest of the store alone.
   */
  setProfileOpen: (profileOpen) =>
    set(profileOpen ? { profileOpen, authOpen: false, authReturnTo: null } : { profileOpen }),
  closeOverlays: () => set({ authOpen: false, profileOpen: false }),
  consumeAuthReturnTo: () => {
    const target = get().authReturnTo
    if (target) set({ authReturnTo: null })
    return target
  },
}))
