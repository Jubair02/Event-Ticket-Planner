'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface DashboardNavItem {
  href: string
  label: string
  /** Shown as a small pill when > 0 — e.g. items awaiting review. */
  count?: number
  /**
   * Match the path exactly instead of by prefix. Set on section roots
   * (`/organizer`, `/admin`), which are a prefix of every other item.
   */
  exact?: boolean
}

/** Strips any query string, so `/admin/events?status=…` still matches `/admin/events`. */
function basePath(href: string): string {
  const q = href.indexOf('?')
  return q === -1 ? href : href.slice(0, q)
}

function isActive(pathname: string, item: DashboardNavItem): boolean {
  const base = basePath(item.href)
  if (item.exact) return pathname === base
  return pathname === base || pathname.startsWith(`${base}/`)
}

/**
 * The frame both dashboards share: a textured header band with the title and
 * role, an optional notice, an underline nav rail on the band's bottom edge,
 * then the content.
 *
 * The rail used to be a Radix `Tabs` list whose panels lived in the same
 * component. It is a set of real links now, and `children` is whatever page
 * the router matched — so each section has its own URL, its own metadata, and
 * survives a refresh. The band reuses `.identity-band` (also behind the
 * profile dialog) so the signed-in surfaces of the app carry one visual
 * identity.
 */
export function DashboardShell({
  eyebrow,
  title,
  subtitle,
  nav,
  notice,
  actions,
  children,
}: {
  eyebrow: string
  title: string
  subtitle: string
  nav: DashboardNavItem[]
  notice?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="pb-16">
      <header className="identity-band border-b border-border/70">
        <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 sm:pt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-[0.14em] text-primary uppercase">{eyebrow}</p>
              <h1 className="mt-1.5 text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
              <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{subtitle}</p>
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
          </div>

          {notice && <div className="mt-5">{notice}</div>}

          {/* Underline rail on the band's bottom edge. Same look the tab list had,
              now built from links so each section is addressable. */}
          <nav
            className="mt-6 -mb-px flex w-full items-center justify-start gap-1 overflow-x-auto"
            aria-label={`${title} sections`}
          >
            {nav.map((item) => {
              const active = isActive(pathname, item)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex flex-none items-center border-b-2 border-transparent px-3 pt-1 pb-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors',
                    'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm',
                    active && 'border-primary text-foreground',
                  )}
                >
                  {item.label}
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span
                      className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-chart-5/25 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground"
                      aria-label={`${item.count} waiting`}
                    >
                      {item.count}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6">{children}</div>
    </div>
  )
}
