# Organizer Overview Overrides — `/organizer`

> **PROJECT:** TicketBD
> **Page Type:** Supply-side retention (not reporting)
> **Component:** `src/components/organizer/overview.tsx`

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/ticketbd/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Design context: this page is a renewal decision

Every other dashboard in the product reports. This one **sells**. An organizer
opens `/organizer` between events and decides, mostly unconsciously, whether to
run the next one here or somewhere else. The page has to answer that, not merely
be accurate.

Three facts decide it:

1. **Did I make money, and can I get at it?**
2. **Did the platform actually sell my tickets?** (sell-through is TicketBD's
   entire value proposition, stated as a number)
3. **Did the audience turn up?** (a sold ticket that nobody redeems is a refund
   waiting to happen)

Everything else is secondary, including anything the platform finds interesting
about itself.

**The colour-drift warning in [`event-detail.md`](./event-detail.md) applies
unchanged:** the Master's orange palette and Righteous/Poppins pairing are
stale. The shipped tokens in `src/app/globals.css` (emerald primary, Geist Sans)
are the source of truth.

---

## Pattern Override

The design DB returns **Event/Conference Landing** for organizer/event keywords.
**This is a misroute** — that is an attendee-facing marketing pattern (speaker
grids, agendas, sponsor logos, register CTAs) and none of it applies to a
console the organizer is already inside.

The style hit, however, is right and was adopted: **Comparative Analysis
Dashboard** — "period-over-period metrics, performance benchmarks, delta
indicators". The page is built as a comparison, not a status board.

Section order:

1. **Net earnings** (hero) + withdrawable balance
2. **How your events performed** — three ratio tiles, then a per-event comparison
3. **What needs you** — the action list, derived entirely from their own data

The DB's `AVOID` entries for this query — **"Ornate design"** and **"No
filtering"** — are both respected: no decorative chrome, and the comparison rows
link straight into the filtered analytics section rather than dead-ending.

---

## What changed, and why

| Before | After | Reason |
|---|---|---|
| Hero was **Revenue** (gross) | Hero is **Net earnings** | Gross is the platform's vanity number. Net, after refunds and the 3% fee, is the organizer's actual outcome. |
| No comparison anywhere | Delta vs previous event + per-event rows | A single lifetime total cannot answer "is this working for me". |
| Two generic `MetricGroup` columns | One balance group + three ratio tiles with meters | Counts became ratios: `12 events` is trivia, `71% sell-through` is a decision input. |
| No mention of money owed | `Your balance` group + `Withdraw earnings` CTA | The strongest retention lever in the product was invisible from its landing page. |
| Zeroes on a fresh account | Dedicated `FirstRun` panel | A wall of ৳0 is the worst possible first impression on the one screen meant to win the organizer over. |

---

## Data Override

The page reads **three** endpoints rather than one:
`/api/organizer/stats`, `/api/organizer/analytics`, `/api/organizer/wallet`.

All three query keys are shared with `/organizer/analytics` and
`/organizer/payouts`, so navigating between those sections is served from cache
instead of refetching.

### The delta is real or absent — never invented

Nothing in the schema snapshots history, so there is **no "vs last month"** to
show. The one honest period-over-period comparison available is *this event vs
the one before it*, computed from `analytics.events` by `startDate`.

`previousEventDelta` returns `null` — and the chip is simply not rendered —
when either:

- fewer than two events have sold anything, or
- the baseline event's net is `<= 0` (a ratio against zero is not a percentage).

A fabricated sparkline was considered and rejected for the same reason: there is
no per-day sales data in the schema, so any trend line would be decoration
shaped like evidence.

---

## Component Overrides

### `HeroMetric` (shared, `dashboard/primitives.tsx`)

- **`tabular-nums` removed from the value.** Equal-width digits are for columns
  that must align; at display size they make a number like `121` look loosely
  spaced. Proportional figures on the hero, `tabular-nums` retained everywhere
  numbers stack vertically. *(Fixes a dataviz anti-pattern that affected all
  eight dashboard sections.)*
- Value promoted to `text-4xl sm:text-5xl` — a hero figure is ≥48px.
- New optional `delta` slot, rendered inline beside the value.
- **Exactly one hero figure per view** — the other tiles are deliberately
  `text-2xl`.

### `DeltaChip` (new, shared)

Signed change against a **named** baseline. Colour never carries direction
alone: an arrow rides with it, and `goodWhenUp` exists because "up" is not
always good (more refunds is a worse number). A sub-1% change renders as
"No change" rather than "+0%", which reads as a bug.

### `Meter` (new, shared)

- The unfilled track is `bg-primary/12` — **a lighter step of the fill's own
  ramp, not a neutral grey** — so the bar reads as one scale end to end rather
  than "coloured part plus empty part".
- Severity rides the fill: `bg-primary`, switching to `bg-chart-5` at 80%, the
  same "almost gone" threshold `event-card.tsx` and `event-detail.tsx` use.
- `role="img"` + a sentence label, so assistive tech hears the ratio.

### Per-event comparison row

Whole row is a `Link` to that event's analytics. Carries the category icon, the
title with its status badge, a sell-through meter with `sold/capacity`, net
revenue, and attendance. Sell-through gets the meter because it is the
platform's own contribution to the outcome.

---

## Motion Overrides

Motion dial **4/10**, just under the Master's 5/10. This is a decision surface,
not a showcase.

- Section reveal: `entrance(0…3)` — the `animate-in` idiom already used by
  `home.tsx` and the other dashboard sections. **No GSAP** (this project has
  none — see [`event-detail.md`](./event-detail.md)).
- Meter fill: `transition-[width] duration-500`
- Row hover: `bg-muted/50` + a 2px arrow nudge, `duration-200`
- Press feedback: `active:scale-[0.98]` on CTAs
- Every transform paired with `motion-reduce:`

---

## Fixed Anti-Pattern Violations

- ❌ **`tabular-nums` on a hero figure** — see `HeroMetric` above.
- ❌ **Neutral-grey meter track** — replaced with a same-ramp step.
- ❌ **Dead-end CTAs** — "Analytics" pushed to `/organizer/events`, and
  "Create event" pushed to `/organizer/events` *without* `?new=1`, so the button
  did not do what it said. Both now resolve through `paths.*` to the right place.
- ❌ **An empty bordered box** — the action list rendered an empty `<ul>` when
  no condition matched. It is now built as data, so "Nothing needs you right
  now" is a real state.
- ❌ **`router.push` on every control** — replaced with real `Link`s, so rows
  and CTAs are middle-clickable and prefetched.

---

## Checklist Notes

- **Touch:** CTAs `h-9`/`h-10` with ≥8px gaps; comparison rows are full-width
  targets far above 44px.
- **Contrast:** every tone pairs colour with an icon and a sentence. Amber
  `chart-5` is used as a *fill*, never as text.
- **Responsive:** comparison rows reflow to stacked at `<sm` (`basis-full`,
  meter goes full-width); the trailing arrow is `sm:`-only. No horizontal
  scroll at 375px.
- **Reduced motion / dark mode / 375px** all checked.
