# Organizer Orders Overrides — `/organizer/orders`

> **PROJECT:** TicketBD
> **Page Type:** Operational lookup (not reporting)
> **Component:** `src/components/organizer/orders.tsx`

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/ticketbd/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Design context: somebody is looking for one order

`/organizer` is a renewal decision and `/organizer/analytics` is a report. This
page is neither. An organizer opens it because **one specific order needs
answering**:

- "I paid and never got my ticket."
- "I was charged twice."
- "I want my money back."
- "Is this order actually paid, or still pending?"

Everything on the page serves that: narrow down to the order, recognise it, then
read its money split closely enough to write a reply. The previous version was
shaped like a report — a gross-sales hero over a flat, unsortable,
undrillable table — so the one thing the page exists for was the one thing it
could not do.

**The colour-drift warning in [`event-detail.md`](./event-detail.md) applies
unchanged:** the Master's orange palette and Righteous/Poppins pairing are
stale. The shipped tokens in `src/app/globals.css` (emerald primary, Geist
Sans/Mono) are the source of truth.

---

## Pattern Override

The design DB returns **Comparison Table + CTA** for orders/table keywords, with
a near-black palette and a "highlight your own row in light yellow" colour
strategy. **This is a misroute** — that is a marketing pricing-comparison
pattern, and there is no competitor to compare against inside an operator's own
console. Its `AVOID` entries were kept (`Flat design without depth`,
`Text-heavy pages`) and its colour strategy discarded entirely.

The style hit is right and was adopted unchanged: **Soft UI Evolution** —
tinted `Panel` shadows, 200–300ms transitions, visible focus, WCAG AA.

**Density is the real override: 7/10 against the Master's 4/10.** Table rows sit
at `py-3` with `py-2.5` headers, because a support lookup is scanning for one
row among two hundred and generous vertical rhythm just means more scrolling.

Section order:

1. **Collected from buyers** (hero) + order-state distribution
2. **Narrowing** — search, event, payment state, sort
3. **The rows** — table at `lg+`, cards below
4. **One order** — a detail panel, opened from any row

---

## What changed, and why

| Before | After | Reason |
|---|---|---|
| Hero labelled **Gross sales** | Hero labelled **Collected from buyers**, with "includes the 3% platform fee" | The figure sums `totalMinor`, which is what buyers were *charged* — fee included. It was never the organizer's money, and "gross sales" implied it was. |
| Nothing linked out of the hero | `What you earned` → `/organizer`, `Per-event breakdown` → `/organizer/analytics` | Two pages disagreeing about a number called "net" is worse than one page not showing it. The honest figures are named and one click away. |
| `MetricGroup` of raw counts | Paid orders / **Average paid order** / Refunded to buyers | An average order value is a decision input; a repeat of the chip counts is not. |
| No event filter (the API already took `eventId`) | Event `Select`, URL-backed | The endpoint had supported `eventId` since it was written and no UI ever passed it. An organizer running four events could not look at one. |
| Fixed newest-first order | Sortable by placed / tickets / value | "Which was the big one" and "what came in first" are both real support questions. |
| Row was a dead end | Row opens a detail panel | Order number, dates, both names, the full money split and the event links — from the row already in hand, with no second request. |
| `buyerName` fetched, never rendered | Shown in the panel when it differs from the attendee | It was fetched by the endpoint and dropped on the floor. When a ticket is bought *for* someone, "who do I reply to" has two candidate answers and the operator needs both. |
| `min-w-[720px]` table at every width | Table at `lg+`, card list below | A sideways-scrolling table hides the amount and the status — the two columns a phone user came for — behind a gesture. |
| No export | CSV of the current view | Reconciliation against a bank statement happens in a spreadsheet, and there is nowhere else in the product to get the rows out. |

---

## Data Override

### The header figures follow the event, not the filters

`grouped` and `paidAgg` in `src/app/api/organizer/orders/route.ts` now share a
`scope` where-clause that carries **`eventId` but neither `status` nor `q`**:

- Picking an event re-scopes the whole page to that event — hero, distribution
  bar and chip counts included — otherwise the bar would describe every event
  while the rows below showed one.
- Filtering by status or searching must **not** move the totals underneath the
  operator, which was the original endpoint's stated reason for aggregating
  outside the row query.

`MetricGroup`'s title switches between `Across all events` and `This event` so
the scope is stated rather than inferred.

### Sorting is client-side, and says so

The endpoint returns at most 200 rows, all of them in hand, so re-ordering costs
no request. But sorting a truncated window by value is not sorting every order
the organizer has ever taken — so when `truncated` is set, the footnote says
"this is the most recent 200 — sorting reorders those".

### `Your share` is stated before refunds

`total = subtotal - discount + fee` is a CHECK constraint on the `Order` table,
so the panel's breakdown lines are that identity rather than a re-derivation.
The organizer's share is `subtotal - discount` — the fee stripped out, because
it was never theirs (`ledger.ts` credits it to `PLATFORM_REVENUE`).

**A refund is not netted off it.** Whether a refund came out of the organizer's
share or the platform's is stored on the `Refund` row and is deliberately not
derivable from the order — a goodwill refund can be entirely platform-funded. So
the refund gets its own line and a sentence saying where the split lives, rather
than a confident "net to you" that no data on this page supports.

---

## Component Overrides

### `FilterOption.dotClass` (shared, `dashboard/primitives.tsx`)

New optional swatch on a filter chip. It exists so the distribution bar has a
legend: the chips already carry every status name and count, so labelling the
bar's colours through them adds a legend without adding a second control that
does the same job.

