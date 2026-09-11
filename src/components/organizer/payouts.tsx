'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BanknoteArrowUp,
  Clock,
  Loader2,
  Plus,
  Star,
  Trash2,
  Wallet,
} from 'lucide-react'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import { formatEventDate, formatMinor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toMinor } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/app/empty-state'
import {
  HeroMetric,
  MetricGroup,
  Panel,
  SectionHeading,
  entrance,
} from '@/components/dashboard/primitives'

interface Balances {
  availableMinor: number
  reservedMinor: number
  pendingMinor: number
  paidMinor: number
  grossSalesMinor: number
  platformFeesMinor: number
  refundsMinor: number
  adjustmentsMinor: number
  balanceMinor: number
  nextMaturityAt: string | null
}

interface MethodRow {
  id: string
  type: string
  typeLabel: string
  accountName: string
  accountLast4: string
  bankName: string | null
  branch: string | null
  isDefault: boolean
  archived: boolean
  createdAt: string
}

interface PayoutRow {
  id: string
  reference: string
  amountMinor: number
  status: string
  statusLabel: string
  note: string | null
  reviewNote: string | null
  transferRef: string | null
  paidAt: string | null
  createdAt: string
  method: { typeLabel: string; accountLast4: string } | null
}

interface LedgerRow {
  id: string
  type: string
  typeLabel: string
  amountMinor: number
  availableAt: string | null
  pending: boolean
  description: string
  occurredAt: string
}

interface WalletResponse {
  balances: Balances
  methods: MethodRow[]
  payouts: PayoutRow[]
  recentLedger: LedgerRow[]
  policy: { holdDays: number; minPayoutMinor: number }
}

/**
 * Payout status tones.
 *
 * The colour rides the **border and the tint, never the label**. Setting the
 * text to its own tone is what the previous version did, and the two most
 * common statuses failed WCAG badly against their own backgrounds:
 * `text-chart-5` on `bg-chart-5/10` measures **1.92:1** and `text-chart-2` on
 * `bg-chart-2/10` measures **2.97:1**, against a 4.5:1 floor for 12px text.
 * `text-foreground` on the same tints measures ~18:1, and this is already the
 * convention `EventStatusBadge` uses for its "needs attention" state.
 *
 * A stronger border (`/50` rather than `/20`) keeps the statuses as easy to
 * tell apart as they were, and the label is always spelled out, so the tone is
 * never the only signal.
 */
const STATUS_TONE: Record<string, string> = {
  PAID: 'border-primary/50 bg-primary/10 text-foreground',
  APPROVED: 'border-chart-2/50 bg-chart-2/10 text-foreground',
  REQUESTED: 'border-chart-5/60 bg-chart-5/10 text-foreground',
  REJECTED: 'border-destructive/50 bg-destructive/10 text-foreground',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
}

