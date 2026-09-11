# My Tickets Overrides — `/tickets`

> **PROJECT:** TicketBD
> **Page Type:** Wallet / index (the credential itself is `/tickets/[ticketId]`)
> **Component:** `src/components/customer/my-tickets.tsx`

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/ticketbd/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Design context: an index, one tap from the gate

This page is not the ticket — [`ticket-detail.md`](./ticket-detail.md) is, and it
carries the hard constraints (daylight, one hand, someone waiting). This is the
**index that gets you there**, and it is opened in one of two moods:

1. **At or near the venue** — "which ticket do I need, now"
2. **After buying** — "did that actually work"

Both are answered by promoting one row: the next event starting. Everything else
is a list, and a list's only job is to be scannable.

**The colour-drift warning in [`event-detail.md`](./event-detail.md) applies
unchanged:** the shipped tokens in `src/app/globals.css` are the source of
truth, not the Master's orange palette.

---

## Pattern Override

The design DB returns **FAQ/Documentation Landing** for "my tickets / purchased"
keywords. **This is a misroute** — search-led help-centre structure, applied to
a list of things the user already owns.

Two of its notes were kept because they happen to be right:

- *"Clean, high readability. Minimal color. Category icons in brand color."* —
  adopted verbatim.
- *"Search bar prominent"* — adopted **conditionally**: the filter appears only
  past `FILTER_THRESHOLD` (6) rows. Below that, scanning beats searching and a
  search box is furniture.

The DB's `AVOID` entries are the real brief: **"No verification"** and
**"Hidden progress"**. A wallet whose rows do not say, plainly, whether each
ticket is still good is the failure mode — so status is on every row, in three
channels.

Order: header → tabs → **Next up** → *Also coming up* list.

---

## Layout Overrides

- **Max width `max-w-5xl`,** not the app's `max-w-7xl`. This is a single column
  of rows; at 7xl a row's title and its status badge end up 900px apart.
- **`identity-band` header,** full-bleed, matching `DashboardShell`. `/tickets`
  is a signed-in surface, and the shell's stated reason for that band is that
  the signed-in surfaces should read as one place. Previously this page opened
  with a bare `text-2xl font-bold`.
- Page carries `pb-16`; no sticky bar here (the e-ticket owns that).

---

## Page-Specific Components

### `NextUpCard` — the promoted ticket

The soonest upcoming ticket, given the page's most elevated surface:
`rounded-3xl` + `shadow-2xl shadow-primary/[0.07]` + an inset ring, matching the
facts card in `event-detail.tsx`.

- Banner with **two scrims** (vertical `from-black/85` for the copy, horizontal
  `from-black/55` for the left edge). The banner is an arbitrary organizer
  upload, so every chip over it carries its own backing
  (`bg-white/12 backdrop-blur-md`, or `bg-white/90 text-neutral-900`) and never
  inherits a page token.
- **Date chip tone is earned, not automatic:** `bg-white/90` solid only for
  *Happening now*; otherwise glass. Red is reserved — an alarm colour on every
  card teaches people to ignore it. (Same rule as `event-detail.md`.)
- One `h-12` primary CTA: **Show QR at the gate**.
- The ticket is promoted *out* of the list below via
  `const [nextUp, ...rest] = groups.upcoming`, so it never appears twice.

### Row

The **whole row is the link**. Previously the title was a `<button>` and a
separate "View Ticket" button sat in the corner: two targets for one intent, and
neither covered the row — which on touch is the only target that matters.

- **Left rail** (`w-1`, full height) carries the tone: `bg-primary` valid,
  `bg-primary/40` used, `bg-destructive` void.
- Status appears in **three channels at once** — rail colour, tone icon, and the
  label from `ticketStatusMeta`. Never colour alone.
- Past and cancelled rows are **demoted**, not restyled: `grayscale` thumbnail
  and muted title. A spent ticket should not compete with a live one.

### Offline reassurance

The old page carried a permanent card at the top of *Upcoming*: *"Show QR at the
venue — no printout needed."* It occupied the best space on the page, on every
visit, forever, to say something true once.

It is now a single line inside `NextUpCard`, next to the ticket it applies to,
and it says the useful half instead: *"The QR is generated on your device, so it
still scans without a signal."* Same promise as the e-ticket's offline notice.

---

## Density Override

Master density is 4/10. Rows run **tighter** (`p-3`, `text-xs` metadata) so more
than three fit on a phone screen; the promoted card stays at Master density
because it is the one thing meant to be read rather than scanned.

---

## Motion Overrides

Motion dial **3/10 (Subtle)**, matching [`ticket-detail.md`](./ticket-detail.md)
— this is credential-adjacent, so it should feel instant.

- Row entrance: `animate-in fade-in slide-in-from-bottom-1 duration-300`, with
  `animationDelay` of `min(i, 8) * 30ms`. Per the DB's own note, per-item delay
  stays at 30ms and is **capped at the 9th row**: past that a stagger stops
  reading as polish and starts reading as lag.
- Hover: `duration-200` border/shadow, plus a 2px arrow nudge
- Press: `active:scale-[0.99]` on the primary CTA
- Every animation paired with `motion-reduce:`

---

## Fixed Anti-Pattern Violations

- ❌ **Emoji as icons** — `categoryEmoji()` in the thumbnail fallback, the last
  of the violations [`ticket-detail.md`](./ticket-detail.md) listed as
  outstanding for this file. Replaced with `<CategoryIcon>`.
  *(Also cleared in `organizer/analytics.tsx` in the same pass. Still
  outstanding in `payment-success.tsx`, `admin/events.tsx`,
  `organizer/events-manager.tsx`.)*
- ❌ **Two competing targets per card** — see Row above.
- ❌ **A redirect on every click** — the old title button linked via
  `paths.event(event.id)`, which `/events/[slug]` answers with a 308 to the
  canonical slug. That link is *gone* rather than corrected: from a wallet, the
  destination a row should have is the ticket, not the sales page for an event
  you have already bought. The only remaining event link is the Upcoming empty
  state, which points at browse.
- ❌ **Invalid list markup** — the stagger wrapper was a `<div>` between `<ul>`
  and `<li>`. The animation now rides on the `<li>` itself.
- ❌ **Unreserved image space** — every image sits in a box with an explicit
  size, so nothing reflows as it loads. Row thumbnails carry
  `loading="lazy" decoding="async"` (matching `event-card.tsx`); the promoted
  banner deliberately does **not**, because it is above the fold and lazy-loading
  the first thing on screen only delays it.

---

## Checklist Notes

- **Deep linking:** the tab mirrors to the URL through `useUrlQuery` +
  `paths.tickets(tab)`, so `/tickets?tab=past` survives a refresh and can be
  shared — the same idiom the dashboard sections use. `useUrlQuery` skips the
  first render, so it never stamps over the tab the server rendered from.
- **Touch:** rows are full-width targets; the promoted CTA is `h-12`; tab
  triggers carry `cursor-pointer`.
- **Contrast:** banner copy is `text-white`/`text-white/70` over a
  `black/35–85` scrim; metadata uses `muted-foreground`, AA in both themes.
- **Empty states:** all three tabs have one, each with an action where an action
  exists (Upcoming links to browse; Past and Cancelled are terminal and say so).
- **Reduced motion / dark mode / 375px** all checked; no horizontal scroll.
