# Money model

Phase 3 design record. Read this before touching an amount anywhere in the
codebase.

## 1. The representation: integer paisa

Every monetary value in the system is an **integer count of paisa**
(`1 BDT = 100 paisa`). There are no floating-point money values in the database,
over the wire, or in business logic.

| ৳ | paisa |
|---|---|
| 1,500.00 | 150000 |
| 1,500.50 | 150050 |
| 0.01 | 1 |

### Why not floats

`Float` was the previous representation for `TicketType.price`,
`Order.subtotal`, `Order.platformFee`, `Order.totalAmount` and `Payment.amount`.
Doubles cannot hold most decimal fractions exactly:

```
0.1 + 0.2       === 0.30000000000000004
1500.55 * 100   === 150054.99999999999
```

A single order rarely shows the error. A commission computed from a drifted
subtotal, summed across an organizer's whole event and then paid out, does — and
it shows up as a payout dispute, which is the most expensive place to find it.

### Why not Prisma `Decimal`

`Decimal` is exact and would have worked. Integer paisa was chosen because:

- arithmetic stays plain integer arithmetic, so `qty * price` in a component is
  correct without a library;
- it serialises to a JSON number with no precision contract to negotiate
  between server and client;
- Postgres integers index, aggregate and `SUM` natively;
- there is one representation everywhere, rather than `Decimal` objects on the
  server and strings in the browser.

The trade-off accepted: paisa cannot express a sub-paisa unit price. Nothing in
ticketing needs one.

### Why `BigInt` and not `Int`

`int4` caps at 2,147,483,647 paisa = **৳21,474,836.47**. That is plenty for one
ticket or one order, but payouts, settlements and ledger balances accumulate
across every order an organizer has ever sold, and a large organizer can pass
it. Rather than mix widths and have to remember which column is which,
every money column is `bigint`.

Reading a `bigint` back into JS is exact up to 2^53 paisa — about ৳90 trillion —
so the JSON boundary loses nothing. `fromDbMinor` throws above that instead of
rounding.

## 2. Naming, and how the unit is enforced

**Every money field is suffixed `Minor`.** `priceMinor`, `totalMinor`,
`amountMinor`, `netPayableMinor`. A name without the suffix is not money.

This is deliberate rather than cosmetic. The migration renamed the columns
instead of changing the type under the existing names, so that any code still
reading the old value fails to compile rather than silently reinterpreting
৳1,500 as 15 paisa. A unit change under a stable name is the one thing worse
than the original bug.

Three further layers back this up:

1. `assertMinor` at trust boundaries — request bodies, values from the database.
2. `Minor` is a plain `number` alias, not a branded type. Branding would force
   every `qty * price` in a `.tsx` file through a helper; that friction gets
   worked around rather than followed, and the suffix plus the checks below
   cover the same ground.
3. **Database CHECK constraints** (`prisma/sql/002-financial-constraints.sql`),
   which bind every writer, including raw SQL and future services.

## 3. `src/lib/money.ts` — the only place units convert

| Function | Purpose |
|---|---|
| `toMinor(taka)` | Parse what a human typed. `null` when unusable. |
| `fromMinor(minor)` | Back to a decimal, for contracts that demand one (schema.org, CSV). Never for arithmetic. |
| `formatMinor(minor)` | Render: `৳1,500` or `৳1,500.50`. |
| `addMinor`, `mulMinor`, `rateOfMinor` | Checked arithmetic. |
| `platformFeeMinor(subtotal)` | The one definition of the commission. |
| `orderTotals(lines, discount)` | The one definition of an order's money. |
| `toDbMinor` / `fromDbMinor` | The `bigint` boundary. |

Two decisions inside it worth knowing:

**Parsing is string-based, not `× 100`.** `'1500.55'` is read digit by digit,
because `1500.55 * 100` is `150054.99999999999`.

**A comma is refused, never guessed.** Treating `,` as a decimal separator made
`'1,500'` — a completely natural way to write fifteen hundred taka, where the
comma groups thousands — parse as `1.50` and price a ticket at ৳1.50. An
ambiguous amount is rejected so the person retypes it. (This was caught by the
unit tests, not by review.)

**Rounding is half away from zero.** `Math.round` rounds half toward
`+Infinity`, which would bias refund credits in one direction.

## 4. The order identity

```
totalMinor = subtotalMinor - discountMinor + platformFeeMinor
```

The commission is charged on what the customer actually pays for tickets, so a
discount reduces the fee too. `discountMinor` is capped at `subtotalMinor`, so a
total can never go negative.

This identity is enforced in three places: `orderTotals` computes it, the
`Order_total_consistent` CHECK constraint refuses to store a violation, and
`paymentCapturedLines` refuses to post a ledger group for an order that breaks
it.

## 5. The ledger

`Order` and `Payment` rows answer "what happened to this order". They cannot
answer:

- how much do we owe organizers right now?
- how much of that is still sitting at the gateway?
- does the money we hold match the money we say we owe?

Re-aggregating orders to answer those means every fee-rate or refund-policy
change silently rewrites history. So `LedgerEntry` is the system of record.

