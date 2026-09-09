# Event Detail Page Overrides — `/events/[slug]`

> **PROJECT:** TicketBD
> **Page Type:** Conversion / Product Detail
> **Component:** `src/components/customer/event-detail.tsx`

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/ticketbd/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## ⚠️ Master file colour drift

The Master specifies an **orange** palette (`#EA580C` primary, `#2563EB` accent) and the
`Righteous` / `Poppins` pairing. **The shipped application does not use these.**

The real tokens live in `src/app/globals.css` and are the source of truth for every
component already built (`home.tsx`, `event-card.tsx`, the admin dashboards):

| Role | Light | Dark |
|------|-------|------|
| Primary | `oklch(0.51 0.115 160)` — deep emerald | `oklch(0.72 0.13 158)` |
| Background | `oklch(0.99 0.004 120)` | `oklch(0.155 0.012 160)` |
| Accent | `oklch(0.94 0.04 150)` | `oklch(0.3 0.03 158)` |
| Chart-5 (scarcity amber) | `oklch(0.78 0.14 85)` | `oklch(0.78 0.14 85)` |

Typography is **Geist Sans / Geist Mono** via `next/font` (`src/app/layout.tsx`), not
Righteous/Poppins.

**This page follows the shipped tokens, not the Master's palette.** Either regenerate the
Master from the real tokens or treat the colour/typography tables there as stale.

---

## Page-Specific Rules

### Pattern

Master's global pattern is *Marketplace / Directory* — correct for `/` and `/events`, wrong
here. This page uses **Event/Conference Landing**:

1. **Hero** — poster, identity, countdown, price anchor, primary CTA
2. **Facts card** — when / where / organizer, lifted over the hero
3. **About** — collapsible long copy
4. **Tickets** — the priced menu (the actual conversion surface)
5. **Assurances** — payment, e-ticket, methods
6. **Persistent order summary** — sticky rail on desktop, bottom bar on mobile

### Layout Overrides

- **Max width:** `max-w-7xl` (matches the rest of the app), not the 1200px in `home-browse.md`
- **Grid:** `lg:grid-cols-3` — main column spans 2, order summary occupies the third
- **Hero height:** `min-h-[24rem] / sm:27rem / lg:30rem`. The extra height is *earned* by
  content (badges, eyebrow, title, countdown, price, CTA) — never empty letterboxing.
- **Facts card overlap:** `-mt-12 sm:-mt-16`, so hero padding is `pb-24 sm:pb-32` to clear it
- **Sticky offsets:** summary rail `top-24`; `#tickets` gets `scroll-mt-24`. Both clear the
  `h-16` sticky navbar in `app-chrome`.

### Radius Overrides

- Facts card: `rounded-3xl` — the single most-elevated surface on the page
- Every other card / list: `rounded-2xl` (Master's 12px is superseded by the app's scale)
- Steppers and glass chips: `rounded-full`

### Elevation Overrides

Master's `--shadow-*` scale is replaced by tinted Tailwind shadows, matching `home.tsx`:

| Surface | Shadow |
|---------|--------|
| Facts card | `shadow-2xl shadow-primary/[0.07]` + `ring-1 ring-inset ring-white/40 dark:ring-white/5` |
| Sticky summary | `shadow-xl shadow-primary/[0.06]` |
| Ticket list, assurances | `shadow-sm` → `hover:shadow-md` |
| Hero CTA | `shadow-lg` |

### Color Overrides

- **Strategy:** the page is monochrome-plus-emerald. Primary is spent only on the things
  that convert: CTAs, the running total, the selected-ticket rail and chip.
- **Hero:** the banner is an arbitrary organizer upload, so every hero chip carries its own
  backing (`bg-white/12 backdrop-blur-md`, `bg-white/90 text-neutral-900`) and never
  inherits a page token. Two stacked scrims — vertical `from-black/92` for the title,
  horizontal `from-black/55` for the left edge.
- **Scarcity:** `text-destructive` only at ≤5 or ≤10% remaining; the meter turns
  `bg-chart-5` at ≥80% sold. Same thresholds as `event-card.tsx`.
- **Date tone:** red (`destructive`) is reserved for Today/Tomorrow. A routine "12 days
  left" is neutral — an alarm colour on every event teaches people to ignore it.

### Typography Overrides

