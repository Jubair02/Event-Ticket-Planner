import { fromDbMinor } from '@/lib/money'
import {
  LEDGER_TYPE_LABELS,
  PAYOUT_METHOD_LABELS,
  PAYOUT_STATUS_LABELS,
  ledgerEntryType,
  safePayoutMethod,
  type PayoutMethodType,
  type PayoutStatus,
} from '@/lib/settlement'

/**
 * Wire shapes for settlement rows.
 *
 * Kept apart from `settlement.ts` so route handlers, the organizer wallet and
 * the admin console all serialise a ledger entry the same way — and so the
 * "never send anything that identifies the account" rule lives in exactly one
 * place.
 *
 * Every amount here is paisa, named `*Minor`, matching the rest of the API.
 */

export interface LedgerEntryDTO {
  id: string
  type: string
  typeLabel: string
  /**
   * Signed paisa from the account holder's point of view: a credit to what we
   * owe them is positive, a debit negative.
   */
  amountMinor: number
  /** ISO date when the amount matures, or null if it already has. */
  availableAt: string | null
  /** True while `availableAt` is still in the future. */
  pending: boolean
  description: string
  orderId: string | null
  eventId: string | null
  payoutId: string | null
  /** When the money moved. */
  occurredAt: string
}

export function serialiseLedgerEntry(e: {
  id: string
  kind: string
  account: string
  direction: string
  amountMinor: bigint | number
  availableAt: Date | null
  description: string | null
  orderId: string | null
  eventId: string | null
  payoutId: string | null
  occurredAt: Date
}): LedgerEntryDTO {
  const type = ledgerEntryType(e)
  const amount = fromDbMinor(e.amountMinor)
  return {
    id: e.id,
    type,
    typeLabel: LEDGER_TYPE_LABELS[type] ?? type,
    // Stored amounts are always positive with the sign carried by `direction`;
    // a reader wants one signed number, so it is reassembled here.
    amountMinor: e.direction === 'CREDIT' ? amount : -amount,
    availableAt: e.availableAt?.toISOString() ?? null,
    pending: e.availableAt !== null && e.availableAt.getTime() > Date.now(),
    description: e.description ?? '',
    orderId: e.orderId,
    eventId: e.eventId,
    payoutId: e.payoutId,
    occurredAt: e.occurredAt.toISOString(),
  }
}

export interface PayoutDTO {
  id: string
  /** The `PO-YYYY-NNNNNN` number an organizer quotes when asking about it. */
  reference: string
  amountMinor: number
  status: string
  statusLabel: string
  note: string | null
  reviewNote: string | null
  reviewedAt: string | null
  reviewedByName: string | null
  /** The bank or wallet transfer reference, once it has been paid. */
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
  payoutNumber: string
  amountMinor: bigint | number
  status: string
  note: string | null
  reviewNote: string | null
  reviewedAt: Date | null
  reviewedBy?: { name: string } | null
  /** Column holding the transfer reference. */
  reference: string | null
  paidAt: Date | null
  initiatedBy: string
  createdAt: Date
  payoutMethod?: Parameters<typeof safePayoutMethod>[0] | null
  organizer?: {
    id: string
    organizationName: string
    user?: { email: string } | null
  } | null
}

export function serialisePayout(p: PayoutRow): PayoutDTO {
  const method = p.payoutMethod ? safePayoutMethod(p.payoutMethod) : null
  return {
    id: p.id,
    reference: p.payoutNumber,
    amountMinor: fromDbMinor(p.amountMinor),
    status: p.status,
    statusLabel: PAYOUT_STATUS_LABELS[p.status as PayoutStatus] ?? p.status,
    note: p.note,
    reviewNote: p.reviewNote,
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
    reviewedByName: p.reviewedBy?.name ?? null,
    transferRef: p.reference,
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
