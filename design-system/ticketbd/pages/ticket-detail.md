# E-Ticket Page Overrides — `/tickets/[ticketId]`

> **PROJECT:** TicketBD
> **Page Type:** Credential / Utility (not a marketing or browse surface)
> **Component:** `src/components/customer/ticket-detail.tsx`

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/ticketbd/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Design context: this is a gate document

Every decision here answers one question: **can this person get through the door in the next
ten seconds?** The usage conditions are the worst in the product — outdoors in daylight,
one hand, a bright screen, patchy signal, and someone waiting behind them.

That makes this page unlike every other screen in TicketBD. Rules that are right elsewhere
(rich hero, discovery, browsing, generous editorial copy) are wrong here.

**The colour-drift warning in [`event-detail.md`](./event-detail.md) applies unchanged:**
the Master's orange palette and Righteous/Poppins pairing are stale. The shipped tokens in
`src/app/globals.css` (emerald primary, Geist Sans) are the source of truth.

---

## Pattern Override

The design DB returns **App Store Style Landing** for e-ticket/QR keywords. **This is a
misroute** — it is a landing-page pattern (device mockups, screenshots, ratings, download
CTAs) and none of it applies to a credential the user already owns.

The pattern used instead is **Mobile Credential / Boarding Pass**:

1. **Status** — can I enter, yes or no
2. **QR** — the thing the scanner needs
3. **Ticket code** — the spoken fallback when the scanner fails
4. **Primary action** — full-screen gate view
5. *(below the perforation)* Event identity and credentials
6. Offline reassurance, secondary actions, print fallback

The DB's `AVOID` entry for this query — **"Poor mobile"** — is the whole brief.

---

## Layout Overrides

- **Max width: `max-w-md`.** Master and every other page use `max-w-7xl`. A wide layout here
  only pushes the QR further down a phone screen; the page is a single narrow column at all
  breakpoints.
- **QR leads, event identity follows.** A paper stub puts the event at the top and the
  tear-off at the bottom. This is not paper. The QR is above the perforation and the event
  details below it — an inversion of the physical metaphor, chosen deliberately.
- **Above the fold on a 375×667 phone:** top bar → status band → QR (`max-w-[17rem]`) →
  code → primary CTA. Verified to fit without scrolling.
- **Sticky gate bar** (`lg:hidden`) holds the primary action in thumb reach; page carries
  `pb-28 lg:pb-10` to clear it, with `pb-[max(0.75rem,env(safe-area-inset-bottom))]` inside.
- **Z-index:** navbar `z-40`, sticky bar `z-40` (no spatial overlap), gate mode `z-50` via
  the Dialog portal — consistent with the 10/20/30/50 scale.

## Density Override

Master density is 4/10 (Standard). This page runs **tighter** — `py-2.5` detail rows,
`gap-4` stack — because vertical space spent on rhythm is vertical space the QR loses.

---

## Page-Specific Components

### Gate mode (the headline change)

A full-screen, **pure-white, theme-independent** overlay: QR at `w-[min(86vw,52vh)]`, the
code beneath at `text-2xl sm:text-3xl`, attendee name for an ID check, and nothing else.

- **White is not a style choice.** It is the highest-contrast backing for a cheap scanner
  *and* the brightest thing a web page can put on an outdoor screen. `neutral-*` and
  `emerald-700` are hardcoded here rather than themed, for the same reason the QR plate has
  always been white: a QR inverted by dark mode does not scan.
- **Screen Wake Lock** is held while open (`navigator.wakeLock`). A phone that sleeps in the
  queue is the most common reason an e-ticket "doesn't work". The lock is re-acquired on
  `visibilitychange`, since browsers drop it whenever the page hides. Unsupported browsers
  get nothing — no faked fallback.
- **The brightness hint is honest.** A web page cannot raise screen brightness, so it asks
  the user to instead. Never imply the app did it.
- Built on Radix `Dialog` for the focus trap, Escape handling and scroll lock; the panel
  overrides the primitive's centred-card defaults (`block`, `inset-0`, `max-w-none`,
  `rounded-none`, `bg-white`).
- **Not offered for void tickets** — the button is replaced by an explanation. A cancelled
  ticket must never get a clean full-screen presentation.