export function OrganizerPayouts() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['organizer-wallet'],
    queryFn: () => apiGet<WalletResponse>('/api/organizer/wallet'),
  })

  const b = data?.balances
  const methods = data?.methods ?? []
  const payouts = data?.payouts ?? []
  const ledger = data?.recentLedger ?? []
  const minPayoutMinor = data?.policy.minPayoutMinor ?? 0
  const holdDays = data?.policy.holdDays ?? 0

  function refresh() {
    qc.invalidateQueries({ queryKey: ['organizer-wallet'] })
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroMetric
          label="Available to withdraw"
          value={formatMinor(b?.availableMinor ?? 0)}
          hint={
            b?.nextMaturityAt
              ? `${formatMinor(b.pendingMinor)} clears from ${formatEventDate(b.nextMaturityAt)}`
              : `Sales clear ${holdDays} days after an event ends`
          }
          loading={isLoading}
          icon={Wallet}
          {...entrance(0)}
          className={cn('lg:col-span-2', entrance(0).className)}
        >
          <div className="relative mt-4">
            <RequestPayoutDialog
              methods={methods.filter((m) => !m.archived)}
              availableMinor={b?.availableMinor ?? 0}
              minPayoutMinor={minPayoutMinor}
              onDone={refresh}
            />
          </div>
        </HeroMetric>

        <MetricGroup
          title="Your balance"
          loading={isLoading}
          items={[
            { label: 'Pending (held)', value: formatMinor(b?.pendingMinor ?? 0) },
            { label: 'Reserved by requests', value: formatMinor(b?.reservedMinor ?? 0) },
            { label: 'Paid out to date', value: formatMinor(b?.paidMinor ?? 0) },
            { label: 'Gross sales', value: formatMinor(b?.grossSalesMinor ?? 0) },
            { label: 'Platform fees', value: formatMinor(b?.platformFeesMinor ?? 0) },
            { label: 'Refunds', value: formatMinor(b?.refundsMinor ?? 0) },
          ]}
          {...entrance(1)}
        />
      </div>

      <section
        aria-labelledby="methods-heading"
        {...entrance(2)}
        className={cn('space-y-4', entrance(2).className)}
      >
        <SectionHeading
          id="methods-heading"
          title="Where the money goes"
          description="We only keep the last four digits of an account. Add up to five destinations."
        >
          <AddMethodDialog onDone={refresh} />
        </SectionHeading>

        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : methods.length === 0 ? (
          <EmptyState
            icon={BanknoteArrowUp}
            title="No payout destination yet"
            description="Add a bKash, Nagad or bank account so we know where to send your earnings."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {methods.map((m) => (
              <MethodCard key={m.id} method={m} onDone={refresh} />
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="payouts-heading"
        {...entrance(3)}
        className={cn('space-y-4', entrance(3).className)}
      >
        <SectionHeading
          id="payouts-heading"
          title="Payout requests"
          description="An admin reviews each request, then transfers the money."
        />
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : payouts.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No payouts yet"
            description="Request one once your sales have cleared their hold."
          />
        ) : (
          <>
            {/* ── small screens ──
                The table needed 680px and scrolled sideways to get it. Money
                and status lead here, because that is what a request is checked
                for; the reference drops to a secondary line. */}
            <Panel padded={false} className="overflow-hidden lg:hidden">
              <h3 className="sr-only">Your payout requests</h3>
              <ul className="divide-y divide-border/70">
                {payouts.map((p) => (
                  <li key={p.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-semibold tabular-nums">
                          {formatMinor(p.amountMinor)}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                          {p.reference}
                        </p>
                      </div>
                      <Badge variant="outline" className={cn('shrink-0', STATUS_TONE[p.status])}>
                        {p.statusLabel}
                      </Badge>
                    </div>

                    <dl className="mt-2.5 space-y-1 text-xs">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Destination</dt>
                        <dd className="truncate">
                          {p.method
                            ? `${p.method.typeLabel} ····${p.method.accountLast4}`
                            : '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Requested</dt>
                        <dd className="tabular-nums">{formatEventDate(p.createdAt)}</dd>
                      </div>
                      {p.transferRef && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Transfer ref</dt>
                          <dd className="truncate font-mono">{p.transferRef}</dd>
                        </div>
                      )}
                    </dl>

                    {p.reviewNote && (
                      <p className="mt-2 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                        {p.reviewNote}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>

            {/* ── large screens ── */}
            <Panel padded={false} className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium">Reference</th>
                    <th className="px-4 py-3 font-medium">Destination</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Requested</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {payouts.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium">{p.reference}</p>
                        {p.transferRef && (
                          <p className="text-xs text-muted-foreground">Ref {p.transferRef}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.method ? `${p.method.typeLabel} ····${p.method.accountLast4}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {formatMinor(p.amountMinor)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={STATUS_TONE[p.status] ?? ''}>
                          {p.statusLabel}
                        </Badge>
                        {p.reviewNote && (
                          <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">
                            {p.reviewNote}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatEventDate(p.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </>
        )}
      </section>

      <section
        aria-labelledby="ledger-heading"
        {...entrance(4)}
        className={cn('space-y-4', entrance(4).className)}
      >
        <SectionHeading
          id="ledger-heading"
          title="Recent activity"
          description="Every movement in your balance, newest first."
        />
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : ledger.length === 0 ? (
          <EmptyState icon={Wallet} title="Nothing yet" description="Your first sale will show up here." />
        ) : (
          <Panel padded={false} className="divide-y divide-border/70">
            {ledger.map((e) => (
              <div key={e.id} className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.description || e.typeLabel}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {e.typeLabel} · {formatEventDate(e.occurredAt)}
                    {e.pending && e.availableAt
                      ? ` · clears ${formatEventDate(e.availableAt)}`
                      : ''}
                  </p>
                </div>
                {/* The sign carries the direction, so the colour is
                    reinforcement rather than the only signal. */}
                <span
                  className={cn(
                    'shrink-0 font-semibold tabular-nums',
                    e.amountMinor < 0 ? 'text-destructive' : 'text-primary',
                  )}
                >
                  {e.amountMinor > 0 ? '+' : ''}
                  {formatMinor(e.amountMinor)}
                </span>
              </div>
            ))}
          </Panel>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- dialogs

function RequestPayoutDialog({
  methods,
  availableMinor,
  minPayoutMinor,
  onDone,
}: {
  methods: MethodRow[]
  availableMinor: number
  minPayoutMinor: number
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [methodId, setMethodId] = useState('')
  const [note, setNote] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      apiPost('/api/organizer/payouts', {
        methodId,
        // The field holds taka as typed; the API takes paisa.
        amountMinor: toMinor(amount),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Payout requested', { description: 'An admin will review it shortly.' })
      setOpen(false)
      setAmount('')
      setNote('')
      onDone()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const canRequest = availableMinor >= minPayoutMinor && methods.length > 0
  const defaultMethod = methods.find((m) => m.isDefault) ?? methods[0]

  function submit() {
    const minor = toMinor(amount)
    if (minor === null || minor <= 0) return toast.error('Enter a valid amount')
    if (minor > availableMinor) {
      return toast.error(`Only ${formatMinor(availableMinor)} is available right now`)
    }
    if (minor < minPayoutMinor) {
      return toast.error(`The smallest payout is ${formatMinor(minPayoutMinor)}`)
    }
    if (!methodId && !defaultMethod) return toast.error('Add a payout destination first')
    mutation.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setMethodId(defaultMethod?.id ?? '')
      }}
    >
      <DialogTrigger asChild>
        <Button
          disabled={!canRequest}
          className="active:scale-[0.98] motion-reduce:transform-none"
          title={
            methods.length === 0
              ? 'Add a payout destination first'
              : availableMinor < minPayoutMinor
                ? `You need at least ${formatMinor(minPayoutMinor)} available`
                : undefined
          }
        >
          <BanknoteArrowUp /> Request payout
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a payout</DialogTitle>
          <DialogDescription>
            {formatMinor(availableMinor)} is available. The smallest payout is{' '}
            {formatMinor(minPayoutMinor)}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="payout-amount">Amount (৳)</Label>
            <Input
              id="payout-amount"
              inputMode="decimal"
              placeholder="e.g. 5000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payout-method">Send to</Label>
            <Select value={methodId} onValueChange={setMethodId}>
              <SelectTrigger id="payout-method">
                <SelectValue placeholder="Choose a destination" />
              </SelectTrigger>
              <SelectContent>
                {methods.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.typeLabel} ····{m.accountLast4} · {m.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payout-note">Note (optional)</Label>
            <Input
              id="payout-note"
              placeholder="Anything the reviewer should know"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="animate-spin" />} Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const METHOD_TYPES = [
  { value: 'BKASH', label: 'bKash' },
  { value: 'NAGAD', label: 'Nagad' },
  { value: 'BANK', label: 'Bank account' },
]

function AddMethodDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('BKASH')
  const [accountName, setAccountName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [bankName, setBankName] = useState('')
  const [branch, setBranch] = useState('')

  const isBank = type === 'BANK'

  const mutation = useMutation({
    mutationFn: () =>
      apiPost('/api/organizer/payout-methods', {
        type,
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        ...(isBank ? { bankName: bankName.trim(), branch: branch.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('Payout destination saved')
      setOpen(false)
      setAccountName('')
      setAccountNumber('')
      setBankName('')
      setBranch('')
      onDone()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus /> Add destination
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a payout destination</DialogTitle>
          <DialogDescription>
            Only the last four digits are stored. We never keep the full number.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="method-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="method-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHOD_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="method-name">Account holder name</Label>
            <Input
              id="method-name"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="As it appears on the account"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="method-number">
              {isBank ? 'Account number' : 'Mobile wallet number'}
            </Label>
            <Input
              id="method-number"
              inputMode="numeric"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder={isBank ? 'Digits only' : '01712345678'}
            />
          </div>
          {isBank && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="method-bank">Bank</Label>
                <Input
                  id="method-bank"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. BRAC Bank"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="method-branch">Branch (optional)</Label>
                <Input
                  id="method-branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="e.g. Gulshan"
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MethodCard({ method, onDone }: { method: MethodRow; onDone: () => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false)

  const setDefault = useMutation({
    mutationFn: () => apiPatch(`/api/organizer/payout-methods/${method.id}`, { isDefault: true }),
    onSuccess: () => {
      toast.success('Default destination updated')
      onDone()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/organizer/payout-methods/${method.id}`),
    onSuccess: () => {
      toast.success('Destination removed')
      setConfirmRemove(false)
      onDone()
    },
    onError: (e: Error) => {
      toast.error(e.message)
      setConfirmRemove(false)
    },
  })

  return (
    <Panel className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium">{method.typeLabel}</p>
          {method.isDefault && (
            <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
              Default
            </Badge>
          )}
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          ····{method.accountLast4} · {method.accountName}
        </p>
        {method.bankName && (
          <p className="truncate text-xs text-muted-foreground">
            {method.bankName}
            {method.branch ? ` · ${method.branch}` : ''}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!method.isDefault && (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 cursor-pointer"
            title={`Make ${method.typeLabel} ····${method.accountLast4} the default`}
            aria-label={`Make ${method.typeLabel} ending ${method.accountLast4} the default destination`}
            onClick={() => setDefault.mutate()}
            disabled={setDefault.isPending}
          >
            {setDefault.isPending ? <Loader2 className="animate-spin" /> : <Star />}
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-8 cursor-pointer text-destructive hover:text-destructive"
          title="Remove"
          aria-label={`Remove ${method.typeLabel} ending ${method.accountLast4}`}
          onClick={() => setConfirmRemove(true)}
          disabled={remove.isPending}
        >
          {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </Button>
      </div>

      {/* Removing a destination was a single unguarded click, unlike every
          other destructive action in the dashboard. Where the money goes is
          not the place to be the exception. */}
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this payout destination?</AlertDialogTitle>
            <AlertDialogDescription>
              {method.typeLabel} ····{method.accountLast4} ({method.accountName}) will no longer
              be available for payouts. Requests already sent for review are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer bg-destructive text-white hover:bg-destructive/90"
              onClick={(ev) => {
                ev.preventDefault()
                remove.mutate()
              }}
            >
              {remove.isPending && <Loader2 className="animate-spin" />}
              Remove destination
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  )
}
