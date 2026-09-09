'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  CalendarSearch,
  Flame,
  LayoutGrid,
  MapPin,
  QrCode,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  Wallet,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { paths } from '@/lib/routes'
import { apiGet } from '@/lib/api'
import { useDebounced } from '@/hooks/use-debounced'
import { cn } from '@/lib/utils'
import type { EventListItem } from '@/lib/types'
import { CATEGORIES, CATEGORY_LABELS, CITIES } from '@/lib/constants'
import { categoryLabel, daysUntil, formatEventDate, formatMinor, formatTime } from '@/lib/format'
import { categoryIcon } from '@/components/app/category-icon'
import { EventCard } from '@/components/app/event-card'
import { EmptyState } from '@/components/app/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useUrlQuery } from '@/components/dashboard/use-url-query'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** One-tap entry points into the catalogue, for people who arrive undecided. */
const QUICK_SEARCHES: Array<{ label: string; category?: string; city?: string }> = [
  { label: 'Concerts in Dhaka', category: 'CONCERT', city: 'Dhaka' },
  { label: 'Tech events', category: 'TECH' },
  { label: 'Food festivals', category: 'FOOD' },
  { label: 'Cox’s Bazar', city: "Cox's Bazar" },
]

export interface HomeFilters {
  q?: string
  city?: string
  category?: string
}

// ─────────────────────────────────────────────────────────── skeletons

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <Skeleton className="aspect-[16/10] w-full rounded-none" />
      <div className="space-y-2.5 p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  )
}

function EventsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────── spotlight

/**
 * The featured treatment: a wide card with the banner behind the copy.
 *
 * Featured events used to render in the same four-up grid as everything else,
 * so "featured" carried no visual weight at all. Two of these, full-bleed
 * image, is what makes the section mean something.
 */