### Status band

Full-width, above the ticket: icon + headline + sentence. Replaces a small badge sitting
beside a `Status` label in a definition list.

| Tone | Status | Treatment |
|------|--------|-----------|
| `valid` | ACTIVE | `bg-primary/10 text-primary` + `ShieldCheck` — "Valid for entry" |
| `used` | CHECKED_IN | `bg-primary text-primary-foreground` + `CheckCircle2` — "Checked in" + time |
| `void` | CANCELLED / INVALID | `bg-destructive/10 text-destructive` + `TicketX` — "Not valid for entry" |

`ticketStatusMeta` remains the single source of truth for the **label** (shared with My
Tickets and Payment Success). `gateTone()` adds only the gate-facing framing on top.

### QR plate

Shared by the page and gate mode. White plate, near-black modules (`#0A0A0A` on `#FFFFFF`),
`inset-ring inset-ring-black/10`, `rounded-2xl`. The QR is generated at **900px** so the
full-screen view upscales from real pixels — it was 480px, rendered at 224px, which would
have gone soft the moment gate mode existed. Void tickets render at `opacity-20` under a
rotated `VOID` stamp so no scannable code is ever presented.

### Offline notice

Promoted from a small outline badge to a proper `chart-5`-tinted panel carrying the saved
timestamp and the reason it still works: *"The QR is generated on this device, so it still
scans at the gate without a signal."* Reassurance, not an alarm — the ticket **is** valid
offline, and the old badge implied degradation.

---

## Print Overrides

Print is **demoted, not removed.** It remains a genuine fallback (a dead phone, a venue that
wants paper), but it no longer shapes the page: it is a `ghost` text button below the
secondary actions instead of a full-width control.

- The `.print-ticket` / `.ticket-notch` contract in `globals.css` is unchanged — the stub
  still carries both classes, so the existing print stylesheet keeps working.
- The status band, gate CTA, sticky bar and offline notice all carry `print:hidden`
  (`display:none` beats the stylesheet's `visibility` toggling).
- The `Status` row stays inside the stub, so **paper still carries the ticket's state**.

---

## Motion Overrides

Motion dial for this page is **3/10 (Subtle)** — below the Master's 5/10. A credential
screen should feel instant, not animated; nothing here reveals on scroll.

- Press feedback only: `active:scale-[0.99]` on CTAs, `duration-200` colour transitions
- The Dialog's own fade/zoom is the single entrance animation
- No GSAP (the DB suggested `Scroll Reveal`; this project has no GSAP — see
  [`event-detail.md`](./event-detail.md))
- Every transform paired with `motion-reduce:`

---

## Fixed Anti-Pattern Violations

- ❌ **Emoji as icons** — the banner strip and category badge used `categoryEmoji()`.
  Replaced with `<CategoryIcon>`, matching `event-card.tsx` and `event-detail.tsx`.
  *(Still outstanding in `my-tickets.tsx`, `payment-success.tsx`, `admin/events.tsx`,
  `organizer/analytics.tsx`, `organizer/events-manager.tsx`.)*
- ❌ **Missing `cursor-pointer`** — added to every control including the gate-mode close.
- ❌ **Decorative use of scarce space** — the 128px event banner strip above the QR was
  pure decoration on the one screen with no room for it. Removed; the category chip and
  the `identity-band` texture carry the brand instead.

---

## Checklist Notes

- **Touch:** gate-mode close is `size-11` (44px); all CTAs `h-12`; secondary `h-11`; ≥8px gaps.
- **Safe areas:** gate mode pads top *and* bottom with `env(safe-area-inset-*)`; the sticky
  bar pads bottom. Gate mode is full-bleed, so both insets matter.
- **Colour is never the only signal:** every tone pairs colour with an icon and a sentence,
  and void tickets additionally get a stamp plus an opacity change.
- **Contrast:** gate mode is `neutral-900` on white (~19:1). The `used` band is
  `primary-foreground` on solid `primary`. Body copy uses `muted-foreground` (AA both themes).
- **Reduced motion / dark mode / 375px** all checked; gate mode is intentionally identical
  in both themes.
