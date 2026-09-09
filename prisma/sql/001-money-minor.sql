-- Phase 3: convert every Float money column to BigInt paisa (1 BDT = 100 paisa).
--
-- Written as add -> backfill -> verify -> enforce -> drop rather than an
-- in-place ALTER TYPE so the old value stays readable until the new column has
-- been checked, and so `prisma db push` never has to be pointed at production
-- with --accept-data-loss.
--
-- ROUND() before the ::bigint cast is deliberate: the cast alone rounds
-- half-to-even, which would send a stored 12.005 to a different paisa than the
-- application's half-away-from-zero rule.

BEGIN;

-- TicketType.price -> priceMinor -------------------------------------------
ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "priceMinor" BIGINT;
UPDATE "TicketType" SET "priceMinor" = ROUND("price" * 100)::bigint WHERE "priceMinor" IS NULL;
ALTER TABLE "TicketType" ALTER COLUMN "priceMinor" SET NOT NULL;

-- Order.subtotal/platformFee/totalAmount -> *Minor + discountMinor ---------
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "subtotalMinor"    BIGINT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "platformFeeMinor" BIGINT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "totalMinor"       BIGINT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "discountMinor"    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "currency"         TEXT   NOT NULL DEFAULT 'BDT';

UPDATE "Order"
SET "subtotalMinor"    = ROUND("subtotal" * 100)::bigint,
    "platformFeeMinor" = ROUND("platformFee" * 100)::bigint,
    "totalMinor"       = ROUND("totalAmount" * 100)::bigint
WHERE "totalMinor" IS NULL;

-- Legacy rows were written as total = subtotal + fee with no discount. If any
-- row disagrees the identity below cannot hold, so fail here rather than let a
-- CHECK constraint fail later with less context.
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "Order"
   WHERE "totalMinor" <> "subtotalMinor" - "discountMinor" + "platformFeeMinor";
  IF bad > 0 THEN
    RAISE EXCEPTION 'Aborting: % order(s) have inconsistent totals after conversion', bad;
  END IF;
END $$;

ALTER TABLE "Order" ALTER COLUMN "subtotalMinor"    SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "platformFeeMinor" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "totalMinor"       SET NOT NULL;

-- Payment.amount -> amountMinor + gatewayFeeMinor --------------------------
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "amountMinor"     BIGINT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "gatewayFeeMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "currency"        TEXT   NOT NULL DEFAULT 'BDT';
UPDATE "Payment" SET "amountMinor" = ROUND("amount" * 100)::bigint WHERE "amountMinor" IS NULL;
ALTER TABLE "Payment" ALTER COLUMN "amountMinor" SET NOT NULL;

-- Round-trip check: the new column must reproduce the old value exactly. Any
-- mismatch means a stored float carried sub-paisa precision, which has to be
-- looked at by a human rather than silently rounded away.
DO $$
DECLARE bad integer;
BEGIN
  SELECT (SELECT count(*) FROM "TicketType" WHERE "priceMinor"::numeric / 100 <> "price"::numeric)
       + (SELECT count(*) FROM "Order"      WHERE "subtotalMinor"::numeric / 100 <> "subtotal"::numeric
                                               OR "platformFeeMinor"::numeric / 100 <> "platformFee"::numeric
                                               OR "totalMinor"::numeric / 100 <> "totalAmount"::numeric)
       + (SELECT count(*) FROM "Payment"    WHERE "amountMinor"::numeric / 100 <> "amount"::numeric)
    INTO bad;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Aborting: % row(s) do not round-trip; inspect before dropping the Float columns', bad;
  END IF;
END $$;

-- Only now is the float safe to remove. Keeping both would leave two sources
-- of truth for the same price, which is the bug this phase exists to remove.
ALTER TABLE "TicketType" DROP COLUMN "price";
ALTER TABLE "Order"      DROP COLUMN "subtotal";
ALTER TABLE "Order"      DROP COLUMN "platformFee";
ALTER TABLE "Order"      DROP COLUMN "totalAmount";
ALTER TABLE "Payment"    DROP COLUMN "amount";

COMMIT;
