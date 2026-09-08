---
target: all pages/views (src/app/page.tsx SPA shell)
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 3
timestamp: 2026-09-08T11-19-16Z
slug: src-app-page-tsx
---
Method: dual-agent (A: aa5c9b9a42ff8aebc · B: a57c3266d806b96d9), run sequentially so detector output could not anchor the design judgment. No browser automation in this session — all visual judgments are source-derived, not from rendered pixels.

## Per-view verdict

| View | Needs UI change? | Headline reason |
|---|---|---|
| Home | Yes — moderate | Five stacked equal-weight sections, same event can appear 3×; 9 category chips; "Featured" renders an empty grid |
| Event detail | **Yes — critical** | Ticket selection is discarded on the way to checkout; login mid-purchase dumps you on Home; fee hidden on mobile |
| Checkout | Yes — major | 28px quantity steppers change the price; terms checkbox links to nothing; all validation is post-submit toast |
| Payment gateway | Yes — moderate | Best screen in the app, but zero headings, and "Simulate failed payment" sits under a real-looking SSL claim |
| Payment success | No — minor only | Genuine peak moment; verified server-side |
| My tickets | Yes — major | Pending/unpaid orders are invisible in all three tabs |
| Ticket detail | **Yes — critical** | Online-only QR at the venue gate; ends on a "Copy QR Token" debug button; `window.print()` is a no-op on iOS |
| Organizer dashboard | Yes — moderate | Overview promises activity that doesn't exist; 9 status chips; row spinners fire on every row at once |
| Admin dashboard | Yes — major | 12 undifferentiated tiles; the one real job (approval queue) is tile #7; no bulk actions; 1 heading for 4 tables |
| Staff scanner | Yes — major | Defaults to manual typing, 3 taps per attendee, no audio/haptic, laid out as a desktop grid |
| Auth dialog | Yes — major | 4 one-tap demo logins on the primary tab, incl. instant Super Admin |
| Profile dialog | Yes — minor | Escape closes the dialog *and* navigates you to Home |

## Design Health Score (Nielsen, from Assessment A)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | One shared pending flag spins every row at once (events-manager.tsx:150,264; admin-dashboard.tsx:347,462) |
| 2 | Match system / real world | 3 | Raw enums leak: `PENDING_APPROVAL` (staff-scanner.tsx:225), `CARD` (payment-success.tsx:135) despite EVENT_STATUS_LABELS existing |
| 3 | User control and freedom | 1 | `navigate()` never touches history (store.ts:40-43): Back exits the app, nothing is shareable, refresh loses everything |
| 4 | Consistency and standards | 2 | `destructive` means both "12 days left" and "Cancelled"; AlertDialog vs native `window.confirm` (event-analytics.tsx:318) |
| 5 | Error prevention | 1 | All validation is post-submit toast; no inline errors, no `aria-invalid`; admin moderation fires with no confirm |
| 6 | Recognition rather than recall | 3 | Ticket-type editing hidden behind the "Analytics" dialog (event-form.tsx:489) |
| 7 | Flexibility and efficiency | 1 | No bulk actions, pagination, sorting, or export; scanner defaults to manual typing |
| 8 | Aesthetic and minimalist design | 2 | 12 equal-weight admin tiles; icon+emoji doubling (staff-scanner.tsx:483) |
| 9 | Error recovery | 2 | Payment failure state is excellent; no failed query anywhere offers Retry |
| 10 | Help and documentation | 2 | Terms checkbox blocks checkout on a document that does not exist (checkout.tsx:374-376) |
| **Total** | | **20/40** | **Acceptable — significant improvements needed** |

## Audit Health Score (technical)

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 2 | No `prefers-reduced-motion` anywhere; `aria-live` used exactly once; payment view has zero headings; no focus move on view swap |
| 2 | Performance | 2 | 12 raw `<img>`, no `loading="lazy"`, no `next/image`, no dimensions; home fires 3 overlapping event queries; no pagination |
| 3 | Theming | 3 | Real oklch token system + `.dark` block; 55 hardcoded palette utilities in 5 files; `enableSystem={false}` ignores OS preference |
| 4 | Responsive | 2 | 28-32px touch targets on price controls; 4 tables at min-w 760-900px with Actions last; no `safe-area-inset`; logged-out mobile has no nav |
| 5 | Implementation integrity | 2 | Detector clean (0/109 files), but verified drift: `statusBadge` triplicated, `ticketWindow` duplicated, 3 interchangeable dashboards, dead/invalid classes |
| **Total** | | **11/20** | **Acceptable — significant work needed** |

## Design Specificity Verdict

