-- Phase 3, step 3 of 3: clear the pre-Phase-3 ledger rows.
--
-- The 36 rows in "LedgerEntry" were written by an earlier whole-taka design:
-- one signed `amount` per movement, with `type` and `availableAt`. The new
-- model is double-entry — balanced groups of positive `amountMinor` rows with a
-- `direction` and an `account` — and a single signed row cannot be mapped onto
-- a balanced group automatically. Guessing the counter-account would invent
-- bookkeeping that never happened.
--
-- Discarding them is safe because they were derived, not entered: every row was
-- generated from a paid Order by a backfill script, so the same entries can be
-- regenerated from those orders at any time. Nothing here was hand-keyed.
--
-- A copy of all 36 rows was taken before this ran.
--
-- "Payout" and "PayoutMethod" are empty, so `prisma db push` can reshape them
-- without losing anything and they are left alone.

BEGIN;

DELETE FROM "LedgerEntry";

COMMIT;
