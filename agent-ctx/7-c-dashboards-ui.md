# Task 7-c — Dashboards UI (Organizer, Admin, Staff Scanner)

Agent: full-stack-developer (Agent 7-c)
Status: COMPLETE — 0 TS errors in scope, page serves 200

## Files created
| File | Exports | Purpose |
|---|---|---|
| src/components/organizer/organizer-dashboard.tsx | `OrganizerDashboard({initialTab?})`, `EventStatusBadge`, `PaymentStatusBadge` | Shell (org header, PENDING/REJECTED alerts, tabs→navigate) + shared status badges |
| src/components/organizer/overview.tsx | `Overview` | 5 stat cards (organizer-stats) + quick actions + activity hint |
| src/components/organizer/events-manager.tsx | `EventsManager` | Events table, status filter chips w/ counts, all lifecycle actions |
| src/components/organizer/event-form.tsx | `EventForm({editing,open,onOpenChange,onSaved?})` | Create/edit dialog: fields, banner (presets/upload-compress/URL), ticket-type rows |
| src/components/organizer/event-analytics.tsx | `EventAnalytics({eventId,onClose})` | Analytics dialog: tiles, check-in progress, breakdown + type CRUD, recent orders |
| src/components/organizer/staff-manager.tsx | `StaffManager` | Staff CRUD, status toggle, event assignment checkboxes |
| src/components/admin/admin-dashboard.tsx | `AdminDashboard({initialTab?})` | 4 tabs inline: overview (12 stats), organizers approval, events moderation, users |
| src/components/staff/staff-scanner.tsx | `StaffScanner` | 2-step QR check-in: event pick → camera/manual scan, validate/checkin, live stats |

## Key decisions
- Badge helpers live once in organizer-dashboard.tsx; admin + analytics import them (spec-sanctioned).
- Edit-mode ticket types: existing rows read-only; new rows POSTed individually after PUT; full type management (edit/delete/add) in Analytics dialog.
- Camera scan default tab is Manual (works without HTTPS); html5-qrcode dynamically imported only when camera tab active; scanner stops on successful read with Start/Scan-Next/Stop controls.
- Delete-event shown always; server 409 message toasted (server enforces "no orders" rule).
- Debounced (300 ms) search for admin events/users to avoid per-keystroke refetch.

## Contract notes for other agents
- Invalidate keys used: `['organizer-events']`, `['organizer-stats']`, `['analytics', eventId]`, `['admin-stats']`, `['admin-organizers']`, `['admin-events']`, `['admin-users']`, `['staff-assignments']`, `['checkins', eventId]`.
- Assumes API shapes exactly per docs/api-contract.md §4 (admin approve = `PUT /api/admin/events/[id] {action}`, staff validate/checkin per spec incl. 409 `{error:'ALREADY_CHECKED_IN', checkedInAt}`).
- If agent 7-a names admin action differently (e.g. body `{action:'approve'}`), already aligned.

## Verification
- `bunx tsc --noEmit | grep -E "src/components/(organizer|admin|staff)"` → empty (no errors in scope).
- `curl http://localhost:3000/` → 200 twice; latest dev.log shows `✓ Compiled` (older module-not-found lines were stale, pre-file-creation).