**Double entry, in balanced groups.** Every financial event writes one `groupId`
whose debits equal its credits. Any account balance is then a `SUM` over one
table, and a discrepancy is a query rather than an investigation.
`amountMinor` is always positive; `direction` carries the sign.

### Chart of accounts

| Account | Normal side | Meaning |
|---|---|---|
| `GATEWAY_CLEARING` | debit | Captured from customers, not yet settled to us |
| `CASH` | debit | Our bank balance |
| `GATEWAY_FEES` | debit | What the payment provider keeps |
| `PLATFORM_REVENUE` | credit | Commission earned |
| `ORGANIZER_PAYABLE` | credit | What we owe organizers — what a payout pays |
| `ADJUSTMENTS` | credit | Manual corrections, always visible as such |

### Postings

```
PAYMENT_CAPTURED   DEBIT  GATEWAY_CLEARING  total
                   CREDIT PLATFORM_REVENUE  fee
                   CREDIT ORGANIZER_PAYABLE  subtotal - discount

GATEWAY_SETTLED    DEBIT  CASH              net
                   DEBIT  GATEWAY_FEES      fee
                   CREDIT GATEWAY_CLEARING  net + fee

REFUND_COMPLETED   DEBIT  ORGANIZER_PAYABLE organizerShare
                   DEBIT  PLATFORM_REVENUE  platformShare
                   CREDIT GATEWAY_CLEARING  amount

PAYOUT_PAID        DEBIT  ORGANIZER_PAYABLE amount
                   CREDIT CASH              amount

ADJUSTMENT         DEBIT/CREDIT  <account>  amount
                   opposite      ADJUSTMENTS amount
```

Entries are **append-only**. Nothing updates or deletes one; a mistake is
corrected by posting a reversing group, the way books work.

`LedgerEntry` intentionally has **no foreign keys**. An entry must stay readable
and unchanged for as long as the books do, and an FK invites the cascade that
would erase history when an order or event is deleted. The reference columns are
indexed ids, validated by the writer.

## 6. Refunds, and why the split is stored

A `Refund` records `amountMinor`, `organizerShareMinor` and
`platformShareMinor`, with `amount = organizerShare + platformShare` as a CHECK
constraint.

The split is stored rather than derived because it cannot be reconstructed
later: a goodwill refund may be entirely platform-funded, and a change to the
commission rate must not retroactively alter an old refund's split. Storing it
is also what guarantees the refund's ledger group balances.

## 7. Settlements and payouts

`Settlement` stores every component rather than recomputing it:

```
netPayableMinor = grossSalesMinor - discountsMinor - refundsMinor
                  - platformFeeMinor - gatewayFeeMinor + adjustmentMinor
```

So a settlement stays reproducible after prices, fee rates or refunds change.
`adjustmentMinor` is the only component that may be negative.

`PayoutMethod` deliberately stores **only the last four digits** of an account
or wallet number. The full number is what a disbursement file needs and what an
attacker wants; until there is a KMS-backed encrypted column and an audited
access path, the safe thing is not to hold it. `externalRef` is for the
beneficiary id a payment partner assigns, which is what a real disbursement
call should use.

## 8. Migration

Applied as two SQL files rather than `prisma db push`, because push wanted
`--accept-data-loss` to retype the columns and that flag should not be pointed
at a live database.

**`prisma/sql/001-money-minor.sql`** — add → backfill → verify → enforce → drop:

1. add the `*Minor` columns as nullable;
2. backfill with `ROUND(value * 100)::bigint` (`ROUND` first, because the bare
   cast rounds half-to-even and would disagree with the application's rule);
3. abort if any order's totals are inconsistent;
4. abort if any new column fails to round-trip to the old value;
5. only then `SET NOT NULL` and drop the `Float` columns.

Keeping both would leave two sources of truth for the same price, which is the
bug this phase exists to remove.

**`prisma/sql/002-financial-constraints.sql`** — 21 CHECK constraints. Prisma
does not model these, so it neither creates nor drops them; re-run the file
after any `db push` that recreates a table and verify with the query at its foot.

### Running it

```bash
npx prisma db execute --file prisma/sql/001-money-minor.sql --schema prisma/schema.prisma
npx prisma db push                     # creates the five new tables
npx prisma db execute --file prisma/sql/002-financial-constraints.sql --schema prisma/schema.prisma
npx prisma generate
```

The data was verified beforehand: all 18 ticket types, 18 orders and 18 payments
held whole-taka values with no fractional component and consistent totals, so
the conversion is exact. A pre-migration snapshot of the five columns is worth
taking anyway.

## 9. Adding a currency later

`currency` columns exist on `Order`, `Payment`, `Refund`, `Payout`,
`Settlement` and `LedgerEntry`, defaulting to `BDT`, so a second currency needs
no migration. A CHECK constraint currently pins `LedgerEntry.currency` to `BDT`,
because summing accounts across currencies would silently add taka to dollars.
Lift it only together with per-currency balances.

`MINOR_PER_UNIT` and `CURRENCY_DECIMALS` are defined together and must stay in
step; a zero-decimal currency needs both changed.
