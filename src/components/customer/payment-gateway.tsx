'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Check,
  CreditCard,
  Loader2,
  Lock,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import { apiGet, apiPost } from '@/lib/api'
import { paths } from '@/lib/routes'
import { formatMinor, formatEventDate, formatTime } from '@/lib/format'
import { PAYMENT_METHODS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { OrderDTO } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/empty-state'
import { StepRail } from '@/components/customer/checkout-steps'

type PayMethod = (typeof PAYMENT_METHODS)[number]['value']
type Phase = 'select' | 'processing' | 'failed'

export function PaymentGateway({ orderId }: { orderId: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [method, setMethod] = useState<PayMethod | null>(null)
  const [phase, setPhase] = useState<Phase>('select')
  const [failureError, setFailureError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => apiGet<{ order: OrderDTO }>(`/api/orders/${orderId}`),
  })
  const order = query.data?.order

  // Idempotent guard: already paid → go to the verified success page
  // (navigation is external to React state, so this is not setState-in-effect)
  useEffect(() => {
    if (order?.paymentStatus === 'PAID') {
      router.push(paths.orderSuccess(orderId))
    }
  }, [order?.paymentStatus, router, orderId])

  // Derived failure state (server-reported failure surfaces even on first render)
  const serverFailed = order?.paymentStatus === 'FAILED'
  const showFailed = phase === 'failed' || (phase === 'select' && serverFailed)
  const failMsg =
    failureError ??
    (serverFailed
      ? 'A previous payment attempt failed. Please try again.'
      : 'Your payment could not be completed. No amount was charged.')

  const execute = useMutation({
    mutationFn: (input: { method: PayMethod; outcome: 'SUCCESS' | 'FAILED' }) =>
      apiPost<{ status: 'PAID' | 'FAILED'; orderId?: string; error?: string }>('/api/payments/execute', {
        orderId,
        ...input,
      }),
  })

  async function run(outcome: 'SUCCESS' | 'FAILED') {
    if (!method) {
      toast.error('Please select a payment method first.')
      return
    }
    setPhase('processing')
    setFailureError(null)
    try {
      // Simulated gateway roundtrip (SSLCOMMERZ → IPN)
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const res = await execute.mutateAsync({ method, outcome })
      if (res.status === 'PAID') {
        // Drop the stale cached order so the success page re-verifies server-side
        queryClient.removeQueries({ queryKey: ['order', orderId] })
        queryClient.invalidateQueries({ queryKey: ['orders', 'mine'] })
        toast.success('Payment successful!')
        router.push(paths.orderSuccess(orderId))
      } else {
        setFailureError(res.error || 'Your payment could not be completed.')
        setPhase('failed')
        toast.error('Payment failed. Please try again.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment processing error.'
      setFailureError(msg)
      setPhase('failed')
      toast.error(msg)
    }
  }

  if (query.isError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <EmptyState
          icon={AlertCircle}
          title="Order not found"
          description="This order does not exist, or it belongs to another account."
          action={
            <Button asChild>
              <Link href={paths.tickets()}>
                <ArrowLeft className="size-4" /> Back to my tickets
              </Link>
            </Button>
          }
        />
      </div>
    )
  }

  if (query.isLoading || !order) {
    return (
      <div className="mx-auto max-w-lg space-y-5 px-4 py-8 sm:px-6">
        <Skeleton className="h-7 w-56 rounded-lg" />
        <Skeleton className="h-[34rem] w-full rounded-2xl" />
      </div>
    )
  }

  const busy = phase === 'processing' || execute.isPending
  const ticketCount = order.tickets?.length ?? 0

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6">
      <StepRail current={2} className="mb-6" />

      {/* The gateway is a different system from the shop, and should look it.
          Built from `foreground`/`background` rather than hardcoded zinc, so
          the distinction survives dark mode instead of inverting into it. */}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-lg shadow-black/5">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-foreground px-5 py-4 text-background">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="size-6 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">SSLCOMMERZ Secure Payment</p>
              <p className="text-xs opacity-70">256-bit SSL encrypted transaction</p>
            </div>
          </div>
          <span className="rounded-full bg-chart-5/20 px-2.5 py-1 text-[11px] font-semibold text-chart-5 ring-1 ring-inset ring-chart-5/40">
            Demo mode
          </span>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          {/* ── what is being paid for ── */}
          <dl className="space-y-2 rounded-xl border border-border/70 bg-muted/35 p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">Merchant</dt>
              <dd className="font-medium">TicketBD</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">Order</dt>
              <dd className="font-mono text-xs font-medium">{order.orderNumber}</dd>
            </div>
            {order.event && (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-muted-foreground">Event</dt>
                  <dd className="line-clamp-1 text-right font-medium">{order.event.title}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-muted-foreground">
                    <CalendarDays className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
                    Date
                  </dt>
                  <dd className="text-right">
                    {formatEventDate(order.event.startDate)} · {formatTime(order.event.startTime)}
                  </dd>
                </div>
              </>
            )}
            {ticketCount > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">Tickets</dt>
                <dd className="tabular-nums">{ticketCount}</dd>
              </div>
            )}
          </dl>

          {/* ── the amount, given the emphasis it deserves ── */}
          <div className="rounded-xl bg-primary/10 p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Amount payable
            </p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-primary tabular-nums">
              {formatMinor(order.totalMinor)}
            </p>
          </div>

          {showFailed ? (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertTitle>Payment failed</AlertTitle>
                <AlertDescription>{failMsg}</AlertDescription>
              </Alert>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  className="h-11 flex-1"
                  onClick={() => {
                    setPhase('select')
                    setFailureError(null)
                  }}
                >
                  Try again
                </Button>
                <Button asChild variant="ghost" className="h-11 flex-1">
                  <Link href={paths.tickets()}>Back to my tickets</Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* ── method choice ──
                  A real radiogroup rather than a row of aria-pressed buttons:
                  these are mutually exclusive, and assistive tech should say so. */}
              <div>
                <p id="method-label" className="mb-3 text-sm font-semibold tracking-tight">
                  Choose how to pay
                </p>
                <div className="space-y-2.5" role="radiogroup" aria-labelledby="method-label">
                  {PAYMENT_METHODS.map((pm) => {
                    const active = method === pm.value
                    const Icon = pm.value === 'CARD' ? CreditCard : Smartphone
                    return (
                      <button
                        key={pm.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setMethod(pm.value)}
                        disabled={busy}
                        className={cn(
                          'flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-left',
                          'transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          active
                            ? 'border-transparent shadow-sm ring-2'
                            : 'border-border/70 hover:border-primary/40 hover:bg-muted/40',
                        )}
                        // Wallet brands are identified by their own colours —
                        // bKash pink is bKash pink, not a theme token.
                        style={active ? { backgroundColor: `${pm.color}12`, boxShadow: `0 0 0 2px ${pm.color}` } : undefined}
                      >
                        <span
                          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white"
                          style={{ backgroundColor: pm.color }}
                        >
                          <Icon className="size-5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{pm.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">{pm.desc}</span>
                        </span>
                        <span
                          className={cn(
                            'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-200',
                            active ? 'border-transparent text-white' : 'border-border',
                          )}
                          style={active ? { backgroundColor: pm.color } : undefined}
                          aria-hidden="true"
                        >
                          {active && <Check className="size-3" />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <Button
                className="h-12 w-full text-[15px] shadow-sm transition-transform active:scale-[0.99] motion-reduce:transform-none"
                disabled={!method || busy}
                onClick={() => run('SUCCESS')}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Contacting gateway…
                  </>
                ) : (
                  <>
                    <Lock className="size-4" aria-hidden="true" /> Pay {formatMinor(order.totalMinor)}
                  </>
                )}
              </Button>

              {/* Announced, so a screen reader hears the wait rather than
                  meeting a silently disabled button. */}
              <p role="status" aria-live="polite" className="sr-only">
                {busy ? 'Contacting the payment gateway, please wait.' : ''}
              </p>

              <div className="rounded-xl border border-dashed border-border bg-muted/25 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Demo controls
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No real money moves in demo mode. Use this to see how a declined payment behaves.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-9 w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy}
                  onClick={() => run('FAILED')}
                >
                  Simulate a failed payment
                </Button>
              </div>
            </>
          )}

          <p className="flex items-start justify-center gap-1.5 text-center text-[11px] leading-relaxed text-muted-foreground">
            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            Tickets are issued only after the server verifies payment (IPN).
          </p>
        </div>
      </div>

      <div className="mt-4 text-center">
        <Button asChild variant="ghost" size="sm">
          <Link href={paths.tickets()}>
            <ArrowLeft className="size-4" /> Back to my tickets
          </Link>
        </Button>
      </div>
    </div>
  )
}
