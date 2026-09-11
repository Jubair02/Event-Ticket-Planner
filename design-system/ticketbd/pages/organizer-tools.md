# Organizer Tools Overrides — analytics · payouts · staff

> **PROJECT:** TicketBD
> **Covers three routes**, which share one layout problem and one token bug:
> - `/organizer/analytics` → `src/components/organizer/analytics.tsx`
> - `/organizer/payouts` → `src/components/organizer/payouts.tsx`
> - `/organizer/staff` → `src/components/organizer/staff-manager.tsx`

> ⚠️ **IMPORTANT:** Rules here **override** the Master file (`design-system/ticketbd/MASTER.md`).
> All three follow the console conventions already set in
> [`organizer-event.md`](./organizer-event.md) — dashboard density 8/10, motion 3/10, built
> from `dashboard/primitives.tsx`. Only what is specific to these three is below.

---

## All three were already on the primitives

`HeroMetric`, `MetricGroup`, `Meter`, `Panel`, `SectionHeading`, `entrance`, `CategoryIcon`
were all in place before this pass. This was **not** a restyle — it was fixing what the
restyle had not reached. Do not re-theme these files; extend them.

---

## The shared fix: tables that scrolled sideways on a phone

Every one of the three forced horizontal scroll on mobile, the same HIGH-severity rule
already fixed on the events list:

| File | Was | Now |
|------|-----|-----|
| `analytics.tsx` | `min-w-[860px]` | card list `< lg`, table `lg+` |
| `staff-manager.tsx` | `min-w-[760px]` | card list `< lg`, table `lg+` |
| `payouts.tsx` | `min-w-[680px]` | card list `< lg`, table `lg+` |

The pattern, now used identically on all four organizer surfaces:

```
<Panel padded={false} className="overflow-hidden lg:hidden">   {/* cards  */}
<Panel padded={false} className="hidden overflow-x-auto lg:block"> {/* table */}
```

`overflow-x-auto` **with no `min-w`** on the table: it can degrade to a scroll if content
ever collides, but it never *forces* one. The shell is `max-w-7xl` with a top nav and no
sidebar (~976px of content at `lg`), which is what makes dropping the floor safe.

Each card list is preceded by an `sr-only` `<h3>`, because the table's `<caption>` does not
exist in the card branch and the list would otherwise be an unlabelled region.

**Cards are not the table re-flowed.** Each one re-ranks for the small screen — a payout
card leads with **amount and status** (what a request is checked for) and drops the
reference to a secondary mono line, rather than preserving column order.

---

## Systemic bug found: chart tokens used as text colour

`text-chart-5` / `text-chart-2` were being set on top of a `/10` tint of the *same* token.
Measured (OKLCH → sRGB → WCAG, script in scratch):

| Combination | Ratio | Verdict |
|---|---|---|
| `text-chart-5` on `bg-chart-5/10` | **1.92:1** | severe fail |
| `text-chart-2` on `bg-chart-2/10` | **2.97:1** | fail (4.5:1 needed at 12px) |
| `text-chart-5` on card (icon) | **1.81:1** | fails even the 3:1 icon floor |
| `text-destructive` on `bg-destructive/10` | 4.38:1 | marginal |
| `text-foreground` on `bg-chart-5/10` | **18.37:1** | the fix |
| `text-primary` on `bg-primary/10` | 4.98:1 | **passes — leave alone** |

`chart-*` tokens are tuned for *fills* — chart-5 is a light amber (`oklch(0.78 …)`). They
were never viable as small-text foregrounds.

**The rule going forward:** colour rides the **border and the tint; the label stays
`text-foreground`.** This is already the convention `EventStatusBadge` uses for its
`PENDING_APPROVAL` state. Bump the border to `/50`–`/60` to keep the states as easy to tell
apart as tinted text made them.

Fixed in `payouts.tsx` (`STATUS_TONE`, all five statuses) and `staff-manager.tsx` (the
`ShieldOff` suspend icon, where the colour was decoration only — shape plus `aria-label`
carry the meaning).

### ⚠️ Still outstanding elsewhere — same bug, out of scope for this pass

- `admin/payouts.tsx:80-81` — `APPROVED`, `REQUESTED`
- `admin/refunds.tsx:75-77` — `APPROVED`, `REQUESTED`, `PROCESSING`
- `admin/audit.tsx:41,43` — `REFUND`, `PAYOUT`
- `customer/payment-gateway.tsx:150` — `text-chart-5` on `bg-chart-5/20`
- `organizer-shell.tsx:31` — `[&>svg]:text-chart-5` on the pending-approval alert icon

