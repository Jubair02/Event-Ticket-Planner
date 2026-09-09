'use client'

import { useEffect, useRef } from 'react'

/**
 * Mirrors a section's filter state into the address bar.
 *
 * The dashboards' filters used to live in the parent component because Radix
 * unmounted inactive tabs and lost them. Each section is a route now, so the
 * filters live in the query string instead: a refresh, a bookmark or a link
 * shared with a colleague all reopen the same view.
 *
 * Two deliberate choices:
 *
 *  - `history.replaceState`, not `router.replace`: the table data comes from
 *    client-side queries, so there is nothing for the server to re-render, and
 *    replaceState skips that round trip. Next.js integrates these native calls
 *    into its own router, so `usePathname`/`useSearchParams` stay in sync.
 *  - replace rather than push: Back should leave the section, not walk backwards
 *    through every chip the admin clicked on the way here.
 */
export function useUrlQuery(href: string) {
  const firstRender = useRef(true)

  useEffect(() => {
    // The URL already says this on arrival; writing it again would be a no-op
    // that also stamps over a `?q=` the server rendered from.
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (typeof window === 'undefined') return
    const current = `${window.location.pathname}${window.location.search}`
    if (current !== href) window.history.replaceState(null, '', href)
  }, [href])
}