function SpotlightCard({ event }: { event: EventListItem }) {
  const prices = event.ticketTypes?.map((t) => t.priceMinor) ?? []
  const from = prices.length > 0 ? Math.min(...prices) : null
  const when = daysUntil(event.startDate, event.endDate)

  return (
    <Link
      href={paths.event(event)}
      className={cn(
        'group relative flex min-h-[19rem] flex-col justify-end overflow-hidden rounded-2xl',
        'border border-border/70 bg-card shadow-sm transition-all duration-300',
        'hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
      )}
    >
      {event.banner ? (
         
        <img
          src={event.banner}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-primary/10 to-accent" />
      )}

      {/* Two stops rather than one: the copy needs near-black behind it while the
          top of the image stays readable. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/5" />

      <div className="relative space-y-2.5 p-5 text-white sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
          <span className="rounded-full bg-white/15 px-2.5 py-1 backdrop-blur-sm ring-1 ring-inset ring-white/25">
            {categoryLabel(event.category)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-primary-foreground">
            <Sparkles className="size-3" aria-hidden="true" /> Featured
          </span>
          <span className="rounded-full bg-white/15 px-2.5 py-1 backdrop-blur-sm ring-1 ring-inset ring-white/25">
            {when}
          </span>
        </div>

        <h3 className="text-pretty text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
          {event.title}
        </h3>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80">
          <span className="inline-flex items-center gap-1.5">
            <CalendarSearch className="size-3.5" aria-hidden="true" />
            {formatEventDate(event.startDate)} · {formatTime(event.startTime)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3.5" aria-hidden="true" />
            {event.venue}, {event.city}
          </span>
        </p>

        <div className="flex items-center justify-between gap-3 pt-1">
          {from !== null ? (
            <p className="text-sm text-white/70">
              From <span className="text-base font-semibold text-white">{formatMinor(from)}</span>
            </p>
          ) : (
            <p className="text-sm text-white/70">Tickets TBA</p>
          )}
          <span className="inline-flex items-center gap-1 text-sm font-medium text-white">
            View event
            <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
          </span>
        </div>
      </div>
    </Link>
  )
}

// ─────────────────────────────────────────────────────────── section heading

function SectionHeading({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────── page

export function HomePage({
  browseOnly = false,
  initialFilters,
}: {
  browseOnly?: boolean
  /** Read from the query string by the route, so a refresh keeps the search. */
  initialFilters?: HomeFilters
} = {}) {
  const { user, openAuth } = useAppStore()
  const pathname = usePathname()

  const [search, setSearch] = useState(initialFilters?.q ?? '')
  const [category, setCategory] = useState<string | null>(initialFilters?.category ?? null)
  const [city, setCity] = useState<string | null>(initialFilters?.city ?? null)

  // Typing stays local; only the settled value reaches the API and the URL.
  const q = useDebounced(search.trim())
  const hasFilters = !!q || !!category || !!city

  /**
   * Filters live in the address bar, so a refresh, a bookmark or a link shared
   * with a friend all reopen the same result set. Built from `pathname` rather
   * than a fixed route because this component serves both `/` and `/events`.
   */
  const href = useMemo(() => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (city) params.set('city', city)
    if (category) params.set('category', category)
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }, [q, city, category, pathname])
  useUrlQuery(href)

  const { data, isLoading } = useQuery({
    queryKey: ['events', q, category, city],
    queryFn: () => {
      const params = new URLSearchParams()
      if (q) params.set('search', q)
      if (category) params.set('category', category)
      if (city) params.set('city', city)
      return apiGet<{ events: EventListItem[] }>(`/api/events?${params.toString()}`)
    },
  })

  const showDiscovery = !browseOnly && !hasFilters

  const { data: featuredData, isLoading: featuredLoading } = useQuery({
    queryKey: ['events', 'featured'],
    queryFn: () => apiGet<{ events: EventListItem[] }>('/api/events?featured=true'),
    enabled: showDiscovery,
  })

  const { data: popularData, isLoading: popularLoading } = useQuery({
    queryKey: ['events', 'popular'],
    queryFn: () => apiGet<{ events: EventListItem[] }>('/api/events?sort=popular'),
    enabled: showDiscovery,
  })

  const events = data?.events ?? []
  const featured = (featuredData?.events ?? []).slice(0, 2)
  const popular = (popularData?.events ?? []).slice(0, 4)

  function clearFilters() {
    setSearch('')
    setCategory(null)
    setCity(null)
  }

  // ── the search card: the primary call to action on both routes ──
  const searchCard = (
    <div
      className={cn(
        'rounded-2xl border border-border/70 bg-card/95 p-2 shadow-lg shadow-black/5 backdrop-blur',
        'sm:flex sm:items-center sm:gap-2',
      )}
    >
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events, venues or artists"
          aria-label="Search events"
          className="h-12 border-0 bg-transparent pl-10 text-base shadow-none focus-visible:ring-0 md:text-sm"
        />
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-border/70 pt-2 sm:mt-0 sm:border-0 sm:border-l sm:pl-2 sm:pt-0">
        <Select value={city ?? 'all'} onValueChange={(v) => setCity(v === 'all' ? null : v)}>
          <SelectTrigger
            className="h-12 w-full min-w-0 border-0 shadow-none focus-visible:ring-0 sm:w-[168px]"
            aria-label="Filter by city"
          >
            <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <SelectValue placeholder="All cities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All cities</SelectItem>
            {CITIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button asChild size="lg" className="h-12 shrink-0 px-5">
          <a href="#results">
            <Search className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Search</span>
          </a>
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col">
      {/* ───────────────────────── HERO ───────────────────────── */}
      <section
        className={cn(
          'identity-band relative overflow-hidden border-b border-border/70',
          browseOnly ? 'py-8 sm:py-10' : 'py-14 sm:py-20',
        )}
      >
        {/* Ambient depth, built from theme tokens so it holds up in dark mode. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-40 size-[34rem] rounded-full bg-primary/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-48 -left-32 size-[30rem] rounded-full bg-chart-2/10 blur-3xl"
        />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          {browseOnly ? (
            <header className="mb-6 max-w-2xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-primary">
                Every event
              </p>
              <h1 className="mt-1.5 text-3xl font-semibold tracking-tight sm:text-4xl">
                Browse events
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Filter the full TicketBD catalogue by city and category.
              </p>
            </header>
          ) : (
            <header className="mb-7 max-w-3xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
                <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                Bangladesh’s event ticketing platform
              </p>
              <h1 className="mt-4 text-pretty text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
                Find your next night out,
                <br className="hidden sm:block" />{' '}
                <span className="text-primary">book it in seconds.</span>
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
                Concerts, tech summits and food festivals across Dhaka, Chattogram, Sylhet and
                beyond. Pay with bKash, Nagad or card — your QR e-ticket arrives instantly.
              </p>
            </header>
          )}

          {/* Search is the call to action on a marketplace, so it sits in the
              hero rather than below the fold. */}
          <div className="max-w-4xl">{searchCard}</div>

          {!browseOnly && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Popular:</span>
              {QUICK_SEARCHES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setCategory(s.category ?? null)
                    setCity(s.city ?? null)
                  }}
                  className="cursor-pointer rounded-full border border-border/70 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur transition-colors duration-200 hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6">
        {/* ─────────────────── CATEGORY RAIL ─────────────────── */}
        <section className="py-6" aria-label="Filter by category">
          <div className="scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            <CategoryChip
              icon={LayoutGrid}
              label="All"
              active={category === null}
              onClick={() => setCategory(null)}
            />
            {CATEGORIES.map((c) => (
              <CategoryChip
                key={c}
                icon={categoryIcon(c)}
                label={CATEGORY_LABELS[c].label}
                active={category === c}
                onClick={() => setCategory(category === c ? null : c)}
              />
            ))}
          </div>
        </section>

        {/* ─────────────────── RESULTS ─────────────────── */}
        <section id="results" className="scroll-mt-24 pb-12" aria-label="Events">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
                {hasFilters ? 'Search results' : 'Upcoming events'}
              </h2>
              <p className="text-xs text-muted-foreground tabular-nums">
                {isLoading
                  ? 'Searching…'
                  : `${events.length} event${events.length === 1 ? '' : 's'}`}
              </p>
            </div>

            {hasFilters && (
              <div className="flex flex-wrap items-center gap-2">
                {q && <ActiveFilter label={`“${q}”`} onClear={() => setSearch('')} />}
                {city && <ActiveFilter label={city} onClear={() => setCity(null)} />}
                {category && (
                  <ActiveFilter
                    label={CATEGORY_LABELS[category]?.label ?? category}
                    onClear={() => setCategory(null)}
                  />
                )}
                <Button variant="ghost" size="sm" className="h-8" onClick={clearFilters}>
                  Clear all
                </Button>
              </div>
            )}
          </div>

          {isLoading ? (
            <EventsSkeleton />
          ) : events.length === 0 ? (
            <EmptyState
              icon={CalendarSearch}
              title="No events match that search"
              description={
                city || category
                  ? 'Try widening the filters — all cities, or a different category.'
                  : 'Try a different search term, or browse the categories above.'
              }
              action={
                hasFilters ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {events.map((ev, i) => (
                <div
                  key={ev.id}
                  className="animate-in fade-in slide-in-from-bottom-3 fill-mode-backwards duration-300 motion-reduce:animate-none"
                  // A short cascade reads as the grid settling into place; capped
                  // so a long list never feels like it is loading slowly.
                  style={{ animationDelay: `${Math.min(i, 11) * 40}ms` }}
                >
                  <EventCard event={ev} />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─────────────────── SPOTLIGHT ─────────────────── */}
        {showDiscovery && (featuredLoading || featured.length > 0) && (
          <section className="pb-12" aria-label="Featured events">
            <SectionHeading
              icon={Sparkles}
              title="In the spotlight"
              hint="Hand-picked by the TicketBD team"
            />
            {featuredLoading ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <Skeleton className="h-[19rem] rounded-2xl" />
                <Skeleton className="h-[19rem] rounded-2xl" />
              </div>
            ) : (
              <div className="grid gap-5 lg:grid-cols-2">
                {featured.map((ev) => (
                  <SpotlightCard key={ev.id} event={ev} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ─────────────────── SELLING FAST ─────────────────── */}
        {showDiscovery && (popularLoading || popular.length > 0) && (
          <section className="pb-12" aria-label="Popular events">
            <SectionHeading icon={Flame} title="Selling fast" hint="Most tickets sold this week">
              <Button asChild variant="ghost" size="sm" className="h-8">
                <Link href={paths.events()}>
                  See all <ArrowRight className="size-4" />
                </Link>
              </Button>
            </SectionHeading>
            {popularLoading ? (
              <EventsSkeleton count={4} />
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {popular.map((ev) => (
                  <EventCard key={ev.id} event={ev} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ─────────────────── HOW IT WORKS ─────────────────── */}
        {showDiscovery && (
          <section className="pb-12" aria-label="How it works">
            <SectionHeading icon={ShieldCheck} title="How TicketBD works" />
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  {
                    icon: CalendarSearch,
                    title: 'Discover',
                    desc: 'Browse by city and category with live availability on every tier.',
                  },
                  {
                    icon: Wallet,
                    title: 'Book & pay',
                    desc: 'Checkout through SSLCOMMERZ — bKash, Nagad or any card.',
                  },
                  {
                    icon: QrCode,
                    title: 'Get your QR',
                    desc: 'Your e-ticket is issued the moment payment is verified.',
                  },
                  {
                    icon: ShieldCheck,
                    title: 'Scan & enter',
                    desc: 'Staff scan at the gate; duplicate entries are blocked automatically.',
                  },
                ] as const
              ).map((step, i) => (
                <li
                  key={step.title}
                  className="group relative rounded-2xl border border-border/70 bg-card p-5 shadow-sm transition-shadow duration-200 hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <step.icon className="size-5" aria-hidden="true" />
                    </span>
                    <span
                      className="text-2xl font-semibold tabular-nums text-muted-foreground/25"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                  </div>
                  <h3 className="mt-3.5 font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* ─────────────────── ORGANIZER CTA ─────────────────── */}
        {showDiscovery && (
          <section className="pb-14" aria-label="For organizers">
            <div className="hero-pattern relative overflow-hidden rounded-2xl bg-primary px-6 py-10 text-primary-foreground shadow-lg shadow-primary/20 sm:px-10 sm:py-12">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full bg-white/10 blur-3xl"
              />
              <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
                <div className="max-w-xl">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] opacity-80">
                    For organizers
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                    Sell your next event on TicketBD
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed opacity-90 sm:text-base">
                    Build the event page, price your tiers, and watch sales and gate check-ins
                    update in real time. Settlement runs through SSLCOMMERZ.
                  </p>
                </div>
                {user?.role === 'ORGANIZER' ? (
                  <Button asChild size="lg" variant="secondary" className="shrink-0">
                    <Link href={paths.organizer()}>
                      <Ticket className="size-5" /> Go to dashboard
                    </Link>
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => openAuth('register')}
                  >
                    <Ticket className="size-5" /> Start selling tickets
                  </Button>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────── small parts

function CategoryChip({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // 44px tall: comfortably above the minimum touch target on the rail.
        'inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium',
        'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/25'
          : 'border-border/70 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </button>
  )
}

function ActiveFilter({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-full border border-border/70 bg-muted/60 pl-3 pr-1 text-xs font-medium">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove filter ${label}`}
        className="flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  )
}
