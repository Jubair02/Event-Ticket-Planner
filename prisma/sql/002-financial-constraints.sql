-- Phase 3: database-level guarantees for the financial tables.
--
-- The application already enforces all of this (src/lib/money.ts and
-- src/lib/ledger.ts), but application checks only bind code that goes through
-- them. A raw query, a psql session, a future service or a bug in a new route
-- can all write money directly. These constraints are the floor: money cannot
-- be stored in a state the books cannot explain, no matter who writes it.
--
-- Prisma does not model CHECK constraints, so it neither creates nor drops
-- them. Re-run this file after any `prisma db push` that recreates a table, and
-- verify with the query at the bottom.

BEGIN;

-- Prices and captured amounts are never negative. A negative price is not a
-- discount; discounts have their own column.
ALTER TABLE "TicketType" DROP CONSTRAINT IF EXISTS "TicketType_priceMinor_nonneg";
ALTER TABLE "TicketType" ADD  CONSTRAINT "TicketType_priceMinor_nonneg"
  CHECK ("priceMinor" >= 0);

ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_amountMinor_nonneg";
ALTER TABLE "Payment" ADD  CONSTRAINT "Payment_amountMinor_nonneg"
  CHECK ("amountMinor" >= 0 AND "gatewayFeeMinor" >= 0);

-- The order identity. This is the constraint that makes an order's four money
-- columns trustworthy: no writer can leave them disagreeing with each other.
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_total_consistent";
ALTER TABLE "Order" ADD  CONSTRAINT "Order_total_consistent"
  CHECK ("totalMinor" = "subtotalMinor" - "discountMinor" + "platformFeeMinor");

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_amounts_nonneg";
ALTER TABLE "Order" ADD  CONSTRAINT "Order_amounts_nonneg"
  CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "platformFeeMinor" >= 0
         AND "totalMinor" >= 0 AND "discountMinor" <= "subtotalMinor");

-- A refund's split has to add up, or the ledger group it produces cannot
-- balance and the books would be unreconcilable from that point on.
ALTER TABLE "Refund" DROP CONSTRAINT IF EXISTS "Refund_shares_add_up";
ALTER TABLE "Refund" ADD  CONSTRAINT "Refund_shares_add_up"
  CHECK ("amountMinor" = "organizerShareMinor" + "platformShareMinor");

ALTER TABLE "Refund" DROP CONSTRAINT IF EXISTS "Refund_amounts_positive";
ALTER TABLE "Refund" ADD  CONSTRAINT "Refund_amounts_positive"
  CHECK ("amountMinor" > 0 AND "organizerShareMinor" >= 0 AND "platformShareMinor" >= 0);

ALTER TABLE "Refund" DROP CONSTRAINT IF EXISTS "Refund_status_valid";
ALTER TABLE "Refund" ADD  CONSTRAINT "Refund_status_valid"
  CHECK ("status" IN ('REQUESTED','APPROVED','REJECTED','PROCESSING','COMPLETED','FAILED'));

-- Payouts move money out; a zero or negative one is always a bug.
ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "Payout_amount_positive";
ALTER TABLE "Payout" ADD  CONSTRAINT "Payout_amount_positive"
  CHECK ("amountMinor" > 0);

ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "Payout_status_valid";
ALTER TABLE "Payout" ADD  CONSTRAINT "Payout_status_valid"
  CHECK ("status" IN ('PENDING','PROCESSING','PAID','FAILED','CANCELLED'));

ALTER TABLE "PayoutMethod" DROP CONSTRAINT IF EXISTS "PayoutMethod_type_valid";
ALTER TABLE "PayoutMethod" ADD  CONSTRAINT "PayoutMethod_type_valid"
  CHECK ("type" IN ('BANK_TRANSFER','BKASH','NAGAD'));

ALTER TABLE "PayoutMethod" DROP CONSTRAINT IF EXISTS "PayoutMethod_status_valid";
ALTER TABLE "PayoutMethod" ADD  CONSTRAINT "PayoutMethod_status_valid"
  CHECK ("status" IN ('UNVERIFIED','VERIFIED','REJECTED','DISABLED'));