**LLM assessment:** Authored at the edges, category-interchangeable at the core — roughly 25% product-specific. Genuinely authored: the `.ticket-notch` perforation (globals.css:146-167), print isolation, `formatBDT` using `en-IN` lakh grouping, `daysUntil`'s "Happening now", bKash `#E2136E` / Nagad `#F6921E` brand hexes driving live borders, and 🏏 for SPORTS. Interchangeable: Geist + Geist_Mono is the literal create-next-app default with no Bengali coverage and a hardcoded `lang="en"`; one container idiom (`rounded-xl border bg-card shadow-sm`) is the app's only surface treatment; Organizer/Admin/Scanner all resolve to `max-w-7xl` → h1 → TabsList → filter chips → Table. Time is this product's axis and is never used structurally. The ticket — the artifact the product exists to produce — is the best design in the codebase and its vocabulary never propagates back to My Tickets or Payment Success.

**Deterministic scan:** `detect.mjs --json src/app src/components` → exit 0, `[]`, **zero findings across 109 files** (36 API routes, 20 project components, 48 vendor shadcn primitives). Verified rather than assumed: a positive-control file with bounce easing correctly returned exit 2. No `.impeccable/config.json` or `DESIGN.md`, so no rules were suppressed. The codebase trips none of Impeccable's pattern-matched anti-patterns. The detector caught nothing Assessment A missed, and produced no false positives to discount.

**Visual overlays:** None. No browser automation is exposed in this session, so no live server was started, no script injected, and no user-visible overlay exists.

## Overall Impression

The engineering is ahead of the design. Payment integrity, server-verified success, redundant coding on the scanner result card, and the ticket perforation are genuinely good — someone thought carefully about trust at the moment money moves. But the product loses users in the seams between screens, not on any single screen: signing in mid-purchase throws you to Home, your ticket selection evaporates on the way to checkout, Back exits the app, and no event has a shareable URL. The single biggest opportunity is not visual — it is making navigation real (URL state) and preserving user intent across the auth and checkout boundary. Fix that and a mediocre-scoring app becomes a competent one.

## What's Working

1. **Payment integrity is surfaced as UI, not hidden as backend correctness.** An already-PAID order redirects rather than allowing re-payment (payment-gateway.tsx:47-52); failure is derived from server state so refresh can't hide it; success is gated on a server fetch, never the URL (payment-success.tsx:37-43), with a distinct "no tickets have been issued" state. Money flows are where interfaces most often lie for convenience; this one refuses to.
2. **`ResultCard` is designed for its physical context.** Four redundant signals — border, tint, icon, all-caps word — with the attendee name as the largest element (staff-scanner.tsx:451-556). It survives glare, colourblindness and a cracked screen at arm's length in a queue. The one screen designed for where it will actually be used.
3. **Local texture in the authored places.** Lakh-convention currency, the ticket perforation, print isolation, and wallet-brand colours on the payment screen are the moments a Bangladeshi user recognises as *for them*.

## Priority Issues

### [P0] Signing in mid-purchase destroys the purchase
**Why it matters:** The highest-intent second in the product is punished. Tap Buy Ticket → asked to log in → comply → land on the **homepage** with the event gone and the selection erased. Most people leave. Every acquisition effort on the public flow burns here.
**Fix:** Add `returnTo?: View` to `openAuth`, and in `afterAuth` return there when present; apply `landingViewForRole` only to cold logins from the navbar.
**Location:** auth-dialog.tsx:61-66, store.ts:49-59, triggered from event-detail.tsx:94-101.
**Suggested command:** `/impeccable harden`

### [P0] Ticket quantities selected on the event page are silently discarded
**Why it matters:** The user picks 2× VIP + 1× Regular, watches the total update, taps Buy — checkout shows 1× the first available type. Either they re-enter everything or they buy the wrong tickets. Silent, expensive, and the interface's fault.
**Fix:** Carry items in the view: `{ name: 'checkout'; eventId; items }`, and initialise `effQtys` from it; keep the first-type default only for arrivals without a selection.
**Location:** event-detail.tsx:100, checkout.tsx:94-109, store.ts:9.
**Suggested command:** `/impeccable harden`

### [P0] No URL or history: Back exits the app, nothing is shareable, refresh loses everything
**Why it matters:** Three failures from one cause. Back — the most-used mobile control — leaves TicketBD. No event can be shared, bookmarked or linked, which is fatal for a discovery-driven ticketing business and leaves zero organic search surface despite carefully written metadata in layout.tsx:16-24. Refresh mid-checkout strands the order.
**Fix:** Minimum: `history.pushState` in `navigate` plus a `popstate` listener. Correct: real App Router segments (`/events/[id]`, `/checkout/[id]`, `/tickets/[id]`) with zustand kept for UI state only — every view already fetches its own data, so the SPA switch buys little.
**Location:** store.ts:40-43, page.tsx:68-125.
**Suggested command:** `/impeccable shape`

