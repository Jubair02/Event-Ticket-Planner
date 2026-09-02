'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import { apiGet, apiPost } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { formatBDT, formatEventDate, formatTime } from '@/lib/format'
import { PAYMENT_METHODS } from '@/lib/constants'
import type { OrderDTO } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/empty-state'
import { cn } from '@/lib/utils'

type PayMethod = (typeof PAYMENT_METHODS)[number]['value']
type Phase = 'select' | 'processing' | 'failed'

export function PaymentGateway({ orderId }: { orderId: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const queryClient = useQueryClient()

  const [method, setMethod] = useState<PayMethod | null>(null)
  const [phase, setPhase] = useState<Phase>('select')
  const [failureError, setFailureError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => apiGet<{ order: OrderDTO }>(`/api/orders/${orderId}`),
  })
  const order = query.data?.order

  // Idempotent guard: already paid → go to the verified success page (navigate is external, no setState)
  useEffect(() => {
    if (order?.paymentStatus === 'PAID') {
      navigate({ name: 'payment-success', orderId })
    }
  }, [order?.paymentStatus, navigate, orderId])

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
        navigate({ name: 'payment-success', orderId })
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
          description="This order does not exist or you do not have access to it."
          action={
            <Button onClick={() => navigate({ name: 'my-tickets' })}>
              <ArrowLeft className="h-4 w-4" /> Back to My Tickets
            </Button>
          }
        />
      </div>
    )
  }

  if (query.isLoading || !order) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Skeleton className="mx-auto h-[560px] w-full max-w-lg rounded-2xl" />
      </div>
    )
  }

  const busy = phase === 'processing' || execute.isPending

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-lg">
        <Card className="gap-0 overflow-hidden p-0 shadow-lg">
          {/* Gateway header */}
          <div className="flex items-center justify-between gap-3 bg-zinc-900 px-6 py-4 text-white">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-400" />
              <div>
                <p className="text-sm font-semibold leading-tight">SSLCOMMERZ Secure Payment Gateway</p>
                <p className="text-xs text-zinc-400">256-bit SSL encrypted transaction</p>
              </div>
            </div>
            <Badge className="border-amber-400/40 bg-amber-400/15 text-amber-300 hover:bg-amber-400/15">
              Demo Mode
            </Badge>
          </div>

          {/* Body */}
          <div className="space-y-5 p-6">
            {/* Merchant + order info */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Merchant</span>
              <span className="font-semibold">TicketBD</span>
            </div>
            <div className="rounded-xl border bg-muted/40 p-4">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Order</span>
                <span className="font-mono font-medium">{order.orderNumber}</span>
              </div>
              {order.event && (
                <>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">Event</span>
                    <span className="line-clamp-1 text-right font-medium">{order.event.title}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">Date</span>
                    <span>
                      {formatEventDate(order.event.startDate)} · {formatTime(order.event.startTime)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Amount */}
            <div className="rounded-xl bg-primary/10 p-4 text-center">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Amount Payable</p>
              <p className="mt-1 text-3xl font-bold text-primary">{formatBDT(order.totalAmount)}</p>
            </div>

            {showFailed ? (
              /* Failure state */
              <div className="space-y-4">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Payment failed</AlertTitle>
                  <AlertDescription>
                    {failMsg}
                  </AlertDescription>
                </Alert>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="outline" className="flex-1" onClick={() => setPhase('select')}>
                    Try Again
                  </Button>
                  <Button variant="ghost" className="flex-1" onClick={() => navigate({ name: 'my-tickets' })}>
                    Back to My Tickets
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Separator />
                {/* Method selection */}
                <div>
                  <p className="mb-3 text-sm font-semibold">Choose payment method</p>
                  <div className="space-y-3">
                    {PAYMENT_METHODS.map((pm) => {
                      const active = method === pm.value
                      const Icon = pm.value === 'CARD' ? CreditCard : Smartphone
                      return (
                        <button
                          key={pm.value}
                          type="button"
                          onClick={() => setMethod(pm.value)}
                          disabled={busy}
                          aria-pressed={active}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition-all disabled:opacity-60',
                            !active && 'border-border hover:border-primary/40 hover:bg-muted/40',
                          )}
                          style={
                            active
                              ? { borderColor: pm.color, backgroundColor: `${pm.color}14` }
                              : undefined
                          }
                        >
                          <span
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
                            style={{ backgroundColor: pm.color }}
                          >
                            <Icon className="h-5 w-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">{pm.label}</span>
                            <span className="block truncate text-xs text-muted-foreground">{pm.desc}</span>
                          </span>
                          {active && <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: pm.color }} />}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <Button
                  className="w-full"
                  size="lg"
                  disabled={!method || busy}
                  onClick={() => run('SUCCESS')}
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Processing on gateway…
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4" /> Pay {formatBDT(order.totalAmount)}
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => run('FAILED')}
                >
                  Simulate failed payment
                </Button>
              </>
            )}

            {/* Security note */}
            <p className="flex items-start justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              Tickets are generated only after server-side payment verification (IPN).
            </p>
          </div>
        </Card>

        <div className="mt-4 text-center">
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'my-tickets' })}>
            <ArrowLeft className="h-4 w-4" /> Back to My Tickets
          </Button>
        </div>
      </div>
    </div>
  )
}
