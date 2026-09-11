'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  Loader2,
  Lock,
  MapPin,
  Minus,
  Plus,
  QrCode,
  ShieldCheck,
  Ticket as TicketIcon,
  UserRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { apiGet, apiPost } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { paths } from '@/lib/routes'
import { formatMinor, formatEventDate, formatTime } from '@/lib/format'
import { orderTotals } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { CheckoutItem, EventDetail as EventDetailDTO, TicketTypeDTO } from '@/lib/types'
import { StepRail } from '@/components/customer/checkout-steps'
import { CategoryIcon } from '@/components/app/category-icon'
import { EmptyState } from '@/components/app/empty-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ticketWindow } from '@/lib/ticket-window'

interface CreateOrderResponse {
  order: {
    id: string
    orderNumber: string
    subtotalMinor: number
    discountMinor: number
    platformFeeMinor: number
    totalMinor: number
    eventId: string
  }
}

// ───────────────────────────────────────────────────────── validation

type FieldName = 'name' | 'email' | 'phone'
type Errors = Partial<Record<FieldName | 'terms', string>>

/** Deliberately permissive: enough to catch a typo, not to police addresses. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Bangladeshi mobile: 01XXXXXXXXX, optionally +88 / 0088 prefixed. */
const PHONE_RE = /^(?:\+?88)?01[3-9]\d{8}$/

function validateName(v: string): string | undefined {
  const t = v.trim()
  if (!t) return 'Enter the attendee’s full name.'
  if (t.length < 2) return 'That name looks too short.'
  return undefined
}

function validateEmail(v: string): string | undefined {
  const t = v.trim()
  if (!t) return 'Enter an email — the e-ticket is sent here.'
  if (!EMAIL_RE.test(t)) return 'That email address does not look right.'
  return undefined
}

function validatePhone(v: string): string | undefined {
  const t = v.replace(/[\s-]/g, '')
  if (!t) return 'Enter a mobile number.'
  if (!PHONE_RE.test(t)) return 'Use a Bangladeshi mobile number, e.g. 01712345678.'
  return undefined
}

// ───────────────────────────────────────────────────────── small parts

