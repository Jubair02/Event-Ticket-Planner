# Admin Console Overrides — `/admin/*`

> **PROJECT:** TicketBD
> **Page Type:** Internal operations console (8 surfaces)
> **Components:** `src/components/admin/*` + the shared kit in `src/components/admin/console.tsx`

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/ticketbd/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

Covers `/admin`, `/admin/organizers`, `/admin/events`, `/admin/users`,
`/admin/payments`, `/admin/refunds`, `/admin/payouts`, `/admin/audit`.

---

## Design context: one console, not eight products

The eight surfaces were built in three separate passes, and each invented its
own answer to the same problem. Before this redesign the console carried:

- **five row treatments** — a `sm:grid-cols-2` card grid, a shadcn `Table` in a
  `panelClass overflow-x-auto` wrapper, a hand-rolled `<table>` in a
  double wrapper, a `space-y-2` stack of `Panel`s, and a `divide-y` list
- **three arbitrary table widths** — `min-w-[800px]`, `min-w-[820px]`, `min-w-[860px]`
- **four filter UIs** — `FilterChips` with counts, `FilterChips` without,
  a hand-rolled `FilterChip` loop, and a bare `Select`
- **five status-badge systems**, including three near-identical `STATUS_TONE`
  maps and one page rendering the raw enum (`COMPLETED`) beside another
  rendering a humanised label
- **seven skeleton shapes**, none matching the `rounded-2xl` of the real rows

Six of the eight pages are the same thing: *a filtered list of records with a
status, some money or a count, and one or two actions.* So that shape now exists
once, in `console.tsx`, and the pages express themselves through it. `/admin`
and `/admin/audit` are the two that genuinely differ and get their own
treatment.

**The colour-drift warning in [`event-detail.md`](./event-detail.md) applies
unchanged:** the shipped tokens in `src/app/globals.css` are the source of
truth, not the Master's orange palette.

---

## Pattern Override

The design DB returns **Real-Time / Operations Landing**. **This is a misroute**
— it is a *landing* pattern (hero, "how it works", trial CTA) for selling an ops
product, not for operating one. Two of its notes were adopted because they are
right regardless:

- Colour strategy: *"Neutral. Status colors (green/amber/red). Data-dense but
  scannable."* → the console is monochrome plus the theme's own status trio:
  `primary` (good), `chart-5` (needs attention), `destructive` (wrong).
- Its `AVOID` entries are the brief: **"Hidden filters"** and **"Outdated
  forms"**.

**Density is 8/10**, against the Master's 4/10. This is the densest surface in
the product.

---

## The responsive table (the headline change)

A dense admin table cannot answer mobile with sideways scrolling — *"avoid
horizontal scrolling"* is a **high**-severity rule and *"Touch Friendly"* is
another, and an operator triaging refunds on a phone should not drag the
viewport to reach a button. Five of the six queues previously did exactly that,
or relied on `flex-wrap` and let the amount and action rail drop unpredictably.

Nor can it become a separate card list: rendering the rows twice and hiding one
copy exposes **both** to a screen reader.

So `ConsoleTable` is **one** semantic `<table>` whose display switches at `md`:

| Element | `< md` | `≥ md` |
|---|---|---|
| `<tbody>` | `block` | `table-row-group` |
| `<tr>` | `block` (a card) | `table-row` |
| `<td>` | `block`/`flex` | `table-cell` |
| `<thead>` | `hidden` | `table-header-group` |
| per-cell label | visible | `md:hidden` |

One DOM, real table semantics for assistive tech and keyboard order, and rows
that become self-contained cards on a phone — each cell showing the column label
the hidden `<thead>` would otherwise have supplied. Every table carries an
`sr-only <caption>` and `scope="col"` headers.

**Verified:** all six queues render `md:table-row-group`, and none renders a
`min-w-[…]` or an `overflow-x-auto` wrapper.

---

## Component Overrides

### `StatStrip` (new, `console.tsx`)

The dense counterpart to `HeroMetric`. Four queue pages opened with a 48px hero
figure plus a six-row `MetricGroup`, costing most of the first screen before a
single record appeared. At density 8 that is wrong, so the queues get one
four-up band and **`/admin` keeps the only hero figure in the console** — the
"exactly one hero per view" rule, applied across the section rather than per
page.

Its `tone` accepts `attention` / `danger`, so a non-zero backlog is coloured
rather than merely present.

### `ConsoleToolbar`

Filters and search on one visible line, above the table. The DB's **"Hidden
filters"** anti-pattern is the reason `visible` is now set high enough on every
page that no status folds into the "More" select — payments previously left it
at the default 4, hiding two of its six statuses behind a menu.

`/admin/organizers` gained a search box (it had none) and `/admin/users`
switched from a `Select` to chips, so all six queues now filter the same way.
`/admin/audit` gained search too — it holds the search-iest data on the platform
and had none.

### `ActionConfirm` (new)

`ConfirmDialog` in `shared.tsx` is shaped around a bulk selection (it takes a
`count`), so the money queues had nothing to reach for: **`reject` on a refund
fired on a single click, with no confirmation.** Rejecting a refund or a payout
is not undoable from the UI, so it now gets the same guard the bulk paths always
had. `destructive` is opt-out, because reversing a suspension is not destructive
and should not get a red button.

### Status badges — one module