- **H1:** `text-3xl sm:text-5xl lg:text-6xl`, `font-semibold`, `leading-[1.06]`,
  `tracking-tight`, `text-pretty`
- **Eyebrow:** `text-[11px] font-semibold uppercase tracking-[0.16em]` ("Presented by",
  "Starts in", "From")
- **Table/field labels:** `text-[10px] font-semibold uppercase tracking-[0.14em]`
- **Lead paragraph:** first `<p>` of the description gets `text-base sm:text-[17px]
  text-foreground/85`; the rest stays `text-[15px] text-muted-foreground`
- **Measure:** description capped at `68ch`
- **Every number** carries `tabular-nums` — prices, counts, countdown, totals

---

## Page-Specific Components

### Countdown

Days / hours / minutes as glass tiles in the hero. Addresses the pattern's explicit
anti-pattern (**"No countdown"**).

- Target is `startDate`'s calendar day + the separate `startTime` column — the moment the
  rest of the UI already prints. Using `startDate` alone counts down to midnight.
- Clock comes from `useSyncExternalStore`, snapshot **quantised with `Math.ceil` to the
  minute**: stable between minutes (so React bails out of no-op renders), and never claims
  more time than remains. `getServerSnapshot` returns `0` → renders nothing server-side.
- A `00 days` tile is dropped rather than shown.
- The tiles are `aria-hidden`; the wrapper carries `role="group"` +
  `aria-label="Starts in 3 days, 4 hours, 12 mins"`, so AT hears a sentence, not six digits.

### Ticket menu

One bordered surface with a column header and `divide-y` rows — not a stack of identical
cards, which would compete with the facts panel.

- **Selected state is never colour-only:** `bg-primary/[0.05]` + a 3px `bg-primary` left
  rail + a `Check` "n selected" chip + the row's line total + the summary list.
- **Stepper:** pill of two buttons, `size-11` (44px) on touch, `size-9` on pointer.
- **Per-order limit is always visible** — it used to be `sm:`-only, so on a phone the `+`
  button just stopped responding with no explanation.

### Order summary

Rendered twice (`hidden lg:block` rail / `lg:hidden` inline card) from one `summaryBody`
value, so only one copy is ever exposed to AT. Header band + line items + fee breakdown +
CTA + a three-line trust list.

### Collapsible description

Descriptions over 900 chars clamp to `max-h-72` under a `from-background` fade with one
`Read more` control (`aria-expanded` + `aria-controls`). This is the fix for Master's
**"Text-heavy pages"** anti-pattern.

---

## Motion Overrides

Master prescribes GSAP `Stagger List`. **This project has no GSAP** — it uses
`framer-motion` (route transitions only, in `src/app/template.tsx`) and `tw-animate-css`
utilities everywhere else. Do not add GSAP for this page.

- Section reveal: `animate-in fade-in slide-in-from-bottom-3 fill-mode-backwards
  duration-500`, staggered by inline `animationDelay` (0 / 80 / 160ms) — the same idiom as
  the `home.tsx` results grid
- Hover/state transitions: `duration-200`
- Meter fill: `transition-[width] duration-300`
- Press feedback: `active:scale-95` on steppers, `active:scale-[0.98–0.99]` on CTAs
- Every animation and transform is paired with `motion-reduce:`

---

## Fixed Anti-Pattern Violations

- ❌ **Emoji as icons** — the hero and category badge used `categoryEmoji()`. Replaced with
  `<CategoryIcon>` (Lucide), matching `event-card.tsx` and the category rail.
- ❌ **Missing `cursor-pointer`** — added to every non-`<Button>` clickable (hero controls,
  steppers, map link, Read more).
- ❌ **Text-heavy pages** — see the collapsible description above.
- ❌ **Flat design without depth** — tinted, layered shadows plus an inset ring on the
  facts card.

---

## Checklist Notes

- Contrast: hero copy is `text-white` / `text-white/65` on a `black/55–92` scrim; body copy
  uses `muted-foreground`, which is AA in both themes.
- Touch: steppers 44px on mobile; hero controls `h-10` inside a 40px+ pill with ≥8px gaps.
- Focus: `focus-visible:ring-2 ring-ring` on every custom control; `ring-white/80` for the
  glass controls over the banner.
- The mobile bottom bar keeps `pb-[max(0.75rem,env(safe-area-inset-bottom))]`, and the page
  keeps `pb-32 lg:pb-16` so the bar never covers content.
