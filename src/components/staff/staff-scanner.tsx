'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Keyboard,
  Loader2,
  ScanLine,
  TicketX,
} from 'lucide-react'
import type { Html5Qrcode } from 'html5-qrcode'
import { ApiError, apiGet, apiPost } from '@/lib/api'
import { formatMinor, formatDateTimeTime, formatEventDate, formatTime } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { paths } from '@/lib/routes'
import type { CheckInRow, StaffAssignmentRow, ValidateResult } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/app/empty-state'

export function StaffScanner({ eventId }: { eventId: string }) {
  const qc = useQueryClient()

  // The event under the scanner is URL state (`?event=`), not component
  // state: a refresh at the gate reopens the same event.
  const selectedEventId = eventId
  const [scanTab, setScanTab] = useState<'camera' | 'manual'>('manual')
  const [scanActive, setScanActive] = useState(true)
  const [cameraStarting, setCameraStarting] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [lastCode, setLastCode] = useState<string | null>(null)
  const [checkedInInfo, setCheckedInInfo] = useState<{ at: string } | null>(null)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const busyRef = useRef(false)
  const handleCodeRef = useRef<(code: string) => void>(() => {})

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

  // ---- Camera scanner lifecycle (lazy-loaded html5-qrcode) ----
  useEffect(() => {
    if (scanTab !== 'camera' || !scanActive) return
    let cancelled = false
    let scanner: Html5Qrcode | null = null
    setCameraStarting(true)
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
        if (!cancelled) setCameraStarting(false)
      } catch {
        if (!cancelled) {
          setCameraStarting(false)
          setScanActive(false)
          setScanTab('manual')
          toast.error('Camera unavailable — switched to manual entry')
        }
      }
    })()
    return () => {
      cancelled = true
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
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {isLoading ? (
          <Skeleton className="h-60 rounded-xl" />
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="Event not available"
            description="You are not assigned to this event, or it no longer exists."
            action={
              <Button asChild variant="outline">
                <Link href={paths.staff()}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Choose an event
                </Link>
              </Button>
            }
          />
        )}
      </div>
    )
  }

  const v = validateMutation.data
  const pct = selected.totalTickets > 0 ? Math.round((selected.checkedInCount / selected.totalTickets) * 100) : 0

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href={paths.staff()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Change Event
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ScanLine className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{selected.event.title}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {selected.event.venue}, {selected.event.city} · {formatEventDate(selected.event.startDate)}
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* -------- Scanner -------- */}
        <div className="space-y-4 lg:col-span-2">
          {lastCode && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Last scanned code</p>
              <p className="mt-0.5 font-mono text-lg font-bold break-all">{lastCode}</p>
            </div>
          )}

          <Card>
            <CardContent className="p-4 sm:p-6">
              <Tabs
                value={scanTab}
                onValueChange={(t) => {
                  const next = t as 'camera' | 'manual'
                  setScanTab(next)
                  if (next === 'camera') setScanActive(true)
                }}
              >
                <TabsList className="mb-4 w-full sm:w-auto">
                  <TabsTrigger value="camera">📷 Camera Scan</TabsTrigger>
                  <TabsTrigger value="manual">⌨️ Manual Entry</TabsTrigger>
                </TabsList>

                {/* ---- Camera tab ---- */}
                <TabsContent value="camera" className="mt-0">
                  <div className="grid gap-3">
                    {scanActive ? (
                      <>
                        <div className="relative">
                          <div id="qr-reader" className="w-full overflow-hidden rounded-lg border" />
                          {cameraStarting && (
                            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70">
                              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> Starting camera…
                              </p>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">
                            Point the camera at the attendee&apos;s QR code — scanning stops automatically on a read.
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={cameraStarting}
                            onClick={() => setScanActive(false)}
                          >
                            Stop
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
                        <Camera className="h-10 w-10 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Camera is idle. Start scanning when ready.</p>
                        <Button disabled={cameraStarting} onClick={() => setScanActive(true)}>
                          {cameraStarting ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Camera className="mr-2 h-4 w-4" />
                          )}
                          {lastCode ? 'Scan Next Ticket' : 'Start Camera'}
                        </Button>
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* ---- Manual tab ---- */}
                <TabsContent value="manual" className="mt-0">
                  <form
                    className="flex flex-col gap-3 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (validateMutation.isPending) return
                      handleCode(manualCode)
                      setManualCode('')
                    }}
                  >
                    <Input
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      placeholder="Ticket code or QR token"
                      className="flex-1 font-mono"
                      aria-label="Ticket code or QR token"
                      autoFocus
                    />
                    <Button type="submit" disabled={validateMutation.isPending || !manualCode.trim()}>
                      {validateMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Keyboard className="mr-2 h-4 w-4" />
                      )}
                      {validateMutation.isPending ? 'Validating…' : 'Validate'}
                    </Button>
                  </form>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Type the code printed under the QR (e.g. <span className="font-mono">EVT-2026-000123</span>) or the
                    full QR token.
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* -------- Validation result -------- */}
          {validateMutation.isError && (
            <Card className="border-destructive/60">
              <CardContent className="p-4 sm:p-5">
                <p className="flex items-center gap-2 font-semibold text-destructive">
                  <TicketX className="h-5 w-5" /> Scan failed
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {validateMutation.error instanceof Error
                    ? validateMutation.error.message
                    : 'Something went wrong — try again.'}
                </p>
              </CardContent>
            </Card>
          )}

          {v && <ResultCard result={v} checkedInInfo={checkedInInfo} onCheckIn={() => v.ticket && checkinMutation.mutate(v.ticket.id)} checkingIn={checkinMutation.isPending} />}
        </div>

        {/* -------- Right column: live stats -------- */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 sm:p-5">
              <h2 className="mb-3 font-semibold">Live Check-ins</h2>
              <p className="text-3xl font-bold tracking-tight">
                {selected.checkedInCount}
                <span className="text-base font-normal text-muted-foreground"> / {selected.totalTickets}</span>
              </p>
              <Progress className="mt-2" value={pct} />
              <p className="mt-1.5 text-xs text-muted-foreground">{pct}% of tickets have checked in</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 sm:p-5">
              <h2 className="mb-3 font-semibold">Recent Check-ins</h2>
              <div className="scrollbar max-h-96 overflow-y-auto pr-1">
                {checkIns.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No check-ins yet.</p>
                ) : (
                  <ul className="divide-y">
                    {checkIns.map((c) => (
                      <li key={c.id} className="py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-medium">{c.attendeeName || c.user.name}</p>
                          <p className="shrink-0 text-xs text-muted-foreground">{formatDateTimeTime(c.checkedInAt)}</p>
                        </div>
                        <p className="font-mono text-xs text-muted-foreground">
                          {c.ticketCode} · {c.ticketType.name}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** Big, unambiguous result card for a validation outcome. */
function ResultCard({
  result,
  checkedInInfo,
  onCheckIn,
  checkingIn,
}: {
  result: ValidateResult
  checkedInInfo: { at: string } | null
  onCheckIn: () => void
  checkingIn: boolean
}) {
  const t = result.ticket

  if (result.result === 'VALID' && t) {
    if (checkedInInfo) {
      return (
        <Card className="border-green-500/60 bg-green-50 dark:bg-green-950/30">
          <CardContent className="p-4 text-center sm:p-6">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-600 dark:text-green-400" />
            <p className="mt-2 text-xl font-bold text-green-700 dark:text-green-300">CHECKED IN ✓</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.attendeeName || t.user.name} · at {formatDateTimeTime(checkedInInfo.at)}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{t.ticketCode}</p>
          </CardContent>
        </Card>
      )
    }
    return (
      <Card className="border-green-500/60 bg-green-50 dark:bg-green-950/30">
        <CardContent className="p-4 sm:p-5">
          <p className="flex items-center gap-2 text-lg font-bold text-green-700 dark:text-green-300">
            <CheckCircle2 className="h-6 w-6" /> ✅ VALID TICKET
          </p>
          <div className="mt-3 grid gap-2 text-sm">
            <Row label="Attendee" value={t.attendeeName || '—'} strong />
            <Row label="Customer" value={t.user.name} />
            <Row label="Ticket" value={`${t.ticketType.name} · ${formatMinor(t.ticketType.priceMinor)}`} />
            <Row label="Ticket Code" value={t.ticketCode} mono />
            <Row label="Event" value={t.event.title} />
            <Row label="Order" value={t.order.orderNumber} mono />
          </div>
          <Button size="lg" className="mt-4 w-full text-base" disabled={checkingIn} onClick={onCheckIn}>
            {checkingIn ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ScanLine className="mr-2 h-5 w-5" />}
            {checkingIn ? 'Checking in…' : 'CHECK IN'}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (result.result === 'ALREADY_CHECKED_IN' && t) {
    return (
      <Card className="border-amber-400/60 bg-amber-50 dark:bg-amber-950/30">
        <CardContent className="p-4 sm:p-5">
          <p className="flex items-center gap-2 text-lg font-bold text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-6 w-6" /> ⚠️ ALREADY CHECKED IN
          </p>
          <div className="mt-3 grid gap-2 text-sm">
            <Row label="Attendee" value={t.attendeeName || '—'} strong />
            <Row label="Ticket" value={`${t.ticketType.name} · ${formatMinor(t.ticketType.priceMinor)}`} />
            <Row label="Ticket Code" value={t.ticketCode} mono />
            <Row
              label="Checked in at"
              value={t.checkedInAt ? formatDateTimeTime(t.checkedInAt) : '—'}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">This ticket has already been used for entry.</p>
        </CardContent>
      </Card>
    )
  }

  if (result.result === 'CANCELLED' && t) {
    return (
      <Card className="border-destructive/60 bg-destructive/5">
        <CardContent className="p-4 sm:p-5">
          <p className="flex items-center gap-2 text-lg font-bold text-destructive">
            <TicketX className="h-6 w-6" /> TICKET CANCELLED
          </p>
          <div className="mt-3 grid gap-2 text-sm">
            <Row label="Attendee" value={t.attendeeName || '—'} strong />
            <Row label="Ticket Code" value={t.ticketCode} mono />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">This ticket was cancelled and cannot be used for entry.</p>
        </CardContent>
      </Card>
    )
  }

  // INVALID or NOT_ASSIGNED (or missing ticket payload)
  const reason =
    result.result === 'NOT_ASSIGNED'
      ? 'This ticket belongs to an event you are not assigned to.'
      : (result.error ?? 'Ticket not found — check the code and try again.')
  return (
    <Card className="border-destructive/60 bg-destructive/5">
      <CardContent className="p-4 sm:p-5">
        <p className="flex items-center gap-2 text-lg font-bold text-destructive">
          <TicketX className="h-6 w-6" /> ❌ INVALID TICKET
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{reason}</p>
      </CardContent>
    </Card>
  )
}

function Row({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-right break-all ${strong ? 'text-base font-semibold' : 'font-medium'} ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  )
}


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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ScanLine className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Check-in Scanner</h1>
            <p className="text-sm text-muted-foreground">
              Welcome{user?.name ? `, ${user.name}` : ''} — select one of your assigned events to start scanning.
            </p>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-60 rounded-xl" />
          ))}
        </div>
      ) : assignments.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No event assignments"
          description="You are not assigned to any events yet — contact your organizer to get access."
          action={
            <Button asChild variant="outline">
              <Link href={paths.home()}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Go Home
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assignments.map((a) => {
            const pct = a.totalTickets > 0 ? Math.round((a.checkedInCount / a.totalTickets) * 100) : 0
            return (
              <Link
                key={a.id}
                href={paths.staffCheckIn(a.event.id)}
                className="group overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Scan tickets for ${a.event.title}`}
              >
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                  {a.event.banner ? (
                     
                    <img
                      src={a.event.banner}
                      alt={`${a.event.title} banner`}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-primary/10 text-4xl">🎟️</div>
                  )}
                  <div className="absolute right-2 top-2">
                    <Badge className="bg-background/90 text-foreground backdrop-blur hover:bg-background/90">
                      {a.event.status === 'ONGOING' ? '● Ongoing' : a.event.status}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-2 p-4">
                  <h3 className="font-semibold leading-snug group-hover:text-primary">{a.event.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {a.event.venue}, {a.event.city}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatEventDate(a.event.startDate)} · {formatTime(a.event.startTime)}
                  </p>
                  <div className="pt-1">
                    <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Checked in</span>
                      <span>
                        {a.checkedInCount}/{a.totalTickets}
                      </span>
                    </div>
                    <Progress value={pct} />
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