Worth a single sweep, ideally by extracting a shared `statusTone()` helper so the tone table
stops being copy-pasted per file.

---

## `analytics.tsx`

### Sorting added

"Compare your events side by side" was the stated job, but the order was fixed, so it only
answered whichever question the default happened to match. A `Select` in the section heading
sorts by recency (default, so the list still reads as a timeline), net revenue,
sell-through, tickets sold, or turnout. It reads `e.sellThrough` and `e.attendanceRate`
straight from the API rather than recomputing.

The sort copies before sorting — the react-query cache array must not be mutated in place.

### `potentialMinor` surfaced

The API computes `potentialMinor` per event with the comment that it is *"the ceiling revenue
can reach, which is what makes the sell-through figure meaningful"* — and **nothing rendered
it**, so the headline net-revenue figure had no scale to sit against. Now a bullet under the
hero: net against list-price ceiling, with the ceiling spelled out.

`totals` does not carry it, so it is summed client-side from `events` (honest — it is the
sum of the same per-event values).

Passes `hot={1.1}` so the bar never flips to the warning tone: earning more is good news,
unlike an inventory bar approaching capacity.

### Still no charts

Re-checked `/api/organizer/analytics`: it is `groupBy(['eventId'])` with **no date
bucketing anywhere**. So there is still no time series to plot, exactly as on the per-event
panel. Ratios-against-target render as `Meter` bullet rows, which is the form
`--domain chart` recommends for this data shape. `recharts` stays unused on purpose.

---

## `payouts.tsx`

- **`STATUS_TONE` contrast fixed** (see above). This one mattered most: `REQUESTED` is the
  status an organizer sees while waiting for money, and it was the worst offender at 1.92:1.
- **Removing a payout destination now confirms.** It was a single unguarded click straight
  into `apiDelete` — the only destructive action in the dashboard without an `AlertDialog`.
  Where the money goes is not the place to be the exception.
- Icon-button `aria-label`s now name the destination (`"Remove bKash ending 4321"`) instead
  of a bare `"Remove destination"`, so a screen reader on a two-method list can tell them
  apart.
- Ledger amount moved from a template-literal `className` to `cn()`. The `+`/`−` sign
  already carries direction, so the colour is reinforcement, not the only signal.

---

## `staff-manager.tsx`

- **Unassigned staff are now visible as a problem.** An account with zero assignments can
  sign in and find nothing to scan — a real misconfiguration that rendered as muted grey
  `"No events"` filler. Now a bordered `Not assigned` chip with a warning icon, and the
  count is rolled into the section description (`"4 accounts · 1 suspended · 2 not assigned
  to any event"`), which is the only place the organizer would notice from this screen.
- **Initials avatar per row.** A people list needs a per-row anchor or every row looks
  identical while scanning for one person. Initials, not a placeholder icon — there is no
  avatar field, and the same glyph on every row anchors nothing. Greys out when suspended.
- **Assignment picker got a filter and select-all/clear**, plus a live
  `"n of m selected"` count. It was a bare `max-h-44` scroll box, which does not scale past
  a handful of events; the filter appears from `SEARCHABLE_FROM = 7`.
- Suspend/reactivate/remove extracted to a `renderStaffActions()` render helper (a plain
  function, not a component) so the table and card list share one copy.

---

## Checklist Notes

- Icon buttons stay `size-8`, consistent with the dashboard kit; on mobile the whole card is
  the large target. Same trade-off recorded in [`organizer-event.md`](./organizer-event.md).
- `cursor-pointer` added across all three (it was missing on every icon button).
- Every `Meter` is followed by the count **and** the percentage as text.
- Sort `Select` and the filter `Input` both carry `aria-label`s.

## Known issue, not fixed here

`src/app/organizer/orders/page.tsx:16` fails type check — it passes `initialEventId` but
`OrganizerOrders` does not accept it. This is **in-flight work on the orders page**
(the route is modified, `orders.tsx` is not) and blocks `next build` at the type-check step;
compilation itself succeeds. Left alone deliberately rather than stubbing the prop, which
would silence the error and leave dead code where a real event filter is intended.

`event-form.tsx:169` still fails `react-hooks/set-state-in-effect` (pre-existing, see
[`organizer-event.md`](./organizer-event.md)).