-- Storing a full account number here is a data-protection problem, so the
-- column is constrained to the shape of a last-four fragment.
ALTER TABLE "PayoutMethod" DROP CONSTRAINT IF EXISTS "PayoutMethod_last4_shape";
ALTER TABLE "PayoutMethod" ADD  CONSTRAINT "PayoutMethod_last4_shape"
  CHECK ("accountLast4" ~ '^[0-9]{2,4}$');

-- The settlement identity: every component is stored, and the net has to be
-- exactly what those components produce.
ALTER TABLE "Settlement" DROP CONSTRAINT IF EXISTS "Settlement_net_consistent";
ALTER TABLE "Settlement" ADD  CONSTRAINT "Settlement_net_consistent"
  CHECK ("netPayableMinor" = "grossSalesMinor" - "discountsMinor" - "refundsMinor"
         - "platformFeeMinor" - "gatewayFeeMinor" + "adjustmentMinor");

ALTER TABLE "Settlement" DROP CONSTRAINT IF EXISTS "Settlement_components_nonneg";
ALTER TABLE "Settlement" ADD  CONSTRAINT "Settlement_components_nonneg"
  CHECK ("grossSalesMinor" >= 0 AND "discountsMinor" >= 0 AND "refundsMinor" >= 0
         AND "platformFeeMinor" >= 0 AND "gatewayFeeMinor" >= 0);

ALTER TABLE "Settlement" DROP CONSTRAINT IF EXISTS "Settlement_period_ordered";
ALTER TABLE "Settlement" ADD  CONSTRAINT "Settlement_period_ordered"
  CHECK ("periodEnd" > "periodStart");

ALTER TABLE "Settlement" DROP CONSTRAINT IF EXISTS "Settlement_status_valid";
ALTER TABLE "Settlement" ADD  CONSTRAINT "Settlement_status_valid"
  CHECK ("status" IN ('DRAFT','OPEN','APPROVED','PAID','CANCELLED'));

-- Ledger entries. `amountMinor > 0` is the one that matters most: the whole
-- balance model assumes the sign lives in `direction`, so a negative amount
-- would make every SUM silently wrong rather than loudly broken.
ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS "LedgerEntry_amount_positive";
ALTER TABLE "LedgerEntry" ADD  CONSTRAINT "LedgerEntry_amount_positive"
  CHECK ("amountMinor" > 0);

ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS "LedgerEntry_direction_valid";
ALTER TABLE "LedgerEntry" ADD  CONSTRAINT "LedgerEntry_direction_valid"
  CHECK ("direction" IN ('DEBIT','CREDIT'));

ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS "LedgerEntry_account_valid";
ALTER TABLE "LedgerEntry" ADD  CONSTRAINT "LedgerEntry_account_valid"
  CHECK ("account" IN ('GATEWAY_CLEARING','CASH','GATEWAY_FEES',
                       'PLATFORM_REVENUE','ORGANIZER_PAYABLE','ADJUSTMENTS'));

ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS "LedgerEntry_kind_valid";
ALTER TABLE "LedgerEntry" ADD  CONSTRAINT "LedgerEntry_kind_valid"
  CHECK ("kind" IN ('PAYMENT_CAPTURED','REFUND_COMPLETED','PAYOUT_PAID',
                    'GATEWAY_SETTLED','ADJUSTMENT'));

-- One currency today. The columns exist so a second one can be added without a
-- migration, but mixing them before the ledger is per-currency would silently
-- add taka to dollars, so it is refused until that work is done.
ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS "LedgerEntry_currency_supported";
ALTER TABLE "LedgerEntry" ADD  CONSTRAINT "LedgerEntry_currency_supported"
  CHECK ("currency" = 'BDT');

COMMIT;

-- Verification. Expect 21 rows; run after any db push.
--
--   SELECT conrelid::regclass AS table, conname
--     FROM pg_constraint
--    WHERE contype = 'c'
--      AND conrelid::regclass::text IN
--          ('"Order"','"Payment"','"TicketType"','"Refund"','"Payout"',
--           '"PayoutMethod"','"Settlement"','"LedgerEntry"')
--    ORDER BY 1, 2;