### [P1] The e-ticket is online-only at the venue gate
**Why it matters:** The core promise is "show QR at the venue — no printout needed", but ticket-detail.tsx:58-84 refetches `/api/orders/mine` on every mount and generates the QR client-side. At a basement venue or a field outside Dhaka with 5,000 phones on one tower, that request fails and the attendee has no ticket. No offline cache, no wallet pass, no saved image — and `window.print()` downloads nothing on iOS.
**Fix:** Cache paid tickets (QR data URL + code + event summary) to IndexedDB on first load, render from cache on fetch failure with a visible "saved offline" state, and add a real canvas "Save ticket image". Darken the QR from `#0B7A4B` to near-black for cheap gate scanners.
**Location:** ticket-detail.tsx:58-84, 205-210.
**Suggested command:** `/impeccable harden`

### [P1] The scanner defaults to manual typing and costs 3 taps per attendee
**Why it matters:** In Operate mode task completion outranks everything. `scanTab` initialises to `'manual'` and is reset to manual on every event selection, with `autoFocus` popping the keyboard — so the default path for a gate tool is hand-typing `EVT-2026-000123` per person. Even in camera mode: scan stops itself → tap CHECK IN → tap "Scan Next". At a 500-person door that is ~1,500 taps, with no audio or haptic confirmation in a loud dark environment.
**Fix:** Default to camera, drop `autoFocus`, add an "auto check-in on VALID" toggle, auto-resume scanning after a result, and add distinct success/failure sounds plus `navigator.vibrate`.
**Location:** staff-scanner.tsx:37, 205, 122-127, 343, 493.
**Suggested command:** `/impeccable adapt`

### [P1] Accessibility: motion, live regions, and headings
**Why it matters:** No `prefers-reduced-motion` anywhere (verified) despite 130-particle confetti, framer-motion view swaps, `animate-ping` and card lift — a vestibular-sensitive user has no escape. `aria-live` appears exactly once in the codebase, so the scanner's VALID/INVALID result is never announced: **a blind staff member cannot operate the scanner.** The payment view has zero headings; admin-dashboard has one heading for four tab panels and four tables. View swaps move no focus and there is no skip link.
**Fix:** Add a reduced-motion branch that preserves state change without movement; wrap the scanner result and live counter in `aria-live="assertive"`/`polite`; add `h2`s per admin tab panel and a heading to the payment view; move focus to the new view's heading on navigate.
**Location:** page.tsx:131-141, staff-scanner.tsx:464-555, payment-gateway.tsx:204, admin-dashboard.tsx:706.
**Suggested command:** `/impeccable audit` then `/impeccable adapt`

### [P2] Admin overview is 12 undifferentiated numbers with no bulk path
**Why it matters:** The admin's job is to clear the approval queue, and the interface buries it as tile #7 of 12 — the only tile with an action. The other eleven have no period ("Total Revenue" of when?) and collapsing icon semantics (`Ticket` reused 4×). Approving 40 pending events means 40 dropdown cycles, with no confirmation and no undo on an action that publishes to the public homepage.
**Fix:** Lead with a single "N events awaiting review" action block; chunk the rest into three labelled groups of ≤4 (People / Events / Money) with an explicit period and distinct icons; add row checkboxes with a bulk Approve/Reject bar and hoist Approve/Reject into visible row buttons for pending rows.
**Location:** admin-dashboard.tsx:141-183, 349-517.
**Suggested command:** `/impeccable distill`

### [P2] An abandoned order is invisible and unrecoverable
**Why it matters:** If a buyer drops off before paying, my-tickets.tsx builds rows only from `order.tickets` and filters on `paymentStatus === 'PAID'` — a pending order has no tickets, so it appears in none of the three tabs. Meanwhile the payment failure state tells them to go "Back to My Tickets", where they find nothing.
**Fix:** Add a "Pending payment" group (or a fourth tab) listing unpaid orders with a Resume Payment action.
**Location:** my-tickets.tsx:105-133, payment-gateway.tsx:194.
**Suggested command:** `/impeccable harden`

## Persona Red Flags

**Casey (distracted mobile user)** — Logged out on a phone she has *no navigation at all*: desktop nav is `hidden md:flex` and the mobile nav row is wrapped in `{user && …}` (navbar.tsx:62,185). Checkout's quantity steppers are `h-7 w-7` = 28px with `gap-1` (checkout.tsx:319-336), so a mis-tap between − and + silently changes her total. The fixed bottom buy bar has no `pb-[env(safe-area-inset-bottom)]` (event-detail.tsx:384, verified absent app-wide). "Max N per order" is `hidden sm:block` (event-detail.tsx:328), so on mobile the + button just stops responding with no explanation. Four tables force two-axis scrolling with the Actions column always last and off-screen. And an interruption is unrecoverable: no URL state drops her on Home, where her started order is invisible.