function Panel({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-2xl border border-border/70 bg-card shadow-sm', className)}>
      <header className="flex items-center gap-3 border-b border-border/70 bg-muted/35 px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

/** Field wrapper: visible label, inline error, and the wiring that announces it. */
function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      {error ? (
        // Announced the moment it appears, rather than shown only in a toast
        // that has already faded by the time the field is reached again.
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function Stepper({
  value,
  max,
  label,
  onChange,
}: {
  value: number
  max: number
  label: string
  onChange: (delta: number) => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-background p-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 rounded-lg"
        disabled={value === 0}
        onClick={() => onChange(-1)}
        aria-label={`Remove one ${label} ticket`}
      >
        <Minus className="size-4" aria-hidden="true" />
      </Button>
      <span
        className="w-8 text-center text-sm font-semibold tabular-nums"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="sr-only">{label}: </span>
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 rounded-lg"
        disabled={value >= max}
        onClick={() => onChange(1)}
        aria-label={`Add one ${label} ticket`}
      >
        <Plus className="size-4" aria-hidden="true" />
      </Button>
    </div>
  )
}

// ───────────────────────────────────────────────────────── page

export function Checkout({
  eventId,
  items: handoffItems,
}: {
  eventId: string
  /**
   * Selection handed over from the event page, decoded from `?t=` by the route.
   * It travels in the URL rather than in memory, so a refresh on the checkout
   * page keeps the tickets the customer actually picked.
   */
  items?: CheckoutItem[]
}) {
  const router = useRouter()
  const user = useAppStore((s) => s.user)

  const [name, setName] = useState(() => user?.name ?? '')
  const [email, setEmail] = useState(() => user?.email ?? '')
  const [phone, setPhone] = useState(() => user?.phone ?? '')
  const [agreed, setAgreed] = useState(false)
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [touched, setTouched] = useState<Partial<Record<FieldName | 'terms', boolean>>>({})

  const initedRef = useRef<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)

  const query = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => apiGet<{ event: EventDetailDTO }>(`/api/events/${eventId}`),
  })
  const event = query.data?.event

  // Initial selection, derived until the user interacts (no setState-in-effect):
  // honour what was picked on the event page, clamped to what is still
  // available, and only fall back to "1 of the first purchasable type" when
  // the user arrived without a selection.
  const effQtys = useMemo<Record<string, number>>(() => {
    if (!event) return {}
    if (initedRef.current === event.id) return qtys

    const requested = new Map((handoffItems ?? []).map((i) => [i.ticketTypeId, i.quantity]))
    const initial: Record<string, number> = {}
    let seeded = false
    for (const t of event.ticketTypes) {
      const win = ticketWindow(t)
      const want = requested.get(t.id) ?? 0
      if (win.purchasable && want > 0) {
        initial[t.id] = Math.min(want, win.max)
        seeded = true
      } else {
        initial[t.id] = 0
      }
    }
    if (!seeded) {
      for (const t of event.ticketTypes) {
        if (ticketWindow(t).purchasable) {
          initial[t.id] = 1
          break
        }
      }
    }
    return initial
  }, [event, qtys, handoffItems])

  // The same helper the order route uses server-side, so the total quoted here
  // is the total that gets stored, fee rounding included.
  const { subtotalMinor, platformFeeMinor: feeMinor, totalMinor } = useMemo(
    () =>
      orderTotals(
        event
          ? event.ticketTypes.map((t) => ({
              unitPriceMinor: t.priceMinor,
              quantity: effQtys[t.id] ?? 0,
            }))
          : [],
      ),
    [event, effQtys],
  )
  const totalQty = event ? event.ticketTypes.reduce((acc, t) => acc + (effQtys[t.id] ?? 0), 0) : 0
  const selectedLines = (event?.ticketTypes ?? []).filter((t) => (effQtys[t.id] ?? 0) > 0)

  // Errors are derived, so they clear as soon as the field is fixed. `touched`
  // decides whether one is shown yet — nobody wants "required" on a pristine form.
  const errors: Errors = useMemo(() => {
    const e: Errors = {}
    const n = validateName(name)
    const em = validateEmail(email)
    const p = validatePhone(phone)
    if (n) e.name = n
    if (em) e.email = em
    if (p) e.phone = p
    if (!agreed) e.terms = 'Please accept the terms to continue.'
    return e
  }, [name, email, phone, agreed])

  const shown = (f: FieldName | 'terms') => (touched[f] ? errors[f] : undefined)

  function changeQty(t: TicketTypeDTO, delta: number) {
    const win = ticketWindow(t)
    if (event && initedRef.current !== event.id) initedRef.current = event.id
    const cur = effQtys[t.id] ?? 0
    const next = win.purchasable ? Math.min(Math.max(0, cur + delta), Math.max(0, win.max)) : 0
    setQtys((prev) => ({ ...prev, [t.id]: next }))
  }

  const createOrder = useMutation({
    mutationFn: (payload: {
      eventId: string
      items: Array<{ ticketTypeId: string; quantity: number }>
      attendee: { name: string; email: string; phone: string }
    }) => apiPost<CreateOrderResponse>('/api/orders', payload),
    onSuccess: (data) => {
      toast.success('Order created — taking you to payment…')
      router.push(paths.order(data.order.id))
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create order')
    },
  })

  function handleSubmit() {
    if (!event) return

    if (totalQty === 0) {
      toast.error('Pick at least one ticket to continue.')
      return
    }

    // Reveal every message at once, then send focus to the first thing to fix
    // rather than leaving the buyer to hunt for it.
    setTouched({ name: true, email: true, phone: true, terms: true })
    const firstInvalid = (['name', 'email', 'phone'] as const).find((f) => errors[f])
    if (firstInvalid) {
      const ref = { name: nameRef, email: emailRef, phone: phoneRef }[firstInvalid]
      ref.current?.focus()
      return
    }
    if (errors.terms) return

    createOrder.mutate({
      eventId,
      items: selectedLines.map((t) => ({ ticketTypeId: t.id, quantity: effQtys[t.id] ?? 0 })),
      attendee: { name: name.trim(), email: email.trim(), phone: phone.replace(/[\s-]/g, '') },
    })
  }

  if (query.isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <EmptyState
          icon={CalendarDays}
          title="Event not found"
          description="We could not load this event for checkout."
          action={
            <Button asChild>
              <Link href={paths.events()}>
                <ArrowLeft className="size-4" /> Back to events
              </Link>
            </Button>
          }
        />
      </div>
    )
  }

  if (query.isLoading || !event) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-72 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-96 w-full rounded-2xl lg:col-span-2" />
        </div>
      </div>
    )
  }

  const payDisabled = createOrder.isPending || totalQty === 0

  // ── the summary, shared by the sidebar and (totals only) the mobile bar ──
  const summary = (
    <>
      {selectedLines.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/25 px-4 py-6 text-center text-sm text-muted-foreground">
          No tickets selected yet.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {selectedLines.map((t) => {
            const qty = effQtys[t.id] ?? 0
            return (
              <li key={t.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{t.name}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                    {qty} × {t.priceMinor === 0 ? 'Free' : formatMinor(t.priceMinor)}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatMinor(qty * t.priceMinor)}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <dl className="mt-5 space-y-2 border-t border-border/70 pt-4 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">
            Subtotal · {totalQty} ticket{totalQty === 1 ? '' : 's'}
          </dt>
          <dd className="tabular-nums">{formatMinor(subtotalMinor)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Platform fee · 3%</dt>
          <dd className="tabular-nums">{formatMinor(feeMinor)}</dd>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-border/70 pt-3">
          <dt className="text-sm font-semibold">Total</dt>
          <dd className="text-xl font-semibold tracking-tight text-primary tabular-nums">
            {formatMinor(totalMinor)}
          </dd>
        </div>
      </dl>
    </>
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 pb-28 sm:px-6 lg:pb-8">
      {/* ── header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Secure checkout
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Confirm your tickets
          </h1>
        </div>
        <Button asChild variant="ghost" size="sm" className="-mr-2">
          <Link href={paths.event(eventId)}>
            <ArrowLeft className="size-4" /> Back to event
          </Link>
        </Button>
      </div>

      <div className="mt-5">
        <StepRail current={1} />
      </div>

      {/* ── event strip ── */}
      <div className="mt-6 flex items-center gap-4 rounded-2xl border border-border/70 bg-card p-3 shadow-sm sm:p-4">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted sm:h-16 sm:w-24">
          {event.banner ? (
             
            <img
              src={event.banner}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-accent text-primary/70"
              aria-hidden="true"
            >
              <CategoryIcon category={event.category} className="size-6" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={paths.event(eventId)}
            className="line-clamp-1 font-semibold tracking-tight transition-colors duration-200 hover:text-primary"
          >
            {event.title}
          </Link>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {formatEventDate(event.startDate)} · {formatTime(event.startTime)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5" aria-hidden="true" />
              {event.venue}, {event.city}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* ── left column: the decisions ── */}
        <div className="space-y-6 lg:col-span-3">
          {/* Ticket selection was previously squeezed into the narrow sticky
              summary as a four-column table with 28px steppers. It is the main
              decision on this page, so it gets the main column. */}
          <Panel
            icon={TicketIcon}
            title="Your tickets"
            description="Adjust quantities before you pay."
          >
            <ul className="divide-y divide-border/70">
              {event.ticketTypes.map((t) => {
                const win = ticketWindow(t)
                const qty = effQtys[t.id] ?? 0
                const lineTotal = qty * t.priceMinor
                return (
                  <li
                    key={t.id}
                    className={cn(
                      'flex flex-wrap items-center gap-x-4 gap-y-3 py-4 first:pt-0 last:pb-0',
                      !win.purchasable && 'opacity-60',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <p className="font-medium tracking-tight">{t.name}</p>
                        <p className="text-sm text-muted-foreground tabular-nums">
                          {t.priceMinor === 0 ? 'Free' : formatMinor(t.priceMinor)}
                        </p>
                      </div>
                      {t.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {t.description}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] font-medium">
                        {!win.purchasable ? (
                          <span className="text-muted-foreground">
                            {win.soldOut
                              ? 'Sold out'
                              : win.closed
                                ? 'Sales closed'
                                : 'Sales not open yet'}
                          </span>
                        ) : win.available <= 10 ? (
                          <span className="text-destructive">Only {win.available} left</span>
                        ) : (
                          <span className="text-muted-foreground tabular-nums">
                            Max {win.max} per order
                          </span>
                        )}
                      </p>
                    </div>

                    {win.purchasable ? (
                      <Stepper
                        value={qty}
                        max={win.max}
                        label={t.name}
                        onChange={(d) => changeQty(t, d)}
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">Unavailable</span>
                    )}

                    <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">
                      {qty > 0 ? formatMinor(lineTotal) : '—'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Panel>

          <Panel
            icon={UserRound}
            title="Attendee details"
            description="Every ticket in this order is issued to this person."
          >
            <div className="space-y-4">
              <Field id="attendee-name" label="Full name" error={shown('name')}>
                <Input
                  id="attendee-name"
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  placeholder="e.g. Jubair Hossain"
                  autoComplete="name"
                  className="h-11"
                  aria-invalid={!!shown('name')}
                  aria-describedby={shown('name') ? 'attendee-name-error' : undefined}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="attendee-email"
                  label="Email"
                  error={shown('email')}
                  hint="Your e-ticket is sent here."
                >
                  <Input
                    id="attendee-email"
                    ref={emailRef}
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="h-11"
                    aria-invalid={!!shown('email')}
                    aria-describedby={
                      shown('email') ? 'attendee-email-error' : 'attendee-email-hint'
                    }
                  />
                </Field>

                <Field
                  id="attendee-phone"
                  label="Mobile number"
                  error={shown('phone')}
                  hint="For gate contact and payment."
                >
                  <Input
                    id="attendee-phone"
                    ref={phoneRef}
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                    placeholder="01712345678"
                    autoComplete="tel"
                    className="h-11"
                    aria-invalid={!!shown('phone')}
                    aria-describedby={
                      shown('phone') ? 'attendee-phone-error' : 'attendee-phone-hint'
                    }
                  />
                </Field>
              </div>
            </div>
          </Panel>
        </div>

        {/* ── right column: the summary ── */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-24">
            <section className="rounded-2xl border border-border/70 bg-card shadow-sm">
              <header className="flex items-center gap-3 border-b border-border/70 bg-muted/35 px-5 py-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BadgeCheck className="size-[18px]" aria-hidden="true" />
                </span>
                <h2 className="text-sm font-semibold tracking-tight">Order summary</h2>
              </header>

              <div className="p-5">
                {summary}

                <div className="mt-5 flex items-start gap-2.5">
                  <Checkbox
                    id="terms"
                    checked={agreed}
                    onCheckedChange={(v) => {
                      setAgreed(v === true)
                      setTouched((t) => ({ ...t, terms: true }))
                    }}
                    className="mt-0.5"
                    aria-invalid={!!shown('terms')}
                    aria-describedby={shown('terms') ? 'terms-error' : undefined}
                  />
                  <div className="space-y-1">
                    <Label
                      htmlFor="terms"
                      className="text-xs font-normal leading-relaxed text-muted-foreground"
                    >
                      I agree to the event terms and the refund policy.
                    </Label>
                    {shown('terms') && (
                      <p id="terms-error" role="alert" className="text-xs font-medium text-destructive">
                        {shown('terms')}
                      </p>
                    )}
                  </div>
                </div>

                <Button
                  className="mt-5 h-12 w-full text-[15px] shadow-sm transition-transform active:scale-[0.99] motion-reduce:transform-none"
                  onClick={handleSubmit}
                  disabled={payDisabled}
                >
                  {createOrder.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Creating order…
                    </>
                  ) : (
                    <>
                      <Lock className="size-4" aria-hidden="true" /> Continue to payment
                    </>
                  )}
                </Button>

                {/* Says plainly that this button does not take the money — the
                    single most common reason a checkout gets abandoned here. */}
                <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
                  No charge yet — you pay on the next screen.
                </p>

                <ul className="mt-4 space-y-1.5 rounded-xl bg-muted/40 p-3">
                  {[
                    { icon: ShieldCheck, text: 'Payment handled by SSLCOMMERZ' },
                    { icon: QrCode, text: 'QR e-ticket issued the moment payment clears' },
                    { icon: BadgeCheck, text: 'Duplicate check-ins blocked at the gate' },
                  ].map((item) => (
                    <li
                      key={item.text}
                      className="flex items-center gap-2 text-[11px] text-muted-foreground"
                    >
                      <item.icon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                      {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* ── mobile pay bar ──
          The desktop summary is sticky; on a phone the total and the button sat
          below a long form, so the running cost was invisible while choosing. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Total
            </p>
            <p className="text-lg font-semibold leading-tight tracking-tight text-primary tabular-nums">
              {formatMinor(totalMinor)}
            </p>
          </div>
          <Button
            className="h-12 flex-1 text-[15px] transition-transform active:scale-[0.99] motion-reduce:transform-none"
            onClick={handleSubmit}
            disabled={payDisabled}
          >
            {createOrder.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Creating…
              </>
            ) : (
              <>
                <Lock className="size-4" aria-hidden="true" /> Continue
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
