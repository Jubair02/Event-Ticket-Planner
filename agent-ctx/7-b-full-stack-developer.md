# Task 7-b — full-stack-developer (Customer UI)

Task: Customer flow components (event detail, checkout, payment gateway, success, my tickets, ticket QR)
Status: COMPLETE — 0 TypeScript errors in scope (`bunx tsc --noEmit | grep src/components/customer` → empty)

## Files created (all 'use client', named exports)

| File | Export | Query keys | Navigates to |
|---|---|---|---|
| src/components/customer/event-detail.tsx | `EventDetail({eventId})` | `['event', eventId]` | checkout / home (openAuth if !user) |
| src/components/customer/checkout.tsx | `Checkout({eventId})` | `['event', eventId]` | payment (after POST /api/orders) |
| src/components/customer/payment-gateway.tsx | `PaymentGateway({orderId})` | `['order', orderId]` | payment-success / my-tickets |
| src/components/customer/payment-success.tsx | `PaymentSuccess({orderId})` | `['order', orderId]` | ticket-detail / my-tickets / home / payment |
| src/components/customer/my-tickets.tsx | `MyTickets({initialTab?})` | `['orders','mine']` | ticket-detail / event-detail / home |
| src/components/customer/ticket-detail.tsx | `TicketDetail({ticketId})` | `['orders','mine']` | my-tickets |

## Behavior highlights
- EventDetail: banner w/ overlay badges, sales-window + stock checks, steppers clamped to min(maxPerOrder, available), sticky desktop summary + fixed mobile buy bar.
- Checkout: prefilled attendee form, mini qty table, 3% fee via `PLATFORM_FEE_RATE`, terms gate, server error messages surfaced via toast (e.g. "Only X tickets left").
- PaymentGateway: mock SSLCOMMERZ card, PAYMENT_METHODS brand colors, 1.2s fake processing, SUCCESS/FAILED outcomes, failure Alert + Try Again, auto-redirect if order already PAID.
- PaymentSuccess: server-verified only; confetti (130/80/y0.7) fires ONCE only after PAID verification; ticket list with View QR Ticket.
- MyTickets: exact contract grouping (cancelled/upcoming/past), counts in tabs, QR CTA card, per-tab empty states.
- TicketDetail: printable `print-ticket` card, `ticket-notch` perforation, client-side QRCode.toDataURL(qrToken, dark #0B7A4B), Print (window.print) + Copy QR Token, CHECKED_IN alert.

## Decisions / deviations
1. Confetti fires after server verification instead of raw mount (spec conflict resolved in favor of "never assume success").
2. After successful execute, gateway calls `queryClient.removeQueries(['order', orderId])` so the success page always re-verifies against fresh server state (no stale PENDING flash from cache).
3. Checkout default qty=1 lands on the first *purchasable* ticket type (skips sold-out/closed windows).
4. Helpers (`ticketWindow`, status badge mapper) duplicated per file — shared libs untouched per scope rule.
5. EventDetail's selected quantities are not carried into Checkout (Checkout receives only eventId per contract); Checkout has its own steppers defaulting to 1.

## Notes for orchestrator
- Dev server log: only remaining module-not-found is `@/components/staff/staff-scanner` (agent 7-c scope, expected).
- My components additionally guard `!user` (openAuth) on Buy even though page.tsx gates protected views.
