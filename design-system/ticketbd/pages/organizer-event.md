# Organizer Event Console Overrides — `/organizer/events` + `/organizer/events/[eventId]`

> **PROJECT:** TicketBD
> **Page Type:** Internal tool / Management console
> **Components:** `src/components/organizer/events-manager.tsx` (list),
> `src/components/organizer/event-analytics.tsx` (per-event panel)

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/ticketbd/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## The governing constraint: `dashboard/primitives.tsx` is the system

This is **not** a page to style from the Master's tokens outward. The organizer and admin
dashboards already render from a shared kit — `Panel` / `panelClass`, `entrance()`,
`SectionHeading`, `Eyebrow`, `DeltaChip`, `Meter`, `HeroMetric`, `MetricGroup`,
`FilterChip(s)`, `SearchBox` — and `overview.tsx` is the reference implementation of the
resulting language.

**Build from those primitives; do not introduce parallel styling.** Where this redesign
needed something the kit lacks (a dense four-across stat tile inside a dialog), it was kept
**local** to the consuming file rather than added to `primitives.tsx`, because that file is
under active edit. Promote later if a second caller appears.

The colour-drift warning in [`event-detail.md`](./event-detail.md) applies unchanged.

---

## Pattern Override

The design DB returns **Event/Conference Landing** for these keywords (hero with countdown,
speakers grid, sponsors, sticky Register CTA) and **Bebas Neue / Source Sans 3** for
typography. **Both are misroutes** — it is matching the word "event" to a marketing pattern.
This is an internal console for the person *running* the event, not a page selling it to
attendees. The DB's palette note for the dense query, *"Industrial slate + stock green"*, is
the only thematically apt part, and the shipped emerald tokens govern regardless.

Pattern used instead: **Master–detail console.** A filterable list of events; selecting one
opens a per-event panel over it. The panel is deliberately a dialog and not its own page —
`/organizer/events/[eventId]` renders `EventsManager` *behind* it so the URL stays shareable
and dismissing returns to the list rather than to an empty screen. That decision predates
this redesign and was kept.

## Density Override

**Density 8/10 (Dense / Dashboard)** — well above the Master's 4/10. Row padding `py-3`,
stat tiles `p-3`, `gap-3`/`gap-4` between blocks. An operator scanning twelve events wants
rows, not cards with air.

## Motion Override

**Motion 3/10 (Subtle)** — below the Master's 5/10. `entrance()` staggers the top-level
blocks and nothing else moves on load. Hover/state transitions `duration-200`.

---

## Visualisation decision: no chart library, and why

The analytics endpoint returns **totals plus a ten-order tail**. There is no time series
anywhere in the payload, so:

- **No sales-over-time line.** Plotting the last ten orders as a trend would invent a series
  the data does not contain. If a trend is wanted, the endpoint has to aggregate
  `orders.createdAt` server-side first — that is an API change, not a UI one.
- **No donut for check-ins.** Queried `--domain chart`: pie/donut scores **accessibility
  grade C** — *"fail WCAG for colorblind users… avoid as primary chart in a11y contexts"* —
  and it would encode a single number in the least accessible form available.
- **Bullet rows instead.** For *Performance vs Target* the DB recommends a gauge or bullet
  chart, and explicitly: *"for 3+ KPIs use bullet chart grid layout"* with *"always show
  numerical value + % of target as text beside chart."* Sold-vs-capacity and
  arrived-vs-sold are exactly ratios against a target, and `Meter` **is** a bullet bar. So
  every ratio renders as `Meter` + the raw count + the percentage as text.

Net: `recharts` is a project dependency but is **not** used here, on purpose.

---

## `event-analytics.tsx` — what changed

### Width and structure

Was `sm:max-w-2xl` (672px) containing a `min-w-[560px]` table, a five-field inline editor
and an orders list stacked in one scroll. That is a console crammed into a form.

Now `sm:max-w-5xl`, `flex flex-col`, `p-0`:

- **Header pinned** (`shrink-0`), body scrolls (`min-h-0 flex-1 overflow-y-auto`) — the
  event title and status stay visible while scrolling the detail.
- Header carries identity: category mark, title, `EventStatusBadge`, date/time, venue, and
  a *View public page* link when the event is actually live.
- **Figures strip**, four across. **Revenue leads and is the only tinted tile** — it is the
  number the organizer opened the panel to see. Sold / sell-through / checked-in are
  reference figures in the quiet treatment.
