import {
  LEDGER_TYPE_LABELS,
  PAYOUT_METHOD_LABELS,
  PAYOUT_STATUS_LABELS,
  safePayoutMethod,
  type LedgerType,
  type PayoutMethodType,
  type PayoutStatus,
} from '@/lib/settlement'

/**
 * Wire shapes for settlement rows.
 *
 * Kept apart from `settlement.ts` so route handlers, the organizer wallet and
 * the admin console all serialise a ledger entry the same way — and so the
 * "never send the full account number" rule lives in exactly one place.
 */

export interface LedgerEntryDTO {
  id: string
  type: string
  typeLabel: string
  /** Signed whole taka; credits positive. */
  amount: number
  /** ISO date when the amount matures, or null if it already has. */
  availableAt: string | null
  /** True while `availableAt` is still in the future. */
  pending: boolean
  description: string
  orderId: string | null
  eventId: string | null
  payoutId: string | null
  createdAt: string
}

export function serialiseLedgerEntry(e: {
  id: string
  type: string
  amount: number
  availableAt: Date | null
  description: string
  orderId: string | null
  eventId: string | null
  payoutId: string | null
  createdAt: Date
}): LedgerEntryDTO {
  return {
    id: e.id,
    type: e.type,
    typeLabel: LEDGER_TYPE_LABELS[e.type as LedgerType] ?? e.type,
    amount: e.amount,
    availableAt: e.availableAt?.toISOString() ?? null,
    pending: e.availableAt !== null && e.availableAt.getTime() > Date.now(),
    description: e.description,
    orderId: e.orderId,
    eventId: e.eventId,
    payoutId: e.payoutId,
    createdAt: e.createdAt.toISOString(),
  }
}

export interface PayoutDTO {
  id: string
  reference: string
  amount: number
  status: string
  statusLabel: string
  note: string | null
  reviewNote: string | null
  reviewedAt: string | null
  reviewedByName: string | null
  transferRef: string | null
  paidAt: string | null
  initiatedBy: string
  createdAt: string
  method: {
    id: string
    type: string
    typeLabel: string
    accountName: string
    accountLast4: string
    bankName: string | null
  } | null
  organizer?: { id: string; organizationName: string; contactEmail: string | null }
}

type PayoutRow = {
  id: string
  reference: string
  amount: number
  status: string
  note: string | null
  reviewNote: string | null
  reviewedAt: Date | null
  reviewedBy?: { name: string } | null
  transferRef: string | null
  paidAt: Date | null
  initiatedBy: string
  createdAt: Date
  method?: Parameters<typeof safePayoutMethod>[0] | null
  organizer?: {
    id: string
    organizationName: string
    user?: { email: string } | null
  } | null
}

export function serialisePayout(p: PayoutRow): PayoutDTO {
  const method = p.method ? safePayoutMethod(p.method) : null
  return {
    id: p.id,
    reference: p.reference,
    amount: p.amount,
    status: p.status,
    statusLabel: PAYOUT_STATUS_LABELS[p.status as PayoutStatus] ?? p.status,
    note: p.note,
    reviewNote: p.reviewNote,
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
    reviewedByName: p.reviewedBy?.name ?? null,
    transferRef: p.transferRef,
    paidAt: p.paidAt?.toISOString() ?? null,
    initiatedBy: p.initiatedBy,
    createdAt: p.createdAt.toISOString(),
    method: method
      ? {
          id: method.id,
          type: method.type,
          typeLabel: PAYOUT_METHOD_LABELS[method.type as PayoutMethodType] ?? method.type,
          accountName: method.accountName,
          accountLast4: method.accountLast4,
          bankName: method.bankName,
        }
      : null,
    ...(p.organizer
      ? {
          organizer: {
            id: p.organizer.id,
            organizationName: p.organizer.organizationName,
            contactEmail: p.organizer.user?.email ?? null,
          },
        }
      : {}),
  }
}
