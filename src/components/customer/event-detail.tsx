'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  CalendarX,
  Check,
  ChevronDown,
  ExternalLink,
  Info,
  Lock,
  MapPin,
  Minus,
  Plus,
  QrCode,
  Receipt,
  RefreshCw,
  Share2,
  ShieldCheck,
  Ticket as TicketIcon,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { apiGet } from '@/lib/api'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { paths } from '@/lib/routes'
import type { CheckoutItem } from '@/lib/types'
import { categoryLabel, daysUntil, formatMinor, formatEventDate, formatTime } from '@/lib/format'
import { orderTotals } from '@/lib/money'
import type { EventDetail as EventDetailDTO } from '@/lib/types'
import { ticketWindow } from '@/lib/ticket-window'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CategoryIcon } from '@/components/app/category-icon'
import { EmptyState } from '@/components/app/empty-state'
import { cn } from '@/lib/utils'
import { safeHttpUrl } from '@/lib/url'

/** Descriptions longer than this collapse behind a "Read more" fade. */
const LONG_DESCRIPTION = 900

/**
 * Tone for the countdown badge. Red is reserved for genuinely time-critical
 * events — a routine "12 days left" previously used the same alarm colour as a
 * cancelled ticket, which spent the urgency signal on nothing.
 */
type DateTone = 'ended' | 'live' | 'urgent' | 'neutral'

function dateTone(label: string): DateTone {
  if (label === 'Ended') return 'ended'
  if (label === 'Happening now') return 'live'
  if (label === 'Today' || label === 'Tomorrow') return 'urgent'
  return 'neutral'
}

/**
 * Badge tones for the hero, which sits on an arbitrary organizer photo — so
 * every tone brings its own backing rather than inheriting the page surface.
 */
const DATE_TONE_CLASS: Record<DateTone, string> = {
  ended: 'border-white/20 bg-black/40 text-white/70 backdrop-blur-md hover:bg-black/40',
  live: 'border-transparent bg-primary text-primary-foreground hover:bg-primary',
  urgent: 'border-transparent bg-destructive text-white hover:bg-destructive',
  neutral: 'border-transparent bg-white/90 text-neutral-900 backdrop-blur-md hover:bg-white/90',
}

/** Glass chip shared by the hero's back and share controls. */
const HERO_CONTROL =
  'inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-white/20 bg-black/35 px-3.5 text-sm font-medium text-white backdrop-blur-md transition-colors duration-200 hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80'

/**
 * The real start moment: the calendar day comes from `startDate`, the clock
 * time from the separate `startTime` column.
 *
 * Combining the two is what the rest of the UI already prints ("Fri, 20 Feb
 * 2026 · 6:00 PM"), so the countdown agrees with the stated time instead of
 * counting down to midnight on the day.
 */
function startMoment(startDate: string, startTime: string): Date {
  const d = new Date(startDate)
  const [h, m] = startTime.split(':').map(Number)
  if (Number.isFinite(h) && Number.isFinite(m)) d.setHours(h, m, 0, 0)
  return d
}

function countdownParts(target: Date, now: number) {
  const ms = target.getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  const minutes = Math.floor(ms / 60_000)
  return {
    days: Math.floor(minutes / 1440),
    hours: Math.floor((minutes % 1440) / 60),
    minutes: minutes % 60,
  }
}

/** Cheapest ticket, for the "From ৳x" price anchor. */
function fromPriceMinor(event: EventDetailDTO): number | null {
  if (event.ticketTypes.length === 0) return null
  return Math.min(...event.ticketTypes.map((t) => t.priceMinor))
}

// ─────────────────────────────────────────────────────────── countdown

/** How often the wall clock is sampled. */
const CLOCK_POLL_MS = 10_000

function subscribeClock(onStoreChange: () => void) {
  const id = window.setInterval(onStoreChange, CLOCK_POLL_MS)
  return () => window.clearInterval(id)
}

/**
 * The clock, rounded up to the minute the countdown actually displays.
 *
 * `useSyncExternalStore` compares snapshots to decide whether to re-render, so
 * a raw `Date.now()` would be a new value on every call. Quantising makes the
 * snapshot stable between minutes: the tiles repaint when a digit changes and
 * not on the eight polls in between. Rounding *up* keeps the number
 * conservative — it never claims more time than is left.
 */
