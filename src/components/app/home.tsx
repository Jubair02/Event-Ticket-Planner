'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { paths } from '@/lib/routes'
import { apiGet } from '@/lib/api'
import type { EventListItem } from '@/lib/types'
import { CATEGORIES, CATEGORY_LABELS, CITIES } from '@/lib/constants'
import { EventCard } from '@/components/app/event-card'
import { EmptyState } from '@/components/app/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CalendarSearch, MapPin, Search, Sparkles, Ticket, TrendingUp, X, QrCode, Wallet, ShieldCheck } from 'lucide-react'

function EventsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border">
          <Skeleton className="aspect-[16/9] w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function HomePage({ browseOnly = false }: { browseOnly?: boolean } = {}) {
  const { user, openAuth } = useAppStore()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [city, setCity] = useState<string | null>(null)

  const hasFilters = !!search || !!category || !!city

  const { data, isLoading } = useQuery({
    queryKey: ['events', search, category, city],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (category) params.set('category', category)
      if (city) params.set('city', city)
      return apiGet<{ events: EventListItem[] }>(`/api/events?${params.toString()}`)
    },
  })

  const { data: featuredData, isLoading: featuredLoading } = useQuery({
    queryKey: ['events', 'featured'],
    queryFn: () => apiGet<{ events: EventListItem[] }>('/api/events?featured=true'),
    enabled: !hasFilters,
  })

  const { data: popularData, isLoading: popularLoading } = useQuery({
    queryKey: ['events', 'popular'],
    queryFn: () => apiGet<{ events: EventListItem[] }>('/api/events?sort=popular'),
    enabled: !hasFilters,
  })

  const events = data?.events ?? []
  const featured = (featuredData?.events ?? []).slice(0, 4)
  const popular = (popularData?.events ?? []).slice(0, 4)

  return (
    <div className="flex flex-col">
      {/* HERO — the marketing framing belongs on "/", not on the event index */}
      {!browseOnly && (
      <section className="hero-pattern relative overflow-hidden bg-foreground text-background dark:bg-card">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-chart-5/20 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
          <div className="max-w-2xl">
            <Badge className="mb-4 bg-primary text-primary-foreground hover:bg-primary">
              🇧🇩 Bangladesh&apos;s Event Ticketing Platform
            </Badge>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
              Discover events.
              <br />
              Book tickets.
              <br />
              <span className="text-primary">Scan & go.</span>
            </h1>
            <p className="mt-4 max-w-xl text-base opacity-75 sm:text-lg">
              Concerts, tech summits, food festivals and more — across Dhaka, Chattogram, Sylhet and beyond.
              Pay with SSLCOMMERZ, get your QR e-ticket instantly.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={() => document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth' })}
              >
                <CalendarSearch className="h-5 w-5" /> Explore Events
              </Button>
              {!user && (
                <Button
                  size="lg"
                  variant="outline"
                  className="border-background/30 bg-background/10 text-background hover:bg-background/20 hover:text-background"
                  onClick={() => openAuth('register')}
                >
                  <Sparkles className="h-5 w-5" /> Become an Organizer
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
      )}

      <div className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6">
        {browseOnly && (
          <header className="pt-8">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Browse events</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Every event on TicketBD — filter by city and category.
            </p>
          </header>
        )}
        {/* SEARCH + FILTERS */}
        <section id="explore" className="scroll-mt-20 py-8" aria-label="Search and filters">
          <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search events, venues, artists..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search events"
              />
            </div>
            <div className="flex gap-3">
              <Select value={city ?? 'all'} onValueChange={(v) => setCity(v === 'all' ? null : v)}>
                <SelectTrigger className="w-full sm:w-[170px]" aria-label="Filter by city">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="All Cities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Cities</SelectItem>
                  {CITIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear filters"
                  onClick={() => {
                    setSearch('')
                    setCategory(null)
                    setCity(null)
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Category chips */}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Filter by category">
            <Button
              variant={category === null ? 'default' : 'outline'}
              size="sm"
              className="shrink-0 rounded-full"
              onClick={() => setCategory(null)}
            >
              All
            </Button>
            {CATEGORIES.map((c) => (
              <Button
                key={c}
                variant={category === c ? 'default' : 'outline'}
                size="sm"
                className="shrink-0 rounded-full"
                onClick={() => setCategory(category === c ? null : c)}
              >
                {CATEGORY_LABELS[c].emoji} {CATEGORY_LABELS[c].label}
              </Button>
            ))}
          </div>
        </section>

        {/* FILTERED / ALL RESULTS */}
        <section className="pb-10" aria-label="Events">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
              {hasFilters ? 'Search Results' : 'Upcoming Events'}
            </h2>
            <span className="text-sm text-muted-foreground">{isLoading ? '…' : `${events.length} events`}</span>
          </div>
          {isLoading ? (
            <EventsSkeleton />
          ) : events.length === 0 ? (
            <EmptyState
              icon={CalendarSearch}
              title="No events found"
              description="Try a different search term, category or city — or check back soon for new events."
            />
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {events.map((ev) => (
                <EventCard key={ev.id} event={ev} />
              ))}
            </div>
          )}
        </section>

        {/* FEATURED */}
        {!browseOnly && !hasFilters && (
          <section className="pb-10" aria-label="Featured events">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Featured Events</h2>
            </div>
            {featuredLoading ? (
              <EventsSkeleton count={4} />
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {featured.map((ev) => (
                  <EventCard key={ev.id} event={ev} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* POPULAR */}
        {!browseOnly && !hasFilters && popular.length > 0 && (
          <section className="pb-10" aria-label="Popular events">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">🔥 Selling Fast</h2>
            </div>
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

        {/* HOW IT WORKS */}
        {!browseOnly && !hasFilters && (
          <section className="pb-12" aria-label="How it works">
            <h2 className="mb-6 text-xl font-bold tracking-tight sm:text-2xl">How TicketBD Works</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: CalendarSearch, title: '1. Discover', desc: 'Browse events by city & category, see real-time availability.' },
                { icon: Wallet, title: '2. Book & Pay', desc: 'Pick your ticket type and pay securely via SSLCOMMERZ (bKash, Nagad, Card).' },
                { icon: QrCode, title: '3. Get QR Ticket', desc: 'Your e-ticket with a unique QR code is generated instantly after verified payment.' },
                { icon: ShieldCheck, title: '4. Scan & Enter', desc: 'Staff scans your QR at the gate — duplicate entries are blocked automatically.' },
              ].map((s) => (
                <div key={s.title} className="rounded-xl border bg-card p-5 shadow-sm">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <s.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-3 font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ORGANIZER CTA */}
        {!browseOnly && !hasFilters && (
          <section className="pb-14" aria-label="Organizer call to action">
            <div className="hero-pattern relative overflow-hidden rounded-2xl bg-primary px-6 py-10 text-primary-foreground sm:px-10 sm:py-12">
              <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-2xl font-bold sm:text-3xl">Organizing an event?</h2>
                  <p className="mt-2 max-w-lg text-sm opacity-90 sm:text-base">
                    Create event pages, manage ticket tiers, track sales & check-ins in real time — and get paid
                    through SSLCOMMERZ.
                  </p>
                </div>
                <Button
                  size="lg"
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => (user ? router.push(paths.organizer()) : openAuth('register'))}
                >
                  <Ticket className="h-5 w-5" /> Start Selling Tickets
                </Button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