`RefundStatusBadge`, `PayoutStatusBadge`, `OrganizerStatusBadge`,
`AccountStatusBadge` and `RoleBadge` joined `EventStatusBadge` and
`PaymentStatusBadge` in `dashboard/status-badges.tsx`. The three duplicated
`STATUS_TONE` maps are gone, and the refund queue no longer shows `COMPLETED`
where the payout queue showed "Awaiting review".

Within them, two distinctions are deliberate: a refund that **FAILED** is
destructive while one that was **REJECTED** is not — a rejection is a decision
someone made, a failure is the gateway breaking and needing a human, and those
must not look identical in a queue. Only `SUPER_ADMIN` gets a solid `RoleBadge`,
because in a list of hundreds of customers the accounts with power are the ones
worth spotting.

### `sectionProps` (new, `primitives.tsx`)

Every section had to write
`{...entrance(2)} className={cn('space-y-4', entrance(2).className)}` — calling
`entrance` twice and depending on prop order. Three pages imported `entrance`
and **never called it**, so navigating from Payments to Events dropped the
animation. One helper, applied on all eight.

### `Meter`, on the console

`Meter` and `DeltaChip` existed in `primitives.tsx` and **no admin page used
either**. The events queue now shows sell-through as a meter, and the overview
shows the check-in rate as one, so a ratio reads as a ratio.

---

## Per-page notes

### `/admin` — command centre

Answers one question first: **is anything waiting on me?** The review queue sits
above the metrics, and it now covers **all four** queues — organizer
applications, event submissions, refunds (with failures called out separately as
urgent) and payout requests. It previously knew only about organizers and
events, so an admin had to open the refund and payout pages to discover whether
either needed them.

Zero-count queues are filtered out rather than rendered as reassuring zeros;
when everything is clear, one line says so.

It also stops re-implementing the shared kit: it had its own copy of
`HeroMetric`'s glow div byte-for-byte, its own eyebrow at a different size and
tracking, and its own `text-3xl` value where the primitive is `text-4xl
sm:text-5xl`.

**Ledger position** (held at gateway / in our bank / owed to organizers / our
revenue) comes straight from `accountBalanceMinor`, the same source the payments
page uses — so the two can never disagree.

### `/admin/audit` — a timeline, not a list

Grouped by calendar day with a **sticky day marker** (`sticky top-16`, clearing
the app's `h-16` navbar), because a flat 60-row list makes the reader compute
"when" from timestamps. Each source carries an **icon as well as a tint**, so
the three streams stay separable in greyscale and under colourblindness.

Its truncation note was previously unconditional and hard-coded, and rendered
even under the empty state; it is now conditional and reports the real count.
Search filters client-side on purpose: the endpoint returns a bounded 60 rows,
so a round trip per keystroke would cost more than it saves.

---

## API changes this required

The unified UI would have had to lie without them:

- **`/api/admin/organizers`** gained `q`, `counts` and a 200-row cap
- **`/api/admin/users`** and **`/api/admin/events`** gained `counts` and a cap
- **`/api/admin/stats`** gained `pendingRefunds`, `failedRefunds`,
  `pendingPayouts` and the four `ledger` balances

`counts` is always computed over the **unfiltered** scope, so a backlog stays
visible while the operator is looking at another status. Every capped endpoint
now reports `truncated`, and `TruncatedNote` renders it — payouts declared
`truncated` in its response type and never rendered it, and refunds silently
`.slice(0, 8)`-ed its owed list with no notice at all.

---

## Fixed Anti-Pattern Violations

- ❌ **Hidden filters** — no status folds into a "More" menu on any queue.
- ❌ **Horizontal scroll on mobile** — replaced by the reflowing table.
- ❌ **Emoji as icons** — `categoryEmoji()` in the events queue. Chasing the
  last call site showed the violation had also **moved**: `event-form.tsx`
  rendered `CATEGORY_LABELS[c].emoji` directly in its category select, bypassing
  the helper entirely. Both now use `<CategoryIcon>`, `categoryEmoji` is deleted
  as dead code, and **no component in the app renders an emoji as an icon** —
  closing the list [`ticket-detail.md`](./ticket-detail.md) opened. The emoji
  values remain in `CATEGORY_LABELS` as data; nothing reads them.
- ❌ **A destructive action with no confirmation** — refund `reject`.
- ❌ **A busy row freezing the whole table** — refunds and payouts used
  `disabled={running !== null}`, which disabled *every* row's buttons while one
  row acted. Now scoped with `running?.startsWith(\`${id}:\`)`.
- ❌ **A stale overview after a payout** — payouts invalidated only its own
  query key, so the platform's figures were wrong until a manual refresh.
- ❌ **Dead imports** — `entrance` on three pages, `FilterChips` imported and
  unused on organizers, and the empty `// ===== Shared presentation =====`
  banner in `shared.tsx`.

---

## Checklist Notes

- **Touch:** row actions are `h-8` with `gap-1.5`, and `ConsoleActions` goes
  full-width under `md` so buttons stay thumb-sized rather than shrinking.
- **Colour is never the only signal:** `ConsoleRow`'s `tone` left edge always
  accompanies a badge that carries an icon and a word.
- **Contrast:** status tints are `*/10` fills with `*/60` borders and
  `text-foreground` or the token's own ink — never tinted text on a tinted fill.
- **Selection:** where a row cannot be acted on (an admin, or yourself), the
  checkbox is **absent** rather than present-and-failing, and the actions cell
  explains why.
- **Reduced motion** paired with every transition; **dark mode** and **375px**
  checked on all eight.