function clockSnapshot(): number {
  return Math.ceil(Date.now() / 60_000) * 60_000
}

/** Zero stands for "the clock is not readable yet", i.e. on the server. */
function serverClockSnapshot(): number {
  return 0
}

/** Days / hours / minutes until doors, as a row of glass tiles. */
function Countdown({ target }: { target: Date }) {
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, serverClockSnapshot)

  if (now === 0) return null
  const parts = countdownParts(target, now)
  if (!parts) return null

  const units = [
    { key: 'd', value: parts.days, label: parts.days === 1 ? 'day' : 'days' },
    { key: 'h', value: parts.hours, label: parts.hours === 1 ? 'hour' : 'hours' },
    { key: 'm', value: parts.minutes, label: parts.minutes === 1 ? 'min' : 'mins' },
    // A leading "00 days" costs a tile and says nothing.
  ].filter((u) => !(u.key === 'd' && u.value === 0))

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">
        Starts in
      </p>
      <div
        role="group"
        aria-label={`Starts in ${units.map((u) => `${u.value} ${u.label}`).join(', ')}`}
        className="flex items-stretch gap-2"
      >
        {units.map((u) => (
          <div
            key={u.key}
            aria-hidden="true"
            className="min-w-[3.5rem] rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-center backdrop-blur-md"
          >
            <span className="block text-xl font-semibold leading-none text-white tabular-nums">
              {String(u.value).padStart(2, '0')}
            </span>
            <span className="mt-1 block text-[10px] font-medium uppercase tracking-wider text-white/65">
              {u.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────── small parts

function SectionHeading({
  icon: Icon,
  id,
  title,
  hint,
}: {
  icon: LucideIcon
  id?: string
  title: string
  hint?: string
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight sm:text-xl">
          {title}
        </h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}

function FactTile({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3.5 border-t border-border/70 pt-5 first:border-t-0 first:pt-0 sm:border-t-0 sm:pt-0 sm:pl-6 sm:first:pl-0">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary inset-ring inset-ring-primary/15">
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </dt>
        <dd className="mt-1.5 space-y-0.5">{children}</dd>
      </div>
    </div>
  )
}

/** What a buyer wants confirmed before they reach for a card. */
const ASSURANCES: Array<{ icon: LucideIcon; title: string; desc: string }> = [
  {
    icon: ShieldCheck,
    title: 'Secure payment',
    desc: 'Processed by SSLCOMMERZ — card details never touch TicketBD.',
  },
  {
    icon: QrCode,
    title: 'Instant e-ticket',
    desc: 'Your QR is issued the moment payment is verified.',
  },
  {
    icon: Wallet,
    title: 'Pay your way',
    desc: 'bKash, Nagad or any Visa, Mastercard and Amex card.',
  },
]

function Assurances() {
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {ASSURANCES.map((a) => (
        <li
          key={a.title}
          className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <a.icon className="size-[18px]" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-sm font-semibold tracking-tight">{a.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.desc}</p>
        </li>
      ))}
    </ul>
  )
}

function DetailSkeleton() {
  return (
    <div>
      <Skeleton className="h-[24rem] w-full rounded-none sm:h-[27rem] lg:h-[30rem]" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Skeleton className="relative z-10 -mt-12 h-32 w-full rounded-3xl sm:-mt-16" />
        <div className="mt-10 grid gap-10 lg:grid-cols-3 lg:gap-12">
          <div className="space-y-8 lg:col-span-2">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-72 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-[26rem] w-full rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────── page

export function EventDetail({ eventId }: { eventId: string }) {
  const { openAuth, user } = useAppStore()
  const router = useRouter()
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [descOpen, setDescOpen] = useState(false)

  const query = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => apiGet<{ event: EventDetailDTO }>(`/api/events/${eventId}`),
  })
  const event = query.data?.event

  /**
   * Chosen tickets, clamped to what is still on sale. Clamping here (rather than
   * only in the +/- handler) keeps the totals honest if inventory shrinks under
   * a stale selection after a refetch.
   */
  const picked = useMemo(() => {
    if (!event) return []
    return event.ticketTypes
      .map((t) => {
        const win = ticketWindow(t)
        const qty = win.purchasable ? Math.min(selected[t.id] ?? 0, win.max) : 0
        return { t, qty }
      })
      .filter((row) => row.qty > 0)
  }, [event, selected])

  const totalQty = picked.reduce((acc, r) => acc + r.qty, 0)
  // The same helper the order route uses server-side, so the total quoted here
  // is the total that gets stored, fee rounding included.
  const {
    subtotalMinor,
    platformFeeMinor: feeMinor,
    totalMinor,
  } = orderTotals(picked.map((r) => ({ unitPriceMinor: r.t.priceMinor, quantity: r.qty })))

  function changeQty(typeId: string, delta: number) {
    if (!event) return
    const t = event.ticketTypes.find((x) => x.id === typeId)
    if (!t) return
    const win = ticketWindow(t)
    setSelected((prev) => {
      if (!win.purchasable) return { ...prev, [typeId]: 0 }
      const next = Math.min(Math.max(0, (prev[typeId] ?? 0) + delta), Math.max(0, win.max))
      return { ...prev, [typeId]: next }
    })
  }

  function handleBuy() {
    const items: CheckoutItem[] = picked.map((r) => ({ ticketTypeId: r.t.id, quantity: r.qty }))
    if (items.length === 0) return
    // Carry the selection through in the URL, so checkout shows what was
    // actually chosen — and still shows it after a refresh.
    const target = paths.checkout(eventId, items)
    if (!user) {
      // Come back here after signing in instead of landing on the homepage.
      openAuth('login', target)
      return
    }
    router.push(target)
  }

  async function handleShare() {
    if (!event) return
    const url = window.location.href
    // The native sheet where the platform has one, clipboard everywhere else.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: event.title,
          text: `${event.title} — ${formatEventDate(event.startDate)}`,
          url,
        })
      } catch {
        // A dismissed share sheet rejects; that is not a failure to report.
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Event link copied')
    } catch {
      toast.error('Could not copy the link')
    }
  }

  if (query.isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <EmptyState
          icon={CalendarX}
          title="We couldn't load this event"
          description="It may have been removed, or the connection dropped on the way."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => query.refetch()} disabled={query.isFetching}>
                <RefreshCw className={cn('size-4', query.isFetching && 'animate-spin')} />
                {query.isFetching ? 'Retrying…' : 'Try again'}
              </Button>
              <Button variant="outline" onClick={() => router.push(paths.events())}>
                <ArrowLeft className="size-4" /> Back to events
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  if (query.isLoading || !event) return <DetailSkeleton />

  const dateLabel = daysUntil(event.startDate, event.endDate)
  const tone = dateTone(dateLabel)
  const mapHref = safeHttpUrl(event.mapUrl)
  const hasTickets = event.ticketTypes.length > 0
  const fromMinor = fromPriceMinor(event)
  const ctaLabel = user ? 'Continue to checkout' : 'Sign in to continue'
  const startsAt = startMoment(event.startDate, event.startTime)

  const paragraphs = event.description
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
  // A wall of text is the anti-pattern; a fade plus one control is the fix.
  const longDescription = event.description.length > LONG_DESCRIPTION

  // Rendered twice (sticky on desktop, inline on mobile). Both copies use
  // display:none at the other breakpoint, so only one is ever exposed to AT.
  const summaryBody = (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/35 px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Receipt className="size-[18px]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight">Order summary</h2>
            <p className="truncate text-[11px] text-muted-foreground tabular-nums">
              {totalQty > 0
                ? `${totalQty} ticket${totalQty === 1 ? '' : 's'} selected`
                : 'Nothing selected yet'}
            </p>
          </div>
        </div>
        {fromMinor !== null && (
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              From
            </p>
            <p className="text-sm font-semibold tabular-nums">{formatMinor(fromMinor)}</p>
          </div>
        )}
      </div>

      <div className="px-5 py-5">
        {picked.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/25 px-4 py-6 text-center">
            <TicketIcon className="mx-auto size-5 text-muted-foreground/60" aria-hidden="true" />
            <p className="mt-2 text-sm text-muted-foreground">
              {hasTickets ? 'Pick a ticket to see your total.' : 'No tickets are on sale yet.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5 text-sm">
            {picked.map(({ t, qty }) => (
              <li key={t.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">
                  <span className="font-medium tabular-nums">{qty}</span>
                  <span className="text-muted-foreground"> × </span>
                  {t.name}
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatMinor(qty * t.priceMinor)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <dl className="mt-5 space-y-2 border-t border-border/70 pt-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              Tickets <span className="tabular-nums">({totalQty})</span>
            </dt>
            <dd className="tabular-nums">{formatMinor(subtotalMinor)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Platform fee (3%)</dt>
            <dd className="tabular-nums">{formatMinor(feeMinor)}</dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-border/70 pt-3">
            <dt className="text-sm font-semibold">Total</dt>
            <dd className="text-xl font-semibold tracking-tight text-primary tabular-nums">
              {formatMinor(totalMinor)}
            </dd>
          </div>
        </dl>

        <Button
          className="mt-5 h-12 w-full text-[15px] shadow-sm transition-transform active:scale-[0.99] motion-reduce:transform-none"
          onClick={handleBuy}
          disabled={totalQty === 0}
        >
          <TicketIcon className="size-4" /> {ctaLabel}
        </Button>

        <ul className="mt-4 space-y-1.5 rounded-xl bg-muted/40 p-3">
          <li className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Lock className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            Secure checkout via SSLCOMMERZ
          </li>
          <li className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <QrCode className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            QR e-ticket issued instantly
          </li>
          <li className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Wallet className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            bKash, Nagad or any card
          </li>
        </ul>
      </div>
    </>
  )

  return (
    <div className="pb-32 lg:pb-16">
      {/* ═══════════════════════ HERO ═══════════════════════ */}
      <header className="relative isolate flex min-h-[24rem] w-full flex-col justify-end overflow-hidden bg-muted sm:min-h-[27rem] lg:min-h-[30rem]">
        {event.banner ? (
          <img
            src={event.banner}
            alt={`${event.title} event banner`}
            className="absolute inset-0 size-full object-cover"
            decoding="async"
          />
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-br from-primary/55 via-primary/25 to-accent"
          >
            {/* The dot grid rides on its own layer. `.hero-pattern` is
                unlayered CSS, so its background-image outranks any Tailwind
                gradient on the same element and would erase it. */}
            <div className="hero-pattern absolute inset-0" />
            <CategoryIcon
              category={event.category}
              className="absolute -bottom-10 -right-8 size-72 text-white/10"
            />
          </div>
        )}

        {/* Two scrims rather than one. The vertical stop keeps the title on
            near-black; the horizontal one holds the left edge down when the
            organizer's photo is brightest exactly where the copy sits. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/55 to-black/25"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-black/55 via-transparent to-transparent"
        />

        {/* ── hero controls ── */}
        <div className="absolute inset-x-0 top-0 z-10 mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => router.push(paths.events())}
              className={HERO_CONTROL}
              aria-label="Back to all events"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">All events</span>
            </button>
            <button
              type="button"
              onClick={handleShare}
              className={HERO_CONTROL}
              aria-label="Share this event"
            >
              <Share2 className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Share</span>
            </button>
          </div>
        </div>

        {/* ── hero copy ── */}
        <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-24 pt-28 sm:px-6 sm:pb-32">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="gap-1.5 border-white/20 bg-white/12 text-white backdrop-blur-md hover:bg-white/12">
              <CategoryIcon category={event.category} className="size-3" />
              {categoryLabel(event.category)}
            </Badge>
            {event.featured && (
              <Badge className="border-transparent bg-primary text-primary-foreground hover:bg-primary">
                Featured
              </Badge>
            )}
            <Badge className={DATE_TONE_CLASS[tone]}>
              {tone === 'live' && (
                <span className="relative mr-1 flex size-1.5" aria-hidden="true">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-70 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-current" />
                </span>
              )}
              {dateLabel}
            </Badge>
          </div>

          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/65">
            Presented by {event.organizer.organizationName}
          </p>
          <h1 className="mt-2 max-w-4xl text-pretty text-3xl font-semibold leading-[1.06] tracking-tight text-white drop-shadow-sm sm:text-5xl lg:text-6xl">
            {event.title}
          </h1>

          <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-5">
            <Countdown target={startsAt} />

            {hasTickets && (
              <div className="flex items-end gap-4">
                {fromMinor !== null && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">
                      From
                    </p>
                    <p className="text-2xl font-semibold leading-none text-white tabular-nums">
                      {formatMinor(fromMinor)}
                    </p>
                  </div>
                )}
                <Button asChild size="lg" className="group h-12 px-6 text-[15px] shadow-lg">
                  <a href="#tickets">
                    <TicketIcon className="size-4" aria-hidden="true" /> Get tickets
                    <ArrowRight
                      className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                      aria-hidden="true"
                    />
                  </a>
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* ═══════════════════════ FACTS ═══════════════════════ */}
        <section className="relative z-10 -mt-12 sm:-mt-16" aria-label="Event details">
          {/* `inset-ring`, not `ring-inset` — the latter is a Tailwind v3 name
              that compiles to nothing in v4. The hairline is what separates
              this card from the banner it overlaps. */}
          <div className="rounded-3xl border border-border/70 bg-card/95 p-5 shadow-2xl shadow-primary/[0.07] inset-ring inset-ring-white/50 backdrop-blur-xl sm:p-6 dark:inset-ring-white/5">
            <dl className="grid gap-5 sm:grid-cols-3 sm:divide-x sm:divide-border/70">
              <FactTile icon={CalendarDays} label="When">
                <p className="text-sm font-semibold">{formatEventDate(event.startDate)}</p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {formatTime(event.startTime)}
                  {event.endTime ? ` – ${formatTime(event.endTime)}` : ''}
                </p>
              </FactTile>

              <FactTile icon={MapPin} label="Where">
                <p className="text-sm font-semibold">{event.venue}</p>
                <p className="text-sm text-muted-foreground">
                  {event.address}, {event.city}
                </p>
                {mapHref && (
                  <a
                    href={mapHref}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded text-sm font-medium text-primary underline-offset-4 transition-colors duration-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    View on map <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                )}
              </FactTile>

              <FactTile icon={Building2} label="Organizer">
                <p className="text-sm font-semibold">{event.organizer.organizationName}</p>
                {event.organizer.user?.name && (
                  <p className="text-sm text-muted-foreground">
                    Hosted by {event.organizer.user.name}
                  </p>
                )}
              </FactTile>
            </dl>
          </div>
        </section>

        <div className="mt-10 grid gap-10 lg:grid-cols-3 lg:gap-12">
          {/* ═══════════════════ MAIN COLUMN ═══════════════════ */}
          <div className="space-y-10 lg:col-span-2">
            {/* ── about ── */}
            <section
              aria-labelledby="about-heading"
              className="animate-in fade-in slide-in-from-bottom-3 fill-mode-backwards duration-500 motion-reduce:animate-none"
            >
              <SectionHeading
                icon={Info}
                id="about-heading"
                title="About this event"
                hint={`${categoryLabel(event.category)} · ${event.city}`}
              />
              <div className="relative">
                <div
                  id="about-body"
                  className={cn(
                    'max-w-[68ch] space-y-4 text-[15px] leading-relaxed text-muted-foreground',
                    longDescription && !descOpen && 'max-h-72 overflow-hidden',
                  )}
                >
                  {paragraphs.map((p, i) => (
                    <p
                      key={i}
                      className={cn(
                        'text-pretty',
                        // The opening paragraph carries the pitch, so it gets
                        // the weight a lead paragraph earns.
                        i === 0 && 'text-base text-foreground/85 sm:text-[17px]',
                      )}
                    >
                      {p}
                    </p>
                  ))}
                </div>
                {longDescription && !descOpen && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background via-background/85 to-transparent"
                  />
                )}
              </div>
              {longDescription && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3 -ml-2 cursor-pointer text-primary hover:text-primary"
                  onClick={() => setDescOpen((v) => !v)}
                  aria-expanded={descOpen}
                  aria-controls="about-body"
                >
                  {descOpen ? 'Show less' : 'Read more'}
                  <ChevronDown
                    className={cn(
                      'size-4 transition-transform duration-200 motion-reduce:transition-none',
                      descOpen && 'rotate-180',
                    )}
                    aria-hidden="true"
                  />
                </Button>
              )}
            </section>

            {/* ── tickets ── */}
            <section
              id="tickets"
              aria-labelledby="tickets-heading"
              className="scroll-mt-24 animate-in fade-in slide-in-from-bottom-3 fill-mode-backwards duration-500 motion-reduce:animate-none"
              style={{ animationDelay: '80ms' }}
            >
              <SectionHeading
                icon={TicketIcon}
                id="tickets-heading"
                title="Tickets"
                hint={hasTickets ? 'Prices include VAT where applicable' : undefined}
              />

              {!hasTickets ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/25 px-6 py-12 text-center">
                  <TicketIcon
                    className="mx-auto size-6 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                  <p className="mt-3 text-sm font-medium">No tickets on sale yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The organizer hasn&apos;t opened sales. Check back soon.
                  </p>
                </div>
              ) : (
                /* One grouped surface with dividers rather than a stack of
                   identical cards, so the ticket list reads as a single
                   priced menu and stays distinct from the facts panel. */
                <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/35 px-4 py-2.5 sm:px-5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Ticket type
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Price &amp; quantity
                    </span>
                  </div>

                  <ul className="divide-y divide-border/70">
                    {event.ticketTypes.map((t) => {
                      const win = ticketWindow(t)
                      const qty = selected[t.id] ?? 0
                      const pct =
                        t.totalQuantity > 0
                          ? Math.min(100, Math.round((t.soldQuantity / t.totalQuantity) * 100))
                          : 0
                      const lowStock =
                        win.available > 0 &&
                        win.available <= Math.max(5, Math.ceil(t.totalQuantity * 0.1))
                      const atMax = qty >= win.max && win.max > 0

                      return (
                        <li
                          key={t.id}
                          className={cn(
                            'relative p-4 transition-colors duration-200 sm:p-5',
                            qty > 0 ? 'bg-primary/[0.05]' : 'hover:bg-muted/30',
                            !win.purchasable && 'opacity-65',
                          )}
                        >
                          {/* Selected marker: not colour-only, paired with the
                              "n selected" chip, the row's line total and the
                              order summary. */}
                          {qty > 0 && (
                            <span
                              className="absolute inset-y-0 left-0 w-[3px] bg-primary"
                              aria-hidden="true"
                            />
                          )}

                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-[15px] font-semibold tracking-tight">
                                  {t.name}
                                </h3>
                                {win.soldOut ? (
                                  <Badge variant="secondary">Sold out</Badge>
                                ) : win.closed ? (
                                  <Badge variant="secondary">Sales closed</Badge>
                                ) : win.notOpen ? (
                                  <Badge variant="secondary">Not yet on sale</Badge>
                                ) : null}
                                {qty > 0 && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                    <Check className="size-3" aria-hidden="true" />
                                    <span className="tabular-nums">{qty}</span> selected
                                  </span>
                                )}
                              </div>

                              {t.description && (
                                <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                                  {t.description}
                                </p>
                              )}

                              {t.totalQuantity > 0 && (
                                <div className="flex items-center gap-2.5">
                                  <div
                                    className="h-1 w-24 overflow-hidden rounded-full bg-muted"
                                    role="img"
                                    aria-label={`${pct}% of ${t.name} tickets sold`}
                                  >
                                    <div
                                      className={cn(
                                        'h-full rounded-full transition-[width] duration-300',
                                        pct >= 80 ? 'bg-chart-5' : 'bg-primary/70',
                                      )}
                                      style={{ width: `${Math.max(pct, 2)}%` }}
                                    />
                                  </div>
                                  <span
                                    className={cn(
                                      'text-xs tabular-nums',
                                      lowStock
                                        ? 'font-semibold text-destructive'
                                        : 'text-muted-foreground',
                                    )}
                                  >
                                    {win.soldOut
                                      ? 'Sold out'
                                      : lowStock
                                        ? `Only ${win.available} left`
                                        : `${win.available} of ${t.totalQuantity} left`}
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className="flex items-end justify-between gap-4 sm:min-w-[11.5rem] sm:flex-col sm:items-end">
                              <div className="sm:text-right">
                                <p className="text-xl font-semibold tracking-tight tabular-nums">
                                  {formatMinor(t.priceMinor)}
                                </p>
                                {qty > 0 && (
                                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                                    {qty} × {formatMinor(t.priceMinor)} ={' '}
                                    <span className="font-medium text-foreground">
                                      {formatMinor(qty * t.priceMinor)}
                                    </span>
                                  </p>
                                )}
                              </div>

                              {win.purchasable && (
                                <div className="flex flex-col items-end gap-1.5">
                                  {/* 44px targets on touch, tightened on pointer
                                      devices — these controls change the price. */}
                                  <div className="flex items-center gap-1 rounded-full border border-border/80 bg-background p-1 shadow-sm">
                                    <button
                                      type="button"
                                      disabled={qty === 0}
                                      onClick={() => changeQty(t.id, -1)}
                                      aria-label={`Remove one ${t.name} ticket (currently ${qty})`}
                                      className="flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent motion-reduce:transform-none sm:size-9"
                                    >
                                      <Minus className="size-4" aria-hidden="true" />
                                    </button>
                                    <span
                                      className="w-7 text-center text-base font-semibold tabular-nums"
                                      aria-hidden="true"
                                    >
                                      {qty}
                                    </span>
                                    <button
                                      type="button"
                                      disabled={atMax}
                                      onClick={() => changeQty(t.id, 1)}
                                      aria-label={`Add one ${t.name} ticket (currently ${qty})`}
                                      className="flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent motion-reduce:transform-none sm:size-9"
                                    >
                                      <Plus className="size-4" aria-hidden="true" />
                                    </button>
                                  </div>
                                  {/* Always visible: this was hidden below sm, so
                                      on a phone the + button simply stopped
                                      responding with no explanation. */}
                                  <p className="text-xs text-muted-foreground tabular-nums">
                                    {atMax
                                      ? `Limit ${win.max} per order`
                                      : `Up to ${win.max} per order`}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </section>

            {/* Single live region for the whole page, so quantity changes are
                announced as a meaningful total rather than a bare number. */}
            <p className="sr-only" role="status" aria-live="polite">
              {totalQty === 0
                ? 'No tickets selected.'
                : `${totalQty} ticket${totalQty === 1 ? '' : 's'} selected. Total ${formatMinor(totalMinor)}.`}
            </p>

            {/* Mobile summary: the fee breakdown used to be desktop-only */}
            {hasTickets && (
              <div
                className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm lg:hidden"
                aria-label="Order summary"
              >
                {summaryBody}
              </div>
            )}

            {/* ── assurances ── */}
            <section
              aria-label="Booking with confidence"
              className="animate-in fade-in slide-in-from-bottom-3 fill-mode-backwards duration-500 motion-reduce:animate-none"
              style={{ animationDelay: '160ms' }}
            >
              <SectionHeading icon={ShieldCheck} title="Booking with confidence" />
              <Assurances />
            </section>
          </div>

          {/* ═══════════════ DESKTOP STICKY SUMMARY ═══════════════ */}
          <aside className="hidden lg:block" aria-label="Order summary">
            <div className="sticky top-24 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xl shadow-primary/[0.06]">
              {summaryBody}
            </div>
          </aside>
        </div>
      </div>

      {/* ═══════════════════ MOBILE STICKY BAR ═══════════════════ */}
      {hasTickets && (
        <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
          {/* Fades the page out under the bar instead of cutting it off. */}
          <div aria-hidden="true" className="h-5 bg-gradient-to-t from-background to-transparent" />
          <div className="border-t border-border/70 bg-background/95 backdrop-blur">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold tracking-tight tabular-nums">
                  {totalQty > 0 ? formatMinor(totalMinor) : 'No tickets selected'}
                </p>
                <p className="truncate text-xs text-muted-foreground tabular-nums">
                  {totalQty > 0
                    ? `${totalQty} ticket${totalQty === 1 ? '' : 's'} · incl. ${formatMinor(feeMinor)} fee`
                    : 'Choose a ticket to continue'}
                </p>
              </div>
              <Button
                size="lg"
                className="h-12 shrink-0 px-6 shadow-sm transition-transform active:scale-[0.98] motion-reduce:transform-none"
                onClick={handleBuy}
                disabled={totalQty === 0}
              >
                <TicketIcon className="size-4" /> {user ? 'Checkout' : 'Sign in'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
