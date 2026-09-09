# TicketBD — Shared API & Frontend Contract (SOURCE OF TRUTH)

All agents MUST follow this document exactly. Read it fully before writing code.

## 0. Global Rules

- Next.js 16 App Router. Route handlers: `export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> })` — **params is a Promise, always `await params`**.
- DB: `import { db } from '@/lib/db'`. Auth helpers: `import { getAuthUser, requireAuth, requireRole, hashPassword, verifyPassword, generateTicketCode, generateQrToken } from '@/lib/auth'`.
- Money: store as float BDT. **Platform fee = `Math.round(subtotal * 0.03)`** (3%).
- Auth endpoints (login/register/forgot/reset) are rate limited via `@/lib/rate-limit` and answer **429** with a `Retry-After` header when exceeded. The limiter is in-process, so it is per-instance on serverless — back it with a shared store (Vercel KV / Upstash) for hard guarantees.
- Organizer-supplied link fields (`mapUrl`) must pass `safeHttpUrl()` from `@/lib/url`: only http(s) is accepted (400 otherwise), and the renderer re-checks before putting it in an `href`.
- All list/GET responses return plain JSON. Errors: `{ error: string }` with proper status (400/401/403/404/409/500).
- Client fetches via `apiGet<T>(path)` / `apiPost<T>(path, body)` / `apiPut<T>` / `apiDelete<T>` from `@/lib/api` (credentials: 'include', throws Error(message) on !ok).
- Dates are ISO strings over the wire (JSON). `startTime`/`endTime` are plain strings "HH:mm".
- Enums are plain strings (Postgres `text`).
- NEVER create new dependencies. Use only: @prisma/client, jose, bcryptjs, qrcode, html5-qrcode, date-fns, sonner, framer-motion, zustand, @tanstack/react-query, lucide-react, canvas-confetti, shadcn/ui components.
- Do NOT edit: package.json, prisma/schema.prisma, src/lib/* (except reading), src/app/page.tsx, src/app/layout.tsx, src/app/globals.css, src/components/app/*.

## 1. Constants (from `@/lib/constants`)

```ts
export const CITIES = ["Dhaka", "Chattogram", "Sylhet", "Khulna", "Rajshahi", "Cox's Bazar"]
export const CATEGORIES = ["CONCERT","TECH","WORKSHOP","SPORTS","CULTURAL","BUSINESS","GAMING","FOOD"]
// category label map available: export const CATEGORY_LABELS: Record<string,{label:string;emoji:string}>
export const PLATFORM_FEE_RATE = 0.03
```

Roles: `SUPER_ADMIN | ORGANIZER | CUSTOMER | EVENT_STAFF`.
User status: `ACTIVE | SUSPENDED`. Organizer status: `PENDING | APPROVED | REJECTED`.
Event status: `DRAFT | PENDING_APPROVAL | PUBLISHED | ONGOING | COMPLETED | CANCELLED | REJECTED | SUSPENDED`.
Payment/Order paymentStatus: `PENDING | PROCESSING | PAID | FAILED | CANCELLED | REFUNDED`.
Ticket status: `ACTIVE | CHECKED_IN | CANCELLED | INVALID`.

## 2. Auth & Cookies

- JWT signed HS256, secret `process.env.AUTH_SECRET`, payload `{ sub: userId, role }`, 7d. **AUTH_SECRET is required in production** (min 32 chars); a dev-only fallback is used when `NODE_ENV !== 'production'`, and signing/verifying throws in production if it is missing or too short.
- Cookie: `ticketbd_token`, httpOnly, path '/', sameSite 'lax', maxAge 7d, **`secure` in production** (off elsewhere so http://localhost works). Set via the shared `sessionCookieOptions(maxAge?)` helper in `@/lib/auth` so login/register/logout cannot drift apart. Set via `NextResponse` cookies API: `const res = NextResponse.json(...); res.cookies.set('ticketbd_token', token, {...})`.
- `getAuthUser()` (from `@/lib/auth`, server-only) returns full User row or null (reads cookie via `cookies()` from next/headers — must `await cookies()`).
- Suspended users cannot log in: return 403 `{ error: 'Your account has been suspended' }`.

## 3. Prisma Schema (already created by orchestrator — do not edit)

```prisma
model User { id, name, email @unique, phone?, password, role default CUSTOMER, status default ACTIVE, resetCode?, resetCodeExpiry?, createdAt, updatedAt, createdByOrganizerId?, organizer Organizer?, createdStaff User[] (relation "CreatedStaff"), staffAssignments StaffAssignment[], orders Order[], tickets Ticket[], checkedInTickets Ticket[] (relation "CheckedInBy") }
model Organizer { id, userId @unique, user, organizationName, phone?, status default PENDING, createdAt, events Event[], createdStaff User[] }
model Event { id, organizerId, organizer, title, description, category, banner?, startDate DateTime, endDate DateTime, startTime String, endTime String, venue, address, city, mapUrl?, status default DRAFT, featured Boolean default false, createdAt, updatedAt, ticketTypes TicketType[], orders Order[], tickets Ticket[], staffAssignments StaffAssignment[] }
model TicketType { id, eventId, event (cascade), name, description?, price Float, totalQuantity Int, soldQuantity Int default 0, maxPerOrder Int default 5, salesStart DateTime?, salesEnd DateTime?, createdAt, tickets Ticket[] }
model Order { id, orderNumber @unique, userId, user, eventId, event, subtotal Float, platformFee Float, totalAmount Float, paymentStatus default PENDING, status default CREATED, attendeeName?, attendeeEmail?, attendeePhone?, createdAt, tickets Ticket[], payments Payment[] }
model Ticket { id, orderId, order, eventId, event, ticketTypeId, ticketType, userId, user, attendeeName, ticketCode @unique, qrToken @unique, status default ACTIVE, checkedInAt?, checkedInById? (User relation "CheckedInBy"), createdAt }
model Payment { id, orderId, order, amount Float, provider default "SSLCOMMERZ", method?, transactionId?, status default PENDING, paidAt?, createdAt }
model StaffAssignment { id, userId, user, eventId, event, createdAt, @@unique([userId, eventId]) }
```

## 4. API Endpoints (exact shapes)

### Auth
- `POST /api/auth/register` body `{ name, email, phone, password, accountType: 'CUSTOMER'|'ORGANIZER', organizationName? }`
  - Creates user. If ORGANIZER → also creates Organizer(status PENDING, organizationName required).
  - Email unique → 409 `{ error: 'An account with this email already exists' }`.
  - Auto-login (set cookie). Returns `{ user }` (SafeUser: id, name, email, phone, role, status, createdAt, organizer?: {id, organizationName, status}).
- `POST /api/auth/login` body `{ email, password }` → `{ user }` (+ sets cookie). 401 on bad credentials.
- `POST /api/auth/logout` → `{ ok: true }` (clears cookie).
- `GET /api/auth/me` → `{ user }` with `organizer` included when role=ORGANIZER, and `staffAssignments: { eventId, event: { id, title, status, startDate } }[]` when role=EVENT_STAFF. `{ user: null }` when no session (200, not 401).
- `PUT /api/auth/profile` body `{ name?, phone?, currentPassword?, newPassword? }` → `{ user }`. If newPassword provided, currentPassword required & verified (400 otherwise).
- `POST /api/auth/forgot` body `{ email }` → generates 6-digit code, stores on user (resetCode, resetCodeExpiry +10min). Always 200 with an identical shape (no account enumeration). Returns `{ ok: true, resetCode }` **only in demo mode**; otherwise `{ ok: true }` with the code withheld. Demo mode = non-production, or `DEMO_PASSWORD_RESET=true`; `DEMO_PASSWORD_RESET=false` forces it off. In production the code needs a real email/SMS delivery step (not yet wired up) — echoing it to the caller would let anyone reset any account.
- `POST /api/auth/reset` body `{ email, code, newPassword }` → validates code+expiry, updates password, clears code → `{ ok: true }` or 400.

### Events (public)
- `GET /api/events?search=&category=&city=&sort=upcoming|popular&featured=true`
  - Status `PUBLISHED` **or `ONGOING`** (a live event is still on sale), and only events whose `endDate` has not passed — ended events drop out of the listing without needing to be marked COMPLETED. search matches title/description (contains, insensitive).
  - sort=popular → order by total soldQuantity desc (aggregate ticketTypes soldQuantity sum).
  - Include: `ticketTypes` (all fields), `organizer: { include: { user: { select: { name } } } }`.
  - Response: `{ events: EventListItem[] }` where EventListItem = Event + ticketTypes[] + organizer { organizationName, user: { name } }.
- `GET /api/events/[id]`
  - Public: only PUBLISHED/ONGOING (others → 404 unless owner/admin — owner check: session user's organizerId matches).
  - Include organizer w/ user name + ticketTypes. Response `{ event }`.

### Orders & Payments
- `POST /api/orders` body `{ eventId, items: [{ ticketTypeId, quantity }], attendee: { name, email, phone } }`
  - Guards (400 with clear message): event exists & status PUBLISHED/ONGOING; per-type salesStart/salesEnd window; `quantity <= maxPerOrder`; `quantity <= totalQuantity - soldQuantity`; attendee fields present.
  - Creates Order (orderNumber `ORD-` + year + `-` + 6 random digits, subtotal, platformFee, totalAmount, **attendeeName/attendeeEmail/attendeePhone persisted from `attendee`**) + Payment(status PENDING, provider SSLCOMMERZ, amount totalAmount).
  - Response `{ order: { id, orderNumber, subtotal, platformFee, totalAmount, eventId } }` (201).
- `GET /api/orders/mine` → `{ orders: OrderWithDetails[] }` — own orders, desc by createdAt. Include event (with venue, city, banner, startDate, endDate, startTime, endTime, title), tickets[] (id, ticketCode, qrToken, attendeeName, status, checkedInAt, ticketType: { name, price }), payments[0]. 
- `GET /api/orders/[id]` → `{ order }` same include shape (owner or admin only, else 403). Used as server-side payment verification.
- `POST /api/payments/execute` body `{ orderId, method: 'bKash'|'Nagad'|'CARD', outcome?: 'SUCCESS'|'FAILED' }` (outcome defaults SUCCESS). This endpoint simulates the SSLCOMMERZ gateway completing AND the IPN hitting our backend — it performs ALL server-side verification. Steps:
  1. Load order + payment. If payment.status === 'PAID' → idempotent: return `{ status: 'PAID', orderId }`.
  2. outcome FAILED → payment status FAILED, order paymentStatus FAILED → `{ status: 'FAILED' }`.
  3. SUCCESS → `db.$transaction`: claim inventory per item with a single conditional `UPDATE "TicketType" SET soldQuantity = soldQuantity + n WHERE id = ? AND eventId = ? AND soldQuantity + n <= totalQuantity` (checking and incrementing atomically so concurrent payments cannot oversell). 0 affected rows → throw, rolling the transaction back, then mark payment/order FAILED in a separate write and return `{ status: 'FAILED', error: 'Insufficient tickets' }`; otherwise create tickets.
  4. transactionId = `SSL` + timestamp + 4 random digits. payment → PAID + method + transactionId + paidAt. order → paymentStatus PAID.
  5. Ticket creation: ticketCode = `EVT-${year}-${6-digit zero-padded unique number}` (loop: pick random 1..999999, check uniqueness, retry), qrToken = `qr_` + 24 hex chars (crypto.randomBytes), attendeeName from `order.attendeeName` (falling back to the buyer's name for legacy orders).
  - Response `{ status: 'PAID'|'FAILED', orderId, error?: string }`.
- ~~`GET /api/payments/status?orderId=`~~ — **removed.** The simulated gateway awaits `/api/payments/execute` directly, so nothing ever polled it. Re-add it if a real gateway redirect/IPN flow needs polling.

### Upload
- `POST /api/upload` body `{ dataUrl: string }` (image data URL, client-side compressed). **Requires role ORGANIZER or SUPER_ADMIN.** Validates startsWith('data:image/'), decoded size < 1.5MB, mime in jpeg/png/webp. Writes decoded buffer to `public/uploads/upl_${Date.now()}_${rand4}.${ext}`. Response `{ url: '/uploads/upl_xxx.jpg' }`. Creates `public/uploads` if missing (fs.mkdir recursive). Returns 503 with an actionable message on read-only/serverless filesystems (e.g. Vercel), where runtime-written files are not served.

### Organizer (all require role ORGANIZER; Organizer row must be status APPROVED except for GET endpoints which work but frontend shows pending banner)
- `GET /api/organizer/stats` → `{ stats: { totalEvents, activeEvents (PUBLISHED|ONGOING), ticketsSold (sum soldQuantity), revenue (sum totalAmount where paymentStatus PAID), checkIns (count tickets CHECKED_IN), pendingApprovals? } }`
- `GET /api/organizer/events` → `{ events: [...] }` own events, desc createdAt, include ticketTypes + _count orders? (use ticketTypes soldQuantity for sold count).
- `POST /api/organizer/events` body `{ title, description, category, banner?, startDate, endDate, startTime, endTime, venue, address, city, mapUrl?, submit?: boolean, ticketTypes: [{ name, description?, price, totalQuantity, maxPerOrder, salesStart?, salesEnd? }] }`
  - status = submit ? 'PENDING_APPROVAL' : 'DRAFT'. Validate ≥1 ticket type, required fields. Nested create ticketTypes. Response 201 `{ event }`.
- `PUT /api/organizer/events/[id]` same body (partial ok). Owner check else 404/403. If body.status in ['ONGOING','COMPLETED','CANCELLED'] → allow direct transition (mark completed/cancelled). If CANCELLED → also cancel event's ACTIVE tickets (documented behavior: refunds are out of MVP scope).
- `DELETE /api/organizer/events/[id]` — allowed only if no orders exist (else 409 `{ error: 'Cannot delete an event with orders. Cancel it instead.' }`).
- `POST /api/organizer/events/[id]/submit` → status PENDING_APPROVAL (only from DRAFT/REJECTED).
- `POST /api/organizer/events/[id]/cancel` → status CANCELLED + cancel ACTIVE tickets.
- `GET /api/organizer/events/[id]/analytics` → `{ analytics: { event: {...}, totalTickets (sum totalQuantity), sold, available, revenue (PAID orders total), checkIns, notArrived, recentOrders: [{ id, orderNumber, totalAmount, paymentStatus, createdAt, user: { name }, tickets: _count }], ticketTypeBreakdown: [{ id, name, price, totalQuantity, soldQuantity, revenue }] } }`
- `POST /api/organizer/events/[id]/ticket-types` body `{ name, description?, price, totalQuantity, maxPerOrder, salesStart?, salesEnd? }` → 201 `{ ticketType }`.
- `PUT /api/organizer/ticket-types/[id]` (owner) → update name/description/price/totalQuantity/maxPerOrder/salesStart/salesEnd. totalQuantity cannot go below soldQuantity (400).
- `DELETE /api/organizer/ticket-types/[id]` — only if soldQuantity === 0 (else 409).
- `GET /api/organizer/staff` → `{ staff: [{ id, name, email, phone, status, createdAt, staffAssignments: { include: { event: { select: { id, title } } } } }] }` — users where createdByOrganizerId = current organizer id.
- `POST /api/organizer/staff` body `{ name, email, phone, password, eventIds: string[] }` → creates User(role EVENT_STAFF, createdByOrganizerId) + StaffAssignment rows. 409 if email taken. 201 `{ staff }`.
- `PUT /api/organizer/staff/[id]` body `{ eventIds: string[], status? }` (staff must belong to organizer) → replace assignments; optional status ACTIVE/SUSPENDED.
- `DELETE /api/organizer/staff/[id]` → delete user (and assignments cascade).

### Admin (require SUPER_ADMIN)
- `GET /api/admin/stats` → `{ stats: { totalUsers, totalCustomers, totalOrganizers, totalStaff, totalEvents, publishedEvents, pendingEvents, totalOrders, paidOrders, totalRevenue, totalTicketsSold, totalCheckIns } }`
- `GET /api/admin/users?role=&q=` → `{ users: [...] }` include organizer (when ORGANIZER). desc createdAt. q filters name/email contains.
- `PUT /api/admin/users/[id]` body `{ status: 'ACTIVE'|'SUSPENDED' }` → `{ user }`. Cannot suspend self (400); **cannot suspend any SUPER_ADMIN (403)** so admins cannot lock each other out.
- `GET /api/admin/organizers?status=` → `{ organizers: [{ ...Organizer, user: { id, name, email, phone, status }, eventCount }] }` desc createdAt.
- `PUT /api/admin/organizers/[id]` body `{ status: 'APPROVED'|'REJECTED'|'PENDING' }` → `{ organizer }`.
- `GET /api/admin/events?status=&q=` → `{ events: [...] }` include organizer { organizationName, user: { name } } + ticketTypes.
- `PUT /api/admin/events/[id]` body `{ action: 'approve'|'reject'|'suspend'|'feature'|'unfeature' }`
  - approve → status PUBLISHED; reject → REJECTED; suspend → SUSPENDED; feature/unfeature → featured true/false (no status change).
  - Also allow body `{ action: 'restore' }` → back to PUBLISHED. Response `{ event }`.
  - **Transitions are guarded by current status** (400 otherwise), matching what the dashboard offers: approve from PENDING_APPROVAL/REJECTED/SUSPENDED, reject from PENDING_APPROVAL, suspend from PUBLISHED/ONGOING, restore from SUSPENDED. feature/unfeature are allowed from any status.

### Staff (require EVENT_STAFF)
- `GET /api/staff/assignments` → `{ assignments: [{ id, event: { id, title, venue, city, banner, startDate, startTime, status, ticketTypes: { select: { totalQuantity, soldQuantity } } }, checkedInCount, totalTickets }] }` for this user.
- `POST /api/staff/validate` body `{ code }` (qrToken OR ticketCode, trimmed). Must be assigned to ticket's event (else `{ result: 'NOT_ASSIGNED' }` 200). Find ticket include event + ticketType + user + order.
  - Response 200 `{ result: 'VALID'|'ALREADY_CHECKED_IN'|'CANCELLED'|'INVALID'|'NOT_ASSIGNED', ticket?: {...} }`. ticket includes: id, ticketCode, attendeeName, status, checkedInAt, ticketType { name, price }, event { id, title, startDate, startTime, venue }, user { name }, order { orderNumber }.
  - INVALID cases: not found (no ticket row info), ticket.eventId not in assignments.
- `POST /api/staff/checkin` body `{ ticketId }` → verify assignment + ticket ACTIVE. If already CHECKED_IN → 409 `{ error: 'ALREADY_CHECKED_IN', checkedInAt }`. Success: status CHECKED_IN, checkedInAt now, checkedInById = staff user id → `{ ticket }` (updated). 
- `GET /api/staff/events/[id]/checkins` → `{ checkIns: [{ id, ticketCode, attendeeName, checkedInAt, ticketType: { name }, user: { name } }] }` desc checkedInAt, limit 50. 403 if not assigned.

## 5. Frontend Contract

### Zustand store — `@/lib/store` (already written, do not recreate)
```ts
type View =
  | { name: 'home' }
  | { name: 'event-detail'; eventId: string }
  | { name: 'checkout'; eventId: string }
  | { name: 'payment'; orderId: string }
  | { name: 'payment-success'; orderId: string }
  | { name: 'my-tickets'; tab?: 'upcoming'|'past'|'cancelled' }
  | { name: 'ticket-detail'; ticketId: string }
  | { name: 'organizer'; tab?: 'overview'|'events'|'staff' }
  | { name: 'admin'; tab?: 'overview'|'organizers'|'events'|'users' }
  | { name: 'staff' }

useAppStore: { user: SafeUser|null, authLoaded: boolean, view: View, authOpen: boolean, authMode: 'login'|'register',
  profileOpen: boolean,
  setUser, navigate(view), openAuth(mode?), setAuthOpen(open), setProfileOpen(open), logout() }
```
Auth and profile are **overlays, not views**: they layer over whatever page is
mounted, so dismissing one returns you there. `navigate()` closes both.

### Shared components — `@/components/app/*` (already written)
- `EventCard({ event: EventListItem, onSelect?: (id) => void })` — banner, date badge, category chip, title, venue/city, "From ৳X", sold progress. Clicking navigates to event-detail (or calls onSelect).
- `EmptyState({ icon, title, description, action? })`.
- Helpers: `formatBDT(n)` → `৳1,500`; `formatEventDate(iso)` → `Fri, 20 Feb 2026`; `formatTime('18:00')` → `6:00 PM`; `daysUntil(startIso, endIso?)` → `3 days left` / `Happening now` (when between start and end) / `Ended`; `categoryIcon(cat)`, `categoryLabel(cat)`, `statusBadgeVariant`, from `@/lib/format` & `@/lib/constants`.

### Shared types — `@/lib/types` (already written): EventListItem, EventDetail, TicketTypeDTO, OrderDTO, TicketDTO, SafeUser, OrganizerProfile, StaffAssignmentDTO, AdminStats, OrganizerStats, etc.

### UI Guidelines
- All components 'use client'. Use TanStack Query (`useQuery`, `useMutation` + `queryClient.invalidateQueries`).
- Toasts: `import { toast } from 'sonner'`.
- shadcn/ui: Button, Card, Input, Label, Select, Tabs, Dialog, Badge, Table, Textarea, Switch, Progress, Separator, Avatar, DropdownMenu, AlertDialog, Checkbox, Skeleton, ScrollArea.
- Responsive: mobile-first grids (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3/4`), tables wrapped in `overflow-x-auto`.
- Long lists: `max-h-96 overflow-y-auto` + `scrollbar` styling.
- Currency always `formatBDT`. NO indigo/blue. Primary = green (already themed).
- Loading: skeletons/spinners; never leave a blank screen. Buttons show loading state (disabled + spinner text like "Processing...").
- Images: plain `<img>` tags (no next/image optimization issues with uploads), `object-cover`, alt text required.

## 6. Seeded Accounts
Passwords are **not** hardcoded and are not documented here. `prisma/seed.ts`
reads `SEED_ADMIN_PASSWORD` and `SEED_DEMO_PASSWORD`, or generates a random
password per run and prints it once on completion.

- admin@ticketbd.com (SUPER_ADMIN) — uses `SEED_ADMIN_PASSWORD`
- organizer@ticketbd.com (ORGANIZER, APPROVED — "SoundWave Entertainment")
- customer@ticketbd.com (CUSTOMER — "Jubair Hossain")
- staff@ticketbd.com (EVENT_STAFF — assigned to seeded events)

The three non-admin accounts share `SEED_DEMO_PASSWORD`. The login dialog does
not offer quick-login buttons: shipping credentials to the browser would give
every visitor an admin session.

## 7. Refund Engine

Domain rules and arithmetic: `src/lib/refunds.ts` (pure, no db).
Transactional state machine: `src/lib/refund-service.ts`.
Gateway adapter: `src/lib/refund-gateway.ts`.
Tables: `Refund`, `RefundItem`, `RefundAuditLog`, plus `Ticket.refundLockId`,
`Order.refundedMinor`, `Payment.refundedMinor`.

### 7.1 The rule that shapes the API

**No endpoint accepts an amount.** A refund is a *set of tickets*; the server
prices them from the stored `TicketType.priceMinor` and the policy table. A
partial refund is `ticketIds: [...]`, never `amount: 1500`. A body carrying
`amount` or `amountMinor` is rejected with 400 `REFUND_AMOUNT_NOT_ACCEPTED`
rather than ignored, so a client written against the wrong assumption fails
loudly instead of quietly being given a different number.

Customers also cannot choose a reason code — they always file
`CUSTOMER_REQUEST`. Being able to name `EVENT_CANCELLED` would let them select
the 100% policy for themselves.

### 7.2 States

`REQUESTED → APPROVED → PROCESSING → COMPLETED`, with `→ REJECTED` from
REQUESTED/APPROVED/FAILED and `PROCESSING → FAILED`.

`FAILED` is **not** terminal: it retries to `PROCESSING` on the original
idempotency key (so a refund the gateway actually completed before timing out
cannot be paid twice), or is abandoned to `REJECTED`, which releases its
tickets. `COMPLETED` is the stored terminal success state, matching the
`Refund_status_valid` CHECK constraint and `RefundStatus` in `@/lib/types`.

Every transition is a compare-and-swap (`updateMany({ where: { id, status } })`
with the row count checked), so a gateway webhook and an operator racing each
other cannot both apply the same settlement.

### 7.3 Policy

| Situation | Ticket value | Platform fee | Retained |
|---|---|---|---|
| Event CANCELLED (any reason code) | 100% | returned | — |
| Any non-`CUSTOMER_REQUEST` reason | 100% | returned | — |
| `CUSTOMER_REQUEST`, 7+ days out | 100% | kept | 2% |
| `CUSTOMER_REQUEST`, 3–7 days | 50% | kept | 2% |
| `CUSTOMER_REQUEST`, 1–3 days | 25% | kept | 2% |
| `CUSTOMER_REQUEST`, under 24h | refused (409 `REFUND_WINDOW_CLOSED`) | | |

The event being CANCELLED is checked *first*, so a customer filing a plain
request against a dead event still gets 100% instead of a voluntary tier. The
applied rule is stored as `policyCode`, so changing this table cannot rewrite
what an old refund was owed.

`amountMinor = ticketFaceValueMinor + platformFeeRefundedMinor − processingFeeMinor`,
funded as `organizerShareMinor + platformShareMinor` (both ≥ 0, a CHECK
constraint). Totals are split across items with largest-remainder allocation, so
item rows always sum to the refund exactly — no paisa is lost to rounding, and
the `REFUND_COMPLETED` ledger group always balances.

### 7.4 Endpoints

Customer:
- `GET /api/orders/[id]/refund?ticketIds=a,b` → `{ quote }` — server-computed
  preview. Runs the same `planRefund` the write path runs, so the figure shown
  is the figure written.
- `POST /api/orders/[id]/refund` body `{ ticketIds?, note? }` → 201 `{ refund }`.
  Lands in REQUESTED. Rate limited (5/user, 20/IP per 10 min) because filing one
  claims tickets.
- `GET /api/refunds/mine` → `{ refunds }`.
- `GET /api/refunds/[id]` → `{ refund }`. A SUPER_ADMIN gets the full record; the
  owner gets status, money and a plain-language timeline; anyone else gets 404
  (not 403) so ids are not enumerable.

Admin (SUPER_ADMIN):
- `GET /api/admin/refunds?status=&type=&eventId=&batchId=&q=` →
  `{ refunds, counts, totals, owed, owedOutstandingMinor }`. `owed` is paid
  orders on cancelled events with no live refund — money owed that nothing is
  working on.
- `POST /api/admin/refunds` body `{ orderId, ticketIds?, reasonCode, note?, hold?, submit? }`
  → 201 `{ refund, gatewayMessage }`. Approved on creation (the admin issuing it
  *is* the approval); `hold: true` leaves it REQUESTED for a second pair of eyes.
  `submit: true` also sends it to the gateway in the same request.
- `PATCH /api/admin/refunds/[id]` body `{ action: 'approve'|'reject'|'process'|'retry', note?, rejectionReason? }`
  → `{ refund, outcome?, message? }`. `reject` requires a reason and releases the
  tickets.
- `POST /api/admin/refunds/process` body `{ limit?, batchId? }` → `{ summary }`.
  Drains APPROVED refunds oldest-first, up to `limit` (default 25, max 100).
  Bounded so a mass cancellation cannot time out mid-payout; call again while
  `summary.remaining > 0`. One failure does not abort the run.
- `POST /api/admin/events/[id]/cancel` body `{ note?, limit? }` → `{ summary }`.

Event cancellation:
- `POST /api/organizer/events/[id]/cancel` and the admin route above cancel the
  event, void live tickets, and file a full refund for every order still owed
  money under one `batchId`. Refunds are created APPROVED but **not** paid here —
  drain them with `/api/admin/refunds/process`. Both are safe to re-run: orders
  whose tickets a refund already claimed are skipped, which is also how a batch
  interrupted by `hasMore` is continued.

Gateway callback:
- `POST /api/payments/refund-webhook` body `{ gatewayRefundId, status: 'SETTLED'|'FAILED', message? }`,
  header `x-refund-signature: <hex>` = `HMAC-SHA256(REFUND_WEBHOOK_SECRET, rawBody)`.
  The HMAC is computed over the raw bytes and compared timing-safely; an
  unsigned call gets 401 and is never parsed. Idempotent — a replay returns
  `changed: false` and is still recorded in the audit trail.

### 7.5 Concurrency and integrity

- **Ticket claims.** `Ticket.refundLockId` is taken with a conditional
  `UPDATE ... WHERE "refundLockId" IS NULL` and the affected-row count checked,
  so two operators cannot refund the same ticket — the technique
  `/api/payments/execute` uses against overselling. Released only on rejection.
- **The gateway is never called inside a transaction.** Rolling back after money
  moved would leave the database claiming the refund never happened.
- **Settlement is one transaction**: refund → COMPLETED, `Order.refundedMinor`
  and `Payment.refundedMinor` incremented (then re-read to decide
  REFUNDED vs PARTIALLY_REFUNDED), tickets → REFUNDED, seats returned to
  inventory for events that can still sell, and the balanced
  `REFUND_COMPLETED` ledger group posted. All of it commits together.
- **Audit trail.** `RefundAuditLog` is append-only and records every state edge
  and gateway exchange with the operator, their role and IP, the amount in play
  and a JSON metadata blob. Customers see a filtered, plain-language subset.

### 7.6 Environment

- `REFUND_WEBHOOK_SECRET` — **required in production** (min 32 chars), like
  `AUTH_SECRET`. Without it, anyone could mark refunds settled. A development
  fallback is used when `NODE_ENV !== 'production'`.
- `REFUND_GATEWAY_MODE` — `settle` (default, settles inline), `async` (accepts,
  then waits for the webhook), `fail` (retryable), `decline` (permanent). Lets
  the whole state machine be exercised without a live gateway.
