-- Phase 3: drop the three empty pre-Phase-3 financial tables so `prisma db
-- push` can create them in the new shape.
--
-- Why this instead of `--accept-data-loss`: push refused only because adding
-- the unique constraints on Payout.payoutNumber and Payout.settlementId is
-- *potentially* lossy. It is not lossy here, because all three tables hold zero
-- rows (verified immediately before this ran, and LedgerEntry was emptied by
-- 003-reset-ledger.sql). Passing the flag would have waived every warning for
-- the whole push, including any not listed; dropping three provably empty
-- tables waives nothing and states exactly what is being given up.
--
-- Order matters, and it runs against the foreign keys rather than with them:
--
--   LedgerEntry.payoutId -> Payout
--   Payout.methodId      -> PayoutMethod
--
-- so the referencing table is dropped before the table it points at. A first
-- attempt used the opposite order and Postgres refused it, which is the whole
-- reason there is no CASCADE here: if anything outside this set still referred
-- to these tables, that refusal is what would protect it, instead of CASCADE
-- silently dropping it too.

BEGIN;

DROP TABLE IF EXISTS "LedgerEntry";
DROP TABLE IF EXISTS "Payout";
DROP TABLE IF EXISTS "PayoutMethod";

COMMIT;