On the active chip the swatch renders as `bg-current opacity-60` rather than its
own colour — a `bg-primary` dot on a chip already filled with `primary` would be
invisible, and dropping the dot instead would change the chip's width as it is
selected.

### `PaymentStatusBadge` (shared, `dashboard/status-badges.tsx`)

- **`PENDING` no longer renders identically to `CANCELLED`.** Both were plain
  `outline`, so the one state an operator may need to chase looked exactly like
  the one that is over. `PENDING` and `PROCESSING` now carry the theme's
  dedicated `--warning` token (`border-warning/60 bg-warning/10`, with
  `text-foreground` — amber as a fill, never as text), and `CANCELLED` drops to
  `text-muted-foreground`.
- `PARTIALLY_REFUNDED` is named in the switch instead of arriving via `default`.

Both changes reach `/admin/payments` and the event-analytics order list too,
which is the point: the ambiguity was in the shared component, not on this page.

### `StatusDistribution` (page-local)

A stacked bar of order counts by payment state, in the order money moves through
them, so it reads left to right as "settled, waiting, returned, lost".

A bar rather than more figures because the useful reading is a proportion —
"essentially everything is paid" against "a fifth are stuck" — and that is a
shape. Fills are restricted to tokens that hold their meaning in both themes:
`primary` is money in, `warning` is money owed, `destructive` is money lost, and
`muted-foreground` steps are money returned or never taken.

Colour is not the only carrier: the chips below are its legend, each segment has
a `title`, and the bar is a `role="img"` whose `aria-label` is the whole
distribution as a sentence. The segments themselves are **not** interactive —
a 3px-wide filter control would fail every touch-target rule — so filtering
stays on the chips.

### Row → panel, without nested interactives

The `onClick` sits on the `<tr>`, and the order number inside it is a real
`<button>` with **no handler of its own**. A mouse click and a keyboard Enter on
that button both arrive exactly once, as the click bubbles up. The row is one
target with one meaning, so the event title is plain text here and its links
live in the panel — a link inside a clickable row is two targets pretending to
be one.

`has-[:focus-visible]:bg-muted/40` on the row mirrors the hover state when the
inner button takes focus, so keyboard and mouse see the same highlight.

### CSV export

Strings are quoted, and any cell opening with `= + - @` or a control character
is prefixed with an apostrophe: attendee names and event titles are user input,
and a spreadsheet is a program. Numbers go out bare in taka so the sheet can add
them up, and the file is BOM-prefixed or Excel reads UTF-8 as Latin-1 and turns
every ৳ into mojibake.

---

## Motion Overrides

Motion dial **4/10**, as on the overview. This is a support surface; nothing
here should feel animated.

- Section reveal: `entrance(0…2)` — the `animate-in` idiom the dashboards
  already share. **No GSAP** (this project has none — see
  [`event-detail.md`](./event-detail.md)).
- Distribution bar: `transition-[width] duration-500`
- Row hover: `bg-muted/40` + a 2px chevron nudge, `duration-200`
- Sort affordance: the chevron is `opacity-0` until hover or active, so seven
  column headers do not read as seven live controls
- Press feedback: `active:scale-[0.98]` on Export, `[0.99]` on cards
- Every transform paired with `motion-reduce:`

---

## Rejected

- **A "needs attention" strip** for pending and failed orders. There is no
  organizer-facing action behind it — refunds are an admin endpoint, and there
  is no resend-payment-link — so the button could only have re-applied a filter
  the chips already offer. That is the Master's dead-end-CTA anti-pattern with
  extra steps. The amber `PENDING` chip and its bar segment carry the same
  signal honestly.
- **A net-earnings hero.** See *Data Override*: the honest per-order figure is
  computable, the honest page-level one is not without a new aggregate, and a
  third definition of "net" competing with `/organizer` is worse than a link.
- **Zebra striping**, which the DB's misrouted pattern asked for. It fights the
  row hover state, which is doing real work here as the drill-in affordance.

---

## Fixed Anti-Pattern Violations

- ❌ **Two states rendering identically** — `PENDING` vs `CANCELLED`, above.
- ❌ **Horizontal scroll as the mobile story** — the table is `lg+` only now.
- ❌ **A metric labelled as something it is not** — "gross sales" for a
  fee-inclusive charge total.
- ❌ **Fetched-and-discarded data** — `buyerName`.
- ❌ **An empty state that only describes** — it now carries `Clear filters`
  when narrowed, and `Your events` when the account genuinely has no orders.
- ❌ **Colour-only meaning on a chart** — the bar has a legend, per-segment
  titles and a sentence label.

---

## Checklist Notes

- **Touch:** chips and Export at `h-8` matching the dashboards' existing rail;
  card rows are full-width targets far above 44px; the sort `Select` replaces
  the column headers below `lg` rather than leaving sorting unreachable.
- **Contrast:** amber appears only as a `bg-warning/10` fill behind
  `text-foreground`, never as text. Order numbers are `font-mono tabular-nums`
  at `text-[13px]` — above the 12px floor, and monospaced because an order
  number is an identifier being compared character by character against an
  email.
- **Focus:** every row, chip, header button and card has a visible
  `focus-visible` ring; the row highlights with its inner button.
- **Responsive:** 375 / 768 / 1024 / 1440 checked. No horizontal page scroll at
  any width — the table's own container is the only thing that scrolls, and only
  at `lg+`.
- **Reduced motion / dark mode** checked.
- **Not verified in a browser:** `prisma/seed.ts` wipes the database it points
  at, so the seeded organizer login could not be recreated to sign in. `tsc`,
  `eslint` and `next build` all pass.
