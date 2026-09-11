'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Maximize2,
  MapPin,
  Printer,
  QrCode as QrCodeIcon,
  ShieldCheck,
  Sun,
  TicketX,
  User,
  WifiOff,
  X,
} from 'lucide-react'
import { apiGet } from '@/lib/api'
import { useRouter } from 'next/navigation'
import { paths } from '@/lib/routes'
import { categoryLabel, formatDateTimeTime, formatEventDate, formatTime } from '@/lib/format'
import type { OrderDTO, TicketDTO } from '@/lib/types'
import {
  buildTicketSnapshot,
  readTicketSnapshot,
  saveTicketSnapshot,
  type TicketSnapshot,
} from '@/lib/ticket-cache'
import { renderTicketImage } from '@/lib/ticket-image'
import {
  TicketStatusBadge,
  ticketStatusMeta,
  ticketTone,
  type TicketTone,
} from '@/components/customer/ticket-status-badge'
import { CategoryIcon } from '@/components/app/category-icon'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/app/empty-state'
import { cn } from '@/lib/utils'

/** Flat shape the ticket renders from, whether live or restored from cache. */
interface TicketView {
  orderNumber: string
  ticketCode: string
  qrToken: string
  attendeeName: string
  status: TicketDTO['status']
  checkedInAt: string | null
  ticketTypeName: string
  eventTitle: string
  eventBanner: string | null
  venue: string
  city: string
  startDate: string
  startTime: string
  category: string
}

function fromSnapshot(s: TicketSnapshot): TicketView {
  return {
    orderNumber: s.orderNumber,
    ticketCode: s.ticket.ticketCode,
    qrToken: s.ticket.qrToken,
    attendeeName: s.ticket.attendeeName,
    status: s.ticket.status,
    checkedInAt: s.ticket.checkedInAt,
    ticketTypeName: s.ticket.ticketTypeName ?? 'Ticket',
    eventTitle: s.event.title,
    eventBanner: s.event.banner,
    venue: s.event.venue,
    city: s.event.city,
    startDate: s.event.startDate,
    startTime: s.event.startTime,
    category: s.event.category,
  }
}

function findTicket(orders: OrderDTO[], ticketId: string) {
  for (const order of orders) {
    const ticket = order.tickets?.find((t) => t.id === ticketId)
    if (ticket && order.event) return { order, ticket, event: order.event }
  }
  return null
}

// ─────────────────────────────────────────────────────────── gate status

/**
 * How the ticket reads to a person standing at the door.
 *
 * `ticketStatusMeta` stays the single source of truth for the *label* (shared
 * with My Tickets and Payment Success). This adds only the gate-facing framing
 * — can this person walk in, right now — which is the one question the screen
 * has to answer before anything else.
 */
/** Every tone pairs a colour with an icon and a sentence — never colour alone. */
const GATE_COPY: Record<TicketTone, { headline: string; sub: string }> = {
  valid: { headline: 'Valid for entry', sub: 'Show this QR at the entrance' },
  used: { headline: 'Checked in', sub: 'Entry already recorded' },
  void: { headline: 'Not valid for entry', sub: 'This ticket cannot be scanned' },
}

const GATE_BAND: Record<TicketTone, string> = {
  valid: 'border-primary/25 bg-primary/10 text-primary',
  used: 'border-primary/30 bg-primary text-primary-foreground',
  void: 'border-destructive/30 bg-destructive/10 text-destructive',
}

// ─────────────────────────────────────────────────────────── wake lock

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
}

interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock ?? null
}

/**
 * Keeps the screen awake while gate mode is open.
 *
 * A phone that sleeps in the queue is the most common reason an e-ticket
 * "doesn't work" — the attendee arrives at the scanner holding a black screen
 * and has to unlock, find the tab and re-open it with people waiting. The lock
 * is dropped by the browser whenever the page hides, so it is re-acquired on
 * `visibilitychange` rather than assumed to survive a tab switch.
 *
 * Unsupported browsers (Safari as of writing) simply get nothing; there is no
 * fallback worth faking, and the screen-on hint in the UI covers it.
 */
function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const api = wakeLockApi()
    if (!api) return

    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false

    const acquire = () => {
      api
        .request('screen')
        .then((s) => {
          // Gate mode may have closed while the request was in flight.
          if (cancelled) void s.release().catch(() => {})
          else sentinel = s
        })
        .catch(() => {
          // Denied, or the document lost focus. Not worth surfacing.
        })
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}