**Jordan (confused first-timer)** — Four one-tap demo logins sit on the primary Login tab under a "DEMO ACCOUNTS" separator (auth-dialog.tsx:235-249); tapping "Admin" drops him into a Super Admin dashboard with suspend-user and moderation powers, with nothing framing these as anything but how you log in. "Simulate failed payment" renders in destructive red directly under "Pay ৳1,545" on a screen that simultaneously claims "256-bit SSL encrypted" and "Demo Mode" — he cannot tell what is real, and the security claim is false while wearing a real payment brand's name. "SSLCOMMERZ" appears four times and "IPN" once, never explained. He is blocked from checkout by consent to a document that does not exist.

**Sam (screen reader + keyboard)** — The payment view has no headings at all; "Choose payment method" is a `<p>` (payment-gateway.tsx:204). admin-dashboard.tsx is 736 lines with four tab panels and four tables and exactly one heading — his heading list for the whole admin app is one item. View swaps unmount the activated element inside `AnimatePresence` with no focus move, no live region and no skip link, so after Buy Ticket he has no indication anything happened. `aria-live` is used once in the entire codebase (verified), so the scanner's entire output is silent — he cannot work a gate. Escape on the profile dialog both closes it and navigates to Home (profile-dialog.tsx:83). The only explanation of why delete is disabled lives in a `title` on a `disabled` button (event-analytics.tsx:310-316), which is unfocusable. Credit where due: icon buttons are widely `aria-label`led, Radix traps focus correctly, and `EventStatusBadge` always renders text.

## Minor Observations

- Every image is a raw `<img>` with no dimensions and no `loading="lazy"` (verified: 12 tags, 0 `next/image`); the home grid eagerly fetches up to 16 banners.
- "Featured Events" renders a heading above an empty grid on a fresh install — it guards only `!hasFilters`, unlike Popular which also checks length (home.tsx:216 vs 235).
- Copy bug: `${events.length} events` prints "1 events" (home.tsx:196).
- Footer "Browse Events" and "Popular Events" both navigate to Home (footer.tsx:41,46).
- "© 2026 TicketBD — MVP demo" ships to production (footer.tsx:78).
- `h-4.5 w-4.5` is not a Tailwind scale value and silently does nothing (admin-dashboard.tsx:110).
- `className="scrollbar"` (staff-scanner.tsx:423) is a dead class — globals.css styles scrollbars via the bare `::-webkit-scrollbar` selector, so the styling applies anyway but the class is meaningless. That styling is webkit-only with hardcoded oklch and no dark override.
- `EmptyState` hardcodes `<h3>` regardless of context and is used at page level where no h1/h2 precedes it (empty-state.tsx:24, page.tsx:37).
- `event-analytics.tsx:304` hardcodes `maxPerOrder: '5'` when opening the edit row, silently resetting a cap the organizer set deliberately.
- `ticketWindow` is duplicated verbatim (event-detail.tsx:49-63, checkout.tsx:58-72) and `statusBadge` three times (my-tickets.tsx:26, ticket-detail.tsx:35, payment-success.tsx:23) — divergence risk on the exact validity labels a buyer reads.
- `Toaster position="top-center"` overlays the sticky navbar, and for logged-in mobile users covers the second nav row — the toast obscures their only navigation.
- `providers.tsx:25` sets `enableSystem={false}` with `defaultTheme="light"`, so the OS dark preference is ignored (a manual toggle exists).
- Organizer Overview promises "Recent activity … will appear here" for a feature that does not exist (overview.tsx:76-80).
- A rejected ticket at the gate is a dead end: no attendee lookup by name/phone, no escalation, no override request (staff-scanner.tsx:524-555).
- No pagination or sorting on any of the four tables; no attendee-list export for organizers (a paper gate list is standard in this category).

## Questions to Consider

1. If the most important second in this product is a phone held to a scanner at a gate, why is that phone screen the least designed surface? What would the app look like if `ticket-detail.tsx` were designed first and everything built backwards from it?
2. What is the SPA architecture actually buying you? Every view already fetches its own data, while the cost is no shareable event URLs, no working Back, no refresh survival, and no organic search surface.
3. A Bangladesh-first platform ships Geist, `lang="en"` and no Bengali glyph coverage. Is English-only deliberate positioning, or an unexamined default? Which single screen would matter most in Bangla, and what breaks in the layout when you add it?
4. Nine status chips and a 12-tile grid suggest the dashboards don't know what their users came to do. What falls away if each is built around exactly one job?
5. Red is currently the colour of "12 days left", "Cancelled", and "Simulate failed payment". Scarcity is the emotional engine of ticket sales and it has been spent on a routine date badge. What would a real urgency system look like, reserving `--destructive` for things that are actually wrong?
