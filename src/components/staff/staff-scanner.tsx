'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CameraOff,
  CheckCircle2,
  ClipboardCheck,
  Keyboard,
  Loader2,
  MapPin,
  RotateCcw,
  ScanLine,
  Ticket as TicketIcon,
  TicketX,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Html5Qrcode } from 'html5-qrcode'
import { ApiError, apiGet, apiPost } from '@/lib/api'
import { formatMinor, formatDateTimeTime, formatEventDate, formatTime } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { paths } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { CheckInRow, StaffAssignmentRow, ValidateResult } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/empty-state'

// ───────────────────────────────────────────────────────── shared pieces

/**
 * A gate is read at arm's length, outdoors, with a queue waiting. Verdicts are
 * solid fills rather than pale tints so the answer survives direct sunlight,
 * and every one carries an icon and a word — never colour alone.
 */
type Verdict = 'go' | 'warn' | 'stop'

const VERDICT_SURFACE: Record<Verdict, string> = {
  go: 'bg-primary text-primary-foreground',
  warn: 'bg-warning text-warning-foreground',
  stop: 'bg-destructive text-white',
}

function Panel({
  icon: Icon,
  title,
  action,
  children,
  className,
}: {
  icon: LucideIcon
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-2xl border border-border/70 bg-card shadow-sm', className)}>
      <header className="flex items-center gap-3 border-b border-border/70 bg-muted/35 px-4 py-3.5 sm:px-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
        <h2 className="min-w-0 flex-1 text-sm font-semibold tracking-tight">{title}</h2>
        {action}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

/** Slim progress rail — `Progress` carried a card's worth of chrome for one bar. */
function Meter({ value, tone = 'primary' }: { value: number; tone?: 'primary' | 'inverse' }) {
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full', tone === 'primary' ? 'bg-muted' : 'bg-white/25')}
      role="img"
      aria-label={`${value}% checked in`}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', tone === 'primary' ? 'bg-primary' : 'bg-white')}
        style={{ width: `${Math.max(value, 1.5)}%` }}
      />
    </div>
  )
}

// ───────────────────────────────────────────────────────── /staff/check-in

export function StaffScanner({ eventId }: { eventId: string }) {
  const qc = useQueryClient()

  // The event under the scanner is URL state (`?event=`), not component
  // state: a refresh at the gate reopens the same event.
  const selectedEventId = eventId
  const [scanTab, setScanTab] = useState<'camera' | 'manual'>('manual')
  const [scanActive, setScanActive] = useState(true)
  const [cameraReady, setCameraReady] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [lastCode, setLastCode] = useState<string | null>(null)
  const [checkedInInfo, setCheckedInInfo] = useState<{ at: string } | null>(null)

  /**
   * Derived rather than stored: "starting" is simply camera mode running
   * before the library reports a live stream. Keeping it as state meant
   * setting it synchronously inside the effect, which cascades a render.
   */
  const cameraStarting = scanTab === 'camera' && scanActive && !cameraReady

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const busyRef = useRef(false)
  const handleCodeRef = useRef<(code: string) => void>(() => {})
  const manualRef = useRef<HTMLInputElement>(null)

  // ---- Queries ----
  const { data: assignmentsData, isLoading } = useQuery({
    queryKey: ['staff-assignments'],
    queryFn: () => apiGet<{ assignments: StaffAssignmentRow[] }>('/api/staff/assignments'),
  })

  const assignments = assignmentsData?.assignments ?? []
  const selected = assignments.find((a) => a.event.id === selectedEventId) ?? null

  const { data: checkinsData } = useQuery({
    queryKey: ['checkins', selectedEventId],
    queryFn: () => apiGet<{ checkIns: CheckInRow[] }>(`/api/staff/events/${selectedEventId}/checkins`),
    enabled: !!selectedEventId,
  })
  const checkIns = checkinsData?.checkIns ?? []

  // ---- Mutations ----
  const validateMutation = useMutation({
    mutationFn: (code: string) => apiPost<ValidateResult>('/api/staff/validate', { code }),
    onMutate: () => setCheckedInInfo(null),
    onError: (e: Error) => toast.error(e.message),
  })

  const checkinMutation = useMutation({
    mutationFn: (ticketId: string) =>
      apiPost<{ ticket: ValidateResult['ticket'] }>('/api/staff/checkin', { ticketId }),
    onSuccess: (data) => {
      toast.success('Checked in!')
      setCheckedInInfo({ at: data.ticket?.checkedInAt ?? new Date().toISOString() })
      qc.invalidateQueries({ queryKey: ['checkins', selectedEventId] })
      qc.invalidateQueries({ queryKey: ['staff-assignments'] })
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 409) {
        const at = (e.data as { checkedInAt?: string } | null)?.checkedInAt
        setCheckedInInfo({ at: at ?? new Date().toISOString() })
        toast.warning('Ticket was already checked in')
      } else {
        toast.error(e.message)
      }
    },
  })

  useEffect(() => {
    if (!validateMutation.isPending) busyRef.current = false
  }, [validateMutation.isPending])

  function handleCode(code: string) {
    const c = code.trim()
    if (!c) return
    setLastCode(c)
    setCheckedInInfo(null)
    validateMutation.mutate(c)
  }

  useEffect(() => {
    handleCodeRef.current = handleCode
  })

  /** Clears the verdict and puts the operator back on the input or the camera. */
  function scanNext() {
    validateMutation.reset()
    setCheckedInInfo(null)
    setLastCode(null)
    setManualCode('')
    if (scanTab === 'camera') setScanActive(true)
    else manualRef.current?.focus()
  }

  // ---- Camera scanner lifecycle (lazy-loaded html5-qrcode) ----
  useEffect(() => {
    if (scanTab !== 'camera' || !scanActive) return
    let cancelled = false
    let scanner: Html5Qrcode | null = null
    ;(async () => {
      try {
        const { Html5Qrcode: H5Qr } = await import('html5-qrcode')
        if (cancelled) return
        scanner = new H5Qr('qr-reader')
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250 },
          (decodedText) => {
            if (busyRef.current) return
            busyRef.current = true
            scannerRef.current?.stop().catch(() => {})
            setScanActive(false)
            handleCodeRef.current(decodedText)
          },
          () => {
            /* per-frame decode errors are expected — ignore */
          }
        )
        if (!cancelled) setCameraReady(true)
      } catch {
        if (!cancelled) {
          setScanActive(false)
          setScanTab('manual')
          toast.error('Camera unavailable — switched to manual entry')
        }
      }
    })()
    return () => {
      cancelled = true
      // Leaving camera mode (or stopping) means the next start is a fresh one.
      setCameraReady(false)
      const s = scanner
      if (s) {
        s.stop().catch(() => {})
        try {
          s.clear()
        } catch {
          /* already cleared */
        }
      }
      if (scannerRef.current === s) scannerRef.current = null
    }

  }, [scanTab, scanActive])

  // An unknown or unassigned event id gets an honest state rather than a
  // scanner pointed at nothing.
  if (!selected) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {isLoading ? (
          <Skeleton className="h-60 rounded-2xl" />
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="Event not available"
            description="You are not assigned to this event, or it no longer exists."
            action={
              <Button asChild variant="outline">
                <Link href={paths.staff()}>
                  <ArrowLeft className="size-4" /> Choose an event
                </Link>
              </Button>
            }
          />
        )}
      </div>
    )
  }

  const v = validateMutation.data
  const pct =
    selected.totalTickets > 0 ? Math.round((selected.checkedInCount / selected.totalTickets) * 100) : 0
  const awaitingCheckIn = v?.result === 'VALID' && !!v.ticket && !checkedInInfo

  return (
    <div
      className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8"
      // Room for the sticky check-in bar, plus the gesture area on a phone.
      style={awaitingCheckIn ? { paddingBottom: 'calc(6.5rem + env(safe-area-inset-bottom))' } : undefined}
    >
      {/* ── header ── */}
      <header>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href={paths.staff()}>
            <ArrowLeft className="size-4" /> All my events
          </Link>
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ScanLine className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight sm:text-2xl">
                {selected.event.title}
              </h1>
              <p className="truncate text-xs text-muted-foreground sm:text-sm">
                {selected.event.venue}, {selected.event.city} ·{' '}
                {formatEventDate(selected.event.startDate)}
              </p>
            </div>
          </div>

          {/* The running count follows the operator on a phone instead of
              living in a desktop-only sidebar they never scroll to. */}
          <div className="flex shrink-0 items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-2 shadow-sm lg:hidden">
            <Users className="size-4 text-primary" aria-hidden="true" />
            <span className="text-sm font-semibold tabular-nums">
              {selected.checkedInCount}
              <span className="font-normal text-muted-foreground">/{selected.totalTickets}</span>
            </span>
          </div>
        </div>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {/* ── scanner + verdict ── */}
        <div className="space-y-5 lg:col-span-2">
          <Panel
            icon={scanTab === 'camera' ? Camera : Keyboard}
            title="Scan a ticket"
            action={
              <div
                className="flex shrink-0 gap-1 rounded-xl border border-border/70 bg-muted/60 p-1"
                role="group"
                aria-label="Scan mode"
              >
                {(
                  [
                    { key: 'camera', label: 'Camera', icon: Camera },
                    { key: 'manual', label: 'Manual', icon: Keyboard },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    aria-pressed={scanTab === m.key}
                    onClick={() => {
                      setScanTab(m.key)
                      if (m.key === 'camera') setScanActive(true)
                    }}
                    className={cn(
                      'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium',
                      'transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      scanTab === m.key
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <m.icon className="size-3.5" aria-hidden="true" />
                    {m.label}
                  </button>
                ))}
              </div>
            }
          >
            {scanTab === 'camera' ? (
              <div className="space-y-3">
                {scanActive ? (
                  <>
                    <div className="relative overflow-hidden rounded-xl border border-border/70 bg-black">
                      <div id="qr-reader" className="w-full [&_video]:block [&_video]:w-full" />
                      {/* Corner guides: a viewfinder tells the operator where to
                          aim without covering the frame. */}
                      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                        <div className="absolute inset-[12%] rounded-xl">
                          {[
                            'left-0 top-0 border-l-2 border-t-2 rounded-tl-lg',
                            'right-0 top-0 border-r-2 border-t-2 rounded-tr-lg',
                            'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg',
                            'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg',
                          ].map((pos) => (
                            <span key={pos} className={cn('absolute size-10 border-primary', pos)} />
                          ))}
                        </div>
                      </div>
                      {cameraStarting && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                          <p className="flex items-center gap-2 text-sm font-medium">
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Starting
                            camera…
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Point at the attendee’s QR — scanning stops on a read.
                      </p>
                      <Button
                        variant="outline"
                        className="h-11 shrink-0"
                        disabled={cameraStarting}
                        onClick={() => setScanActive(false)}
                      >
                        <CameraOff className="size-4" aria-hidden="true" /> Stop
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/25 p-8 text-center">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Camera className="size-6" aria-hidden="true" />
                    </span>
                    <p className="text-sm text-muted-foreground">Camera is idle.</p>
                    <Button
                      className="h-12 px-6 text-[15px]"
                      disabled={cameraStarting}
                      onClick={() => setScanActive(true)}
                    >
                      {cameraStarting ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Camera className="size-4" aria-hidden="true" />
                      )}
                      {lastCode ? 'Scan next ticket' : 'Start camera'}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <form
                  className="flex flex-col gap-2.5 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (validateMutation.isPending) return
                    handleCode(manualCode)
                    setManualCode('')
                  }}
                >
                  <Input
                    ref={manualRef}
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="EVT-2026-000123"
                    className="h-12 flex-1 font-mono text-base tracking-wide md:text-base"
                    aria-label="Ticket code or QR token"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    autoFocus
                  />
                  <Button
                    type="submit"
                    className="h-12 shrink-0 px-6 text-[15px] transition-transform active:scale-[0.99] motion-reduce:transform-none"
                    disabled={validateMutation.isPending || !manualCode.trim()}
                  >
                    {validateMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ScanLine className="size-4" aria-hidden="true" />
                    )}
                    {validateMutation.isPending ? 'Checking…' : 'Validate'}
                  </Button>
                </form>
                <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                  Type the code printed under the QR, or paste the full QR token.
                </p>
              </>
            )}

            {lastCode && (
              <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border/70 pt-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Last read
                </span>
                <span className="min-w-0 truncate font-mono text-xs font-medium">{lastCode}</span>
              </div>
            )}
          </Panel>

          {/* The verdict. `role="status"` so it is announced, not just shown. */}
          <div role="status" aria-live="polite" className="space-y-5">
            {validateMutation.isError && (
              <VerdictPanel
                verdict="stop"
                icon={TicketX}
                headline="Scan failed"
                detail={
                  validateMutation.error instanceof Error
                    ? validateMutation.error.message
                    : 'Something went wrong — try again.'
                }
                onNext={scanNext}
              />
            )}

            {v && (
              <ResultCard
                result={v}
                checkedInInfo={checkedInInfo}
                onCheckIn={() => v.ticket && checkinMutation.mutate(v.ticket.id)}
                checkingIn={checkinMutation.isPending}
                onNext={scanNext}
              />
            )}
          </div>
        </div>

        {/* ── live stats ── */}
        <div className="space-y-5">
          <Panel icon={Users} title="Live check-ins">
            <p className="text-4xl font-semibold tracking-tight tabular-nums">
              {selected.checkedInCount}
              <span className="text-lg font-normal text-muted-foreground">
                {' '}
                / {selected.totalTickets}
              </span>
            </p>
            <div className="mt-3">
              <Meter value={pct} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground tabular-nums">
              {pct}% arrived · {Math.max(0, selected.totalTickets - selected.checkedInCount)} still
              to come
            </p>
          </Panel>

          <Panel icon={ClipboardCheck} title="Recent arrivals">
            {checkIns.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nobody has checked in yet.
              </p>
            ) : (
              <ul className="scrollbar -mr-1 max-h-[26rem] divide-y divide-border/70 overflow-y-auto pr-1">
                {checkIns.map((c) => (
                  <li key={c.id} className="py-2.5 first:pt-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium">{c.attendeeName || c.user.name}</p>
                      <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatDateTimeTime(c.checkedInAt)}
                      </p>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {c.ticketCode} · {c.ticketType.name}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {/* ── sticky check-in action (phones) ──
          The CHECK IN button was the last thing on a long page. At a gate it
          needs to be under the thumb the moment the verdict reads green. */}
      {awaitingCheckIn && v?.ticket && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:hidden"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <Button
            className="h-14 w-full text-base font-semibold transition-transform active:scale-[0.99] motion-reduce:transform-none"
            disabled={checkinMutation.isPending}
            onClick={() => checkinMutation.mutate(v.ticket!.id)}
          >
            {checkinMutation.isPending ? (
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-5" aria-hidden="true" />
            )}
            {checkinMutation.isPending ? 'Checking in…' : 'Check in'}
          </Button>
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────── verdicts

function VerdictPanel({
  verdict,
  icon: Icon,
  headline,
  detail,
  children,
  onNext,
}: {
  verdict: Verdict
  icon: LucideIcon
  headline: string
  detail?: string
  children?: React.ReactNode
  onNext?: () => void
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 shadow-sm">
      <div className={cn('flex items-center gap-3 px-4 py-4 sm:px-5', VERDICT_SURFACE[verdict])}>
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/20">
          <Icon className="size-6" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">{headline}</p>
          {detail && <p className="mt-0.5 text-sm opacity-90">{detail}</p>}
        </div>
      </div>
      {(children || onNext) && (
        <div className="space-y-4 bg-card p-4 sm:p-5">
          {children}
          {onNext && (
            <Button variant="outline" className="h-11 w-full" onClick={onNext}>
              <RotateCcw className="size-4" aria-hidden="true" /> Scan next
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

/** Big, unambiguous result panel for a validation outcome. */
function ResultCard({
  result,
  checkedInInfo,
  onCheckIn,
  checkingIn,
  onNext,
}: {
  result: ValidateResult
  checkedInInfo: { at: string } | null
  onCheckIn: () => void
  checkingIn: boolean
  onNext: () => void
}) {
  const t = result.ticket

  if (result.result === 'VALID' && t) {
    if (checkedInInfo) {
      return (
        <VerdictPanel
          verdict="go"
          icon={CheckCircle2}
          headline="Checked in"
          detail={`${t.attendeeName || t.user.name} · ${formatDateTimeTime(checkedInInfo.at)}`}
          onNext={onNext}
        >
          <p className="text-center font-mono text-xs text-muted-foreground">{t.ticketCode}</p>
        </VerdictPanel>
      )
    }
    return (
      <VerdictPanel verdict="go" icon={CheckCircle2} headline="Valid ticket — let them in">
        <dl className="space-y-2.5 text-sm">
          <Row label="Attendee" value={t.attendeeName || '—'} strong />
          <Row label="Booked by" value={t.user.name} />
          <Row label="Ticket" value={`${t.ticketType.name} · ${formatMinor(t.ticketType.priceMinor)}`} />
          <Row label="Code" value={t.ticketCode} mono />
          <Row label="Order" value={t.order.orderNumber} mono />
        </dl>
        {/* Full-width on desktop; on phones the sticky bar carries this action
            too, so it is reachable without scrolling back. */}
        <Button
          className="h-14 w-full text-base font-semibold transition-transform active:scale-[0.99] motion-reduce:transform-none"
          disabled={checkingIn}
          onClick={onCheckIn}
        >
          {checkingIn ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="size-5" aria-hidden="true" />
          )}
          {checkingIn ? 'Checking in…' : 'Check in'}
        </Button>
        <Button variant="ghost" className="h-11 w-full" onClick={onNext}>
          <RotateCcw className="size-4" aria-hidden="true" /> Skip — scan next
        </Button>
      </VerdictPanel>
    )
  }

  if (result.result === 'ALREADY_CHECKED_IN' && t) {
    return (
      <VerdictPanel
        verdict="warn"
        icon={AlertTriangle}
        headline="Already checked in"
        detail={t.checkedInAt ? `Entered at ${formatDateTimeTime(t.checkedInAt)}` : undefined}
        onNext={onNext}
      >
        <dl className="space-y-2.5 text-sm">
          <Row label="Attendee" value={t.attendeeName || '—'} strong />
          <Row label="Ticket" value={`${t.ticketType.name} · ${formatMinor(t.ticketType.priceMinor)}`} />
          <Row label="Code" value={t.ticketCode} mono />
        </dl>
        <p className="rounded-xl bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          This ticket has already been used for entry. Do not admit again unless a supervisor
          approves it.
        </p>
      </VerdictPanel>
    )
  }

  if (result.result === 'CANCELLED' && t) {
    return (
      <VerdictPanel
        verdict="stop"
        icon={TicketX}
        headline="Ticket cancelled"
        detail="Cannot be used for entry."
        onNext={onNext}
      >
        <dl className="space-y-2.5 text-sm">
          <Row label="Attendee" value={t.attendeeName || '—'} strong />
          <Row label="Code" value={t.ticketCode} mono />
        </dl>
      </VerdictPanel>
    )
  }

  // INVALID or NOT_ASSIGNED (or missing ticket payload)
  const reason =
    result.result === 'NOT_ASSIGNED'
      ? 'This ticket belongs to an event you are not assigned to.'
      : (result.error ?? 'Ticket not found — check the code and try again.')
  return (
    <VerdictPanel verdict="stop" icon={TicketX} headline="Invalid ticket" detail={reason} onNext={onNext} />
  )
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string
  value: string
  strong?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'break-all text-right',
          strong ? 'text-base font-semibold' : 'font-medium',
          mono && 'font-mono text-xs',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

// ───────────────────────────────────────────────────────── /staff

/**
 * `/staff` — the event picker.
 *
 * This was step one of a two-step component whose choice lived in `useState`,
 * so a refresh dropped the staffer back to the list mid-shift. The choice is a
 * route now: each card links to `/staff/check-in?event=<id>`.
 */
export function StaffEventPicker() {
  const user = useAppStore((s) => s.user)

  const { data: assignmentsData, isLoading } = useQuery({
    queryKey: ['staff-assignments'],
    queryFn: () => apiGet<{ assignments: StaffAssignmentRow[] }>('/api/staff/assignments'),
  })
  const assignments = assignmentsData?.assignments ?? []

  // Doors open first: an event running right now is the one being worked.
  const sorted = [...assignments].sort((a, b) => {
    const live = (x: StaffAssignmentRow) => (x.event.status === 'ONGOING' ? 0 : 1)
    if (live(a) !== live(b)) return live(a) - live(b)
    return new Date(a.event.startDate).getTime() - new Date(b.event.startDate).getTime()
  })

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ScanLine className="size-6" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Gate control
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Check-in</h1>
        </div>
      </header>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        {user?.name ? `${user.name} — pick` : 'Pick'} the event you are working and start scanning.
      </p>

      <div className="mt-6">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        ) : assignments.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No event assignments"
            description="You are not assigned to any events yet — ask your organizer for access."
            action={
              <Button asChild variant="outline">
                <Link href={paths.home()}>
                  <ArrowLeft className="size-4" /> Go home
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((a) => {
              const pct =
                a.totalTickets > 0 ? Math.round((a.checkedInCount / a.totalTickets) * 100) : 0
              const live = a.event.status === 'ONGOING'
              return (
                <Link
                  key={a.id}
                  href={paths.staffCheckIn(a.event.id)}
                  className={cn(
                    'group flex flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm',
                    'transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                    live ? 'border-primary/40 shadow-primary/10' : 'border-border/70',
                  )}
                  aria-label={`Scan tickets for ${a.event.title}`}
                >
                  <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                    {a.event.banner ? (
                       
                      <img
                        src={a.event.banner}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                      />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-accent text-primary/70"
                        aria-hidden="true"
                      >
                        <TicketIcon className="size-9" />
                      </div>
                    )}
                    <div
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/45 to-transparent"
                    />
                    <span
                      className={cn(
                        'absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm',
                        live ? 'bg-primary text-primary-foreground' : 'bg-black/40 text-white ring-1 ring-inset ring-white/20',
                      )}
                    >
                      {live && (
                        <span className="relative flex size-1.5" aria-hidden="true">
                          <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-70 motion-reduce:animate-none" />
                          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
                        </span>
                      )}
                      {live ? 'Doors open' : a.event.status}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <h3 className="line-clamp-2 text-pretty font-semibold leading-snug tracking-tight transition-colors duration-200 group-hover:text-primary">
                      {a.event.title}
                    </h3>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {a.event.venue}, {a.event.city}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatEventDate(a.event.startDate)} · {formatTime(a.event.startTime)}
                    </p>

                    <div className="mt-auto pt-2">
                      <div className="mb-1.5 flex items-baseline justify-between text-xs">
                        <span className="text-muted-foreground">Checked in</span>
                        <span className="font-semibold tabular-nums">
                          {a.checkedInCount}
                          <span className="font-normal text-muted-foreground">
                            /{a.totalTickets}
                          </span>
                        </span>
                      </div>
                      <Meter value={pct} />
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