// ─────────────────────────────────────────────────────────── small parts

/** "at 7:42 PM" for today, an explicit date for anything older. */
function savedLabel(savedAt: number): string {
  const saved = new Date(savedAt)
  const isToday = new Date().toDateString() === saved.toDateString()
  return isToday ? `at ${formatDateTimeTime(saved)}` : `on ${formatEventDate(saved)}`
}

/**
 * The QR on its plate.
 *
 * The plate is white and the code near-black in **both themes** — a QR
 * inverted by dark mode will not scan, and cheap gate scanners need the
 * contrast far more than the ticket needs the brand colour.
 */
function QrPlate({
  qrDataUrl,
  tone,
  label,
  className,
  imageClassName,
}: {
  qrDataUrl: string | null
  tone: TicketTone
  label: string
  className?: string
  imageClassName?: string
}) {
  return (
    <div
      className={cn(
        'relative rounded-2xl bg-white p-3 inset-ring inset-ring-black/10',
        className,
      )}
    >
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt={label}
          className={cn(
            'aspect-square w-full object-contain',
            tone === 'void' && 'opacity-20',
            imageClassName,
          )}
        />
      ) : (
        <Skeleton className={cn('aspect-square w-full rounded-lg', imageClassName)} />
      )}

      {/* A void ticket must never present a clean, scannable code. */}
      {tone === 'void' && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <span className="rotate-[-8deg] rounded-lg border-2 border-destructive bg-white/80 px-3 py-1.5 text-sm font-bold uppercase tracking-[0.18em] text-destructive">
            Void
          </span>
        </div>
      )}
    </div>
  )
}

/** The ticket code, sized to be read aloud across a turnstile. */
function TicketCode({ code, className }: { code: string; className?: string }) {
  return (
    <p
      className={cn(
        'select-all font-mono font-bold tracking-[0.12em] tabular-nums',
        className,
      )}
    >
      {code}
    </p>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-sm font-medium">{children}</dd>
    </div>
  )
}