- **Two columns at `lg`:** ticket types (`col-span-7`), then check-in + recent orders
  (`col-span-5`). Nothing is hidden behind tabs — an operator comparing sales against
  arrivals needs both on screen at once.

### Ticket types as rows, not a table

Wrapping-flex rows, matching `EventPerformanceRow` in `overview.tsx`. This holds together
from ~340px to full width with **one markup path and no horizontal scrollbar** — the reason
the old table needed a 560px floor.

Add-type moved behind an **Add type** toggle (`aria-expanded` / `aria-controls`) instead of
sitting permanently open below the table: progressive disclosure, and it gives the empty
state somewhere to point.

---

## Bug fixed in passing: `maxPerOrder` was being silently reset

The edit form opened with `maxPerOrder: '5'` hardcoded, then `PUT` that value back — so
**editing any ticket type whose limit was not 5 silently reset it to 5.**

`ticketTypeBreakdown` does not carry the field, which is presumably why it was stubbed. But
the same response includes the full `event.ticketTypes` array, which does. Fixed with a
`Map` built from `a.event.ticketTypes` — **no API change required.**

Also: the quantity input now floors at `t.soldQuantity` when editing, so the form cannot
submit a capacity the server must reject.

## `window.confirm` → `AlertDialog`

Deleting a ticket type used `window.confirm`, which cannot be themed, cannot be styled, and
is suppressible by the browser. Replaced with the `AlertDialog` pattern `events-manager.tsx`
already uses for cancel/delete, so destructive confirmation looks the same everywhere.

---

## `events-manager.tsx` — what changed

- **Horizontal scroll removed on small screens.** The table needed `min-w-[860px]` and
  scrolled sideways to get it — the one HIGH-severity layout rule this dashboard broke.
  Now: a card list below `lg`, the table at `lg+`. The shell is `max-w-7xl` with a *top* nav
  (no sidebar), so ~976px of content at `lg` — the six columns fit with no floor. An
  `overflow-x-auto` guard **without** a `min-w` remains, so the table can degrade to a
  scroll but never forces one.
- **Analytics is one click, not two.** The row title (and the whole mobile card) links to
  `paths.organizerEvent(e.id)` — the deep-linked panel — matching how `overview.tsx` links
  its event rows. The overflow menu keeps every lifecycle action.
- **Emoji as icons removed** (`categoryEmoji` in the thumbnail fallback and the category
  badge) → `CategoryIcon`, matching `overview.tsx` and the customer surfaces.
- **Hand-rolled meter → `Meter`.** The row bar was a bespoke div using a `pct >= 90`
  threshold; the shared primitive's default `hot` of `0.8` now applies, so "almost gone"
  means the same thing here as on `event-card`, `event-detail` and the overview.
- Actions menu and thumbnail extracted to `renderActions()` / `renderThumb()` render
  helpers — plain functions, not components, so the table and card list share one copy
  without threading eight mutation handlers through props.

### Deliberately not added: a revenue column

`EventListItem.ticketTypes` would allow computing `price × sold` per event client-side, but
that gross figure ignores refunds and fees and would sit two clicks from the overview's
**net** earnings. Two money numbers that disagree is worse than one number in the right
place. The list stays about **inventory and lifecycle**; the panel owns money.

---

## Checklist Notes

- **Touch:** overflow triggers and row icon buttons are `size-8` (32px) — below the 44px
  mobile minimum, matching the rest of the dashboard kit. Acceptable here because these are
  pointer-first internal surfaces, and the *whole row* is the 44px+ target on mobile. Revisit
  if organizer mobile use grows.
- **Colour is never the only signal:** every `Meter` is followed by the count and the
  percentage as text; status uses `EventStatusBadge` (label, not just colour).
- **Check-in meter passes `hot={1.1}`** so it never flips to the warning tone — arrivals
  rising is good news, unlike sell-through approaching capacity.
- Focus rings on every custom control; `cursor-pointer` on all of them.
- Dialog header uses `pr-12` to clear the primitive's absolute close button.

## Known issue, not fixed here

`event-form.tsx:169` fails `react-hooks/set-state-in-effect` (**pre-existing in `HEAD`**,
file untouched by this redesign). It resets form state inside an effect when the dialog
opens. The idiomatic fix is remounting via a `key` rather than syncing in an effect — a real
refactor of that component's state model, out of scope for a visual pass.