function TicketSkeleton() {
  return (
    <div className="mx-auto max-w-md px-4 py-5 sm:px-6">
      <Skeleton className="h-9 w-32" />
      <Skeleton className="mt-4 h-14 w-full rounded-2xl" />
      <div className="mt-3 overflow-hidden rounded-3xl border border-border/70">
        <div className="flex flex-col items-center gap-4 p-6">
          <Skeleton className="aspect-square w-full max-w-[17rem] rounded-2xl" />
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
        <div className="border-t-2 border-dashed p-6">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="mt-3 h-4 w-1/2" />
          <Skeleton className="mt-2 h-4 w-2/3" />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────── gate mode

/**
 * Full-screen, pure white, QR as large as the viewport allows.
 *
 * This is the screen the attendee actually holds up, so it drops everything
 * that is not needed at the door: the QR, the code as a spoken fallback, and
 * the attendee name for an ID check. It is deliberately theme-independent —
 * white is both the highest-contrast backing for a scanner and the brightest
 * thing a web page can put on an outdoor screen.
 */
function GateMode({
  open,
  onOpenChange,
  view,
  qrDataUrl,
  tone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  view: TicketView
  qrDataUrl: string | null
  tone: TicketTone
}) {
  useScreenWakeLock(open)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Full-bleed white panel rather than a centred card: no scrim, no
        // rounding, no theme background. twMerge lets these win over the
        // primitive's defaults.
        className="inset-0 top-0 left-0 block h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-0 bg-white p-0 text-neutral-900 shadow-none"
      >
        <DialogTitle className="sr-only">
          Gate view — ticket {view.ticketCode} for {view.eventTitle}
        </DialogTitle>

        <div className="flex min-h-dvh flex-col items-center px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {/* Close sits top-right at a full 44px, reachable one-handed. */}
          <div className="flex w-full items-start justify-between gap-3">
            <div className="min-w-0 pt-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                {view.ticketTypeName}
              </p>
              <p className="truncate text-sm font-semibold text-neutral-900">{view.eventTitle}</p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close gate view"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-neutral-100 text-neutral-700 transition-colors duration-200 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex w-full flex-1 flex-col items-center justify-center gap-5 py-6">
            {/* The QR takes the largest square the viewport allows, capped so
                the code and name below never get pushed off screen. */}
            <QrPlate
              qrDataUrl={qrDataUrl}
              tone={tone}
              label={`QR code for ticket ${view.ticketCode}`}
              // A small gutter, so the frame reads as a frame rather than a
              // grey hairline touching the code's outermost modules.
              className="w-[min(86vw,52vh)] p-2"
            />

            <TicketCode code={view.ticketCode} className="text-2xl text-neutral-900 sm:text-3xl" />

            <div className="flex flex-col items-center gap-1 text-center">
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                <User className="size-4 shrink-0 text-neutral-500" aria-hidden="true" />
                {view.attendeeName}
              </p>
              {tone === 'used' && (
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  Already checked in
                  {view.checkedInAt ? ` · ${formatDateTimeTime(view.checkedInAt)}` : ''}
                </p>
              )}
            </div>
          </div>

          {/* Honest about what this can and cannot do: a web page cannot raise
              screen brightness, so it asks. */}
          <p className="inline-flex items-center gap-1.5 text-center text-xs text-neutral-500">
            <Sun className="size-3.5 shrink-0" aria-hidden="true" />
            Turn your brightness up if the scanner struggles
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────── page

export function TicketDetail({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)

  // Read the cached copy synchronously on first render so an offline visit
  // shows the ticket immediately instead of an error.
  const [cached] = useState<TicketSnapshot | null>(() => readTicketSnapshot(ticketId))

  const query = useQuery({
    queryKey: ['orders', 'mine'],
    queryFn: () => apiGet<{ orders: OrderDTO[] }>('/api/orders/mine'),
    // A gate scan changes this ticket from somebody else's device, so the
    // attendee's own screen has to keep looking rather than sit on stale state.
    refetchOnWindowFocus: true,
    refetchInterval: (q) => {
      const orders = q.state.data?.orders
      if (!orders) return false
      const hit = findTicket(orders, ticketId)
      return hit?.ticket.status === 'ACTIVE' ? 20_000 : false
    },
  })

  const live = query.data ? findTicket(query.data.orders, ticketId) : null

  // Refresh the offline copy whenever the server tells us something new.
  useEffect(() => {
    if (!live) return
    saveTicketSnapshot(ticketId, buildTicketSnapshot(live.order, live.ticket, live.event))
  }, [live, ticketId])

  const view: TicketView | null = live
    ? {
        orderNumber: live.order.orderNumber,
        ticketCode: live.ticket.ticketCode,
        qrToken: live.ticket.qrToken,
        attendeeName: live.ticket.attendeeName,
        status: live.ticket.status,
        checkedInAt: live.ticket.checkedInAt,
        ticketTypeName: live.ticket.ticketType?.name ?? 'Ticket',
        eventTitle: live.event.title,
        eventBanner: live.event.banner,
        venue: live.event.venue,
        city: live.event.city,
        startDate: live.event.startDate,
        startTime: live.event.startTime,
        category: live.event.category,
      }
    : cached
      ? fromSnapshot(cached)
      : null

  const usingCache = !live && !!cached

  // QR is generated on the device from the token, so it works with no network.
  useEffect(() => {
    if (!view?.qrToken) return
    let cancelled = false
    QRCode.toDataURL(view.qrToken, {
      // Generated well above its largest rendered size, so the full-screen
      // gate view upscales from real pixels rather than a blurry 224px plate.
      width: 900,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0A0A0A', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [view?.qrToken])

  function copyCode() {
    if (!view) return
    // The ticket code, not the raw qrToken: this is the value a person reads
    // out at the gate or quotes to support. The scanner accepts either.
    navigator.clipboard
      .writeText(view.ticketCode)
      .then(() => {
        setCopied(true)
        toast.success('Ticket code copied')
        window.setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => toast.error('Could not copy the ticket code'))
  }

  async function saveImage() {
    if (!view || !qrDataUrl) return
    setSaving(true)
    try {
      const blob = await renderTicketImage({
        eventTitle: view.eventTitle,
        when: `${formatEventDate(view.startDate)} · ${formatTime(view.startTime)}`,
        venue: `${view.venue}, ${view.city}`,
        attendee: view.attendeeName,
        ticketType: view.ticketTypeName,
        ticketCode: view.ticketCode,
        statusLabel: ticketStatusMeta(view.status).label,
        qrDataUrl,
      })
      // A blob URL rather than a data URL: iOS Safari handles it far better,
      // opening the image so it can be added to the photo library.
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ticketbd-${view.ticketCode}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast.success('Ticket image saved')
    } catch {
      toast.error('Could not save the ticket image. Try the print option instead.')
    } finally {
      setSaving(false)
    }
  }

  // ---------- Loading: shaped like the ticket, not a bare spinner ----------
  if (query.isLoading && !view) return <TicketSkeleton />

  if (!view) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <EmptyState
          icon={AlertCircle}
          title="We couldn't find this ticket"
          description={
            query.isError
              ? "The connection dropped and there's no saved copy of this ticket on this device."
              : 'This ticket does not exist, or it belongs to another account.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {query.isError && (
                <Button onClick={() => query.refetch()} disabled={query.isFetching}>
                  {query.isFetching ? 'Retrying…' : 'Try again'}
                </Button>
              )}
              <Button variant="outline" onClick={() => router.push(paths.tickets())}>
                <ArrowLeft className="size-4" /> Back to my tickets
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  const meta = ticketStatusMeta(view.status)
  const tone = ticketTone(view.status)
  const copy = GATE_COPY[tone]
  const scannable = tone !== 'void'

  return (
    <>
      {/* The page is a single narrow column: this screen is held in one hand,
          and a wide layout would only push the QR further down. */}
      <div className="mx-auto max-w-md px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
        {/* ---------- Top bar (never printed) ---------- */}
        <div className="flex items-center justify-between gap-2 print:hidden">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 cursor-pointer"
            onClick={() => router.push(paths.tickets())}
          >
            <ArrowLeft className="size-4" /> My tickets
          </Button>
          <span className="font-mono text-xs text-muted-foreground">{view.orderNumber}</span>
        </div>

        {/* ---------- Status, before anything else ----------
            The one question the gate asks, answered in a full-width band with
            an icon and a sentence rather than a small badge beside a label. */}
        <div
          className={cn(
            'mt-3 flex items-center gap-3 rounded-2xl border px-4 py-3 print:hidden',
            GATE_BAND[tone],
          )}
        >
          {tone === 'valid' ? (
            <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
          ) : tone === 'used' ? (
            <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
          ) : (
            <TicketX className="size-5 shrink-0" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">{copy.headline}</p>
            <p
              className={cn(
                'text-xs leading-tight',
                tone === 'used' ? 'text-primary-foreground/80' : 'opacity-80',
              )}
            >
              {tone === 'used' && view.checkedInAt
                ? `Entry recorded at ${formatDateTimeTime(view.checkedInAt)}`
                : copy.sub}
            </p>
          </div>
        </div>

        {/* ---------- The ticket ---------- */}
        <div
          className={cn(
            'print-ticket mt-3 overflow-hidden rounded-3xl border border-border/70 bg-card',
            tone === 'void' ? 'shadow-sm' : 'shadow-xl shadow-primary/[0.07]',
          )}
        >
          {/* Status rail: the ticket's own state, carried onto paper too. */}
          <div
            className={cn(
              'h-1.5 w-full',
              tone === 'used'
                ? 'bg-primary'
                : tone === 'void'
                  ? 'bg-destructive'
                  : 'bg-gradient-to-r from-primary to-chart-2',
            )}
            aria-hidden="true"
          />

          {/* ── QR first ──
              A paper stub puts the event at the top and the tear-off at the
              bottom. This is not paper: at a gate the QR is the only thing
              anyone needs in the first two seconds, so it leads and the event
              identity moves below the perforation. */}
          <div className="flex flex-col items-center gap-4 px-5 pt-6 pb-6 sm:px-6">
            <div className="flex w-full items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <CategoryIcon category={view.category} className="size-3" />
                {categoryLabel(view.category)}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {view.ticketTypeName}
              </span>
            </div>

            <QrPlate
              qrDataUrl={qrDataUrl}
              tone={tone}
              label={`QR code for ticket ${view.ticketCode}`}
              className="w-full max-w-[17rem]"
            />

            <TicketCode code={view.ticketCode} className="text-xl sm:text-2xl" />

            {/* Primary action lives with the QR as well as in the sticky bar,
                so it is present whichever part of the page is on screen. */}
            {scannable ? (
              <Button
                className="h-12 w-full cursor-pointer text-[15px] transition-transform active:scale-[0.99] motion-reduce:transform-none print:hidden"
                onClick={() => setGateOpen(true)}
                disabled={!qrDataUrl}
              >
                <Maximize2 className="size-4" aria-hidden="true" />
                {qrDataUrl ? 'Show at gate' : 'Preparing QR…'}
              </Button>
            ) : (
              <p className="flex items-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive print:hidden">
                <TicketX className="size-3.5 shrink-0" aria-hidden="true" />
                {meta.label} — this ticket cannot be used for entry
              </p>
            )}
          </div>

          {/* Perforation */}
          <div className="ticket-notch border-t-2 border-dashed border-border" />

          {/* ── Event identity + credentials ── */}
          <div className="identity-band px-5 py-5 sm:px-6">
            <h1 className="text-pretty text-lg font-semibold leading-snug tracking-tight">
              {view.eventTitle}
            </h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
              <span className="tabular-nums">
                {formatEventDate(view.startDate)} · {formatTime(view.startTime)}
              </span>
            </p>
            <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {view.venue}, {view.city}
              </span>
            </p>

            <dl className="mt-3 divide-y divide-border/70 border-t border-border/70">
              <DetailRow label="Attendee">{view.attendeeName}</DetailRow>
              <DetailRow label="Ticket">{view.ticketTypeName}</DetailRow>
              <DetailRow label="Status">
                <TicketStatusBadge status={view.status} />
              </DetailRow>
            </dl>
          </div>
        </div>

        {/* ---------- Offline: reassurance, not an alarm ---------- */}
        {usingCache && cached && (
          <div className="mt-3 flex items-start gap-3 rounded-2xl border border-chart-5/40 bg-chart-5/10 px-4 py-3 print:hidden">
            <WifiOff className="mt-0.5 size-4 shrink-0 text-foreground/70" aria-hidden="true" />
            <div className="min-w-0 text-xs leading-relaxed">
              <p className="font-semibold">Showing your saved copy</p>
              <p className="text-muted-foreground">
                Saved {savedLabel(cached.savedAt)}. The QR is generated on this device, so it
                still scans at the gate without a signal.
              </p>
            </div>
          </div>
        )}

        {/* Announce a gate scan that arrives while the screen is open */}
        <p className="sr-only" role="status" aria-live="polite">
          {tone === 'used'
            ? `This ticket has been checked in.${view.checkedInAt ? ` Entry recorded at ${formatDateTimeTime(view.checkedInAt)}.` : ''}`
            : tone === 'void'
              ? `This ticket is ${meta.label.toLowerCase()} and cannot be used for entry.`
              : 'Ticket is valid for entry.'}
        </p>

        {/* ---------- Secondary actions ---------- */}
        <div className="mt-4 print:hidden">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11 cursor-pointer"
              onClick={saveImage}
              disabled={!qrDataUrl || saving}
            >
              <Download className="size-4" aria-hidden="true" />
              {saving ? 'Preparing…' : 'Save image'}
            </Button>
            <Button variant="outline" className="h-11 cursor-pointer" onClick={copyCode}>
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy code'}
            </Button>
          </div>

          {/* Print stays available as a genuine fallback — a dead phone, or a
              venue that wants paper — but it is no longer the shape of the
              page. */}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full cursor-pointer text-muted-foreground"
            onClick={() => window.print()}
          >
            <Printer className="size-4" aria-hidden="true" /> Print a paper copy
          </Button>

          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <QrCodeIcon className="size-3.5 shrink-0" aria-hidden="true" />
            Saved on this device — your QR works offline
          </p>
        </div>
      </div>

      {/* ---------- Sticky gate bar (mobile, one-handed) ---------- */}
      {scannable && (
        <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden print:hidden">
          <div aria-hidden="true" className="h-5 bg-gradient-to-t from-background to-transparent" />
          <div className="border-t border-border/70 bg-background/95 backdrop-blur">
            <div className="mx-auto max-w-md px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
              <Button
                className="h-12 w-full cursor-pointer text-[15px] transition-transform active:scale-[0.99] motion-reduce:transform-none"
                onClick={() => setGateOpen(true)}
                disabled={!qrDataUrl}
              >
                <Maximize2 className="size-4" aria-hidden="true" />
                {qrDataUrl ? 'Show at gate' : 'Preparing QR…'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <GateMode
        open={gateOpen}
        onOpenChange={setGateOpen}
        view={view}
        qrDataUrl={qrDataUrl}
        tone={tone}
      />
    </>
  )
}
