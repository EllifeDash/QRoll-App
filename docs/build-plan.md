# Build Plan

Living tracker for implementing the attendance QR system. Statuses: `pending` → `in_progress` → `done`. Timestamps in local time `YYYY-MM-DD HH:MM`.

## Phase 0 — Scaffold & config

| # | Task | Status | Started | Finished | Done when |
|---|---|---|---|---|---|
| 0.1 | `create-next-app` (TS, App Router, no Tailwind extras needed) | done | 2026-07-31 16:26 | 2026-07-31 16:33 | `npm run dev` serves a page (Next.js 16.2.12) |
| 0.2 | Add deps: `@libsql/client`, `drizzle-orm`, `drizzle-kit`, `qrcode`, `@types/qrcode` | done | 2026-07-31 16:33 | 2026-07-31 16:35 | imports resolve, build passes |
| 0.3 | `.env` + `.env.example` (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, HMAC_SECRET, ADMIN_PASSWORD, APP_URL) | done | 2026-07-31 16:36 | 2026-07-31 16:37 | file exists with placeholders; git-ignored `.env` (`.env*` ignored, `!.env.example` committed) |
| 0.4 | Turso DB created + URL/token in env | done | 2026-07-31 16:38 | 2026-08-01 | DB exists; client connects from script. **Note**: Turso CLI has no Windows build + installer host DNS-blocked on this network → using REST API with user API token instead |
| 0.5 | Drizzle config + `drizzle.config.ts` wired to Turso | done | 2026-07-31 16:40 | 2026-07-31 16:41 | `drizzle-kit generate` produced `drizzle/0000_red_namora.sql` (4 tables) |

## Phase 1 — Schema & seed

| # | Task | Status | Started | Finished | Done when |
|---|---|---|---|---|---|
| 1.1 | Schema: `stations`, `staff`, `shifts`, `attendance_log` per `docs/schema.md` | done | 2026-08-01 | 2026-08-01 | tables exist in Turso after `db:push` |
| 1.2 | Unique constraint `(staff_id, shift_id, log_date)` | done | 2026-08-01 | 2026-08-01 | duplicate insert throws; single insert works |
| 1.3 | Indexes: `(station_id, log_date)`, `(staff_id, log_date)`, `staff(station_id)` | done | 2026-08-01 | 2026-08-01 | present in `turso db shell` `PRAGMA index_list` |
| 1.4 | Seed script: 11 stations (s01–s11, random PINs), Day 09:00 + Evening 17:00 shifts, placeholder staff | done | 2026-08-01 | 2026-08-01 | `npm run db:seed` idempotent; re-run doesn't duplicate |
| 1.5 | Window helper unit test: on_time / late / outside-window for sample times | done | 2026-08-01 | 2026-08-01 | test passes with mocked clock |

## Phase 2 — Token & scan API

| # | Task | Status | Started | Finished | Done when |
|---|---|---|---|---|---|
| 2.1 | HMAC sign/verify module (`payload {s, sh, exp}`) | done | 2026-08-01 | 2026-08-01 | sign→verify roundtrip test passes; tampered token rejected |
| 2.2 | `POST /api/token` — PIN check, active-window check, heartbeat update (throttled) | done | 2026-08-01 | 2026-08-01 | curl returns token+shift or `isActive:false`; bad PIN → 401 |
| 2.3 | `POST /api/scan` — verify token, station↔staff match, status calc, insert, dedupe | done | 2026-08-01 | 2026-08-01 | curl: on_time, late, expired, wrong-station, already-marked all return per `api.md` |
| 2.4 | Error contract matches `docs/api.md` exactly | done | 2026-08-01 | 2026-08-01 | live-tested all 8 error cases + happy path (duplicate found via `err.cause.code === "SQLITE_CONSTRAINT"` in drizzle) |

## Phase 3 — Kiosk page

| # | Task | Status | Started | Finished | Done when |
|---|---|---|---|---|---|
| 3.1 | `/kiosk/:stationId` — PIN gate (localStorage), 30s poll, QR render, countdown | done | 2026-08-01 | 2026-08-01 | live QR refreshes every 30s in browser; PIN remembered on reload |
| 3.2 | OFFline state after 2 failed polls | done | 2026-08-01 | 2026-08-01 | stop DevTools network → OFFLINE banner appears |
| 3.3 | Out-of-window state: "Next QR at 08:15" countdown | done | 2026-08-01 | 2026-08-01 | visible outside 08:15–09:30/16:15–17:30 |
| 3.4 | Scan-confirmation toast on kiosk (optional live indicator of scans) | done | 2026-08-01 | 2026-08-01 | scans today counter + toast on count increase (`scanCountToday` added to `/api/token`) |

## Phase 4 — Scan page (phone)

| # | Task | Status | Started | Finished | Done when |
|---|---|---|---|---|---|
| 4.1 | `/scan?t=…` — token validation → station/shift/clock display | done | 2026-08-01 | 2026-08-01 | `GET /api/scan/info` added; invalid QR / expired token / window closed render friendly screens (live-verified) |
| 4.2 | Staff picker (dropdown, station-filtered) + localStorage identity | done | 2026-08-01 | 2026-08-01 | 2nd visit pre-fills Staff Two (`scan:identity:<station>`); pick → mark button enabled |
| 4.3 | Mark flow → success screen (time + on_time/late) | done | 2026-08-01 | 2026-08-01 | Staff Two → "Late 12:32:30" screen; row written to Turso (status `late`) |
| 4.4 | Duplicate screen: "Already marked at 12:32:30" | done | 2026-08-01 | 2026-08-01 | rescan same token+staff → 409 rendered gracefully with prior time |
| 4.5 | Mobile CSS check (400px viewport) | done | 2026-08-01 | 2026-08-01 | CDP override 400×800: no h-scroll, 16px margins, 54px button, 52px select |

## Phase 5 — Admin dashboard

| # | Task | Status | Started | Finished | Done when |
|---|---|---|---|---|---|
| 5.1 | Login page + signed cookie; lockout after 5 failures | pending | | | wrong password 6× → locked; correct → cookie set |
| 5.2 | `/api/admin/overview` + station tile grid (green/amber/red logic) | pending | | | 11 tiles with correct colors for live/offline/no-scan states |
| 5.3 | Logs table with filters (station/shift/date/status) | pending | | | filters return correct subsets |
| 5.4 | CSV export | pending | | | file downloads, opens in Excel |
| 5.5 | Staff CRUD UI | pending | | | add/edit/disable staff reflects in scan picker |
| 5.6 | Station CRUD UI (incl. PIN reset → kiosk re-prompt) | pending | | | PIN change forces re-entry on kiosk |
| 5.7 | Shift CRUD UI | pending | | | start_time edit applies to next window only |
| 5.8 | Manual mark + delete entries (source: manual, note) | pending | | | manual entry appears with `manual` source; delete removes |

## Phase 6 — E2E validation

| # | Task | Status | Started | Finished | Done when |
|---|---|---|---|---|---|
| 6.1 | Full walkthrough with 2 stations, 3 staff, both shifts (mocked clocks) | pending | | | all scenarios pass: on_time, late, duplicate, offline fallback, manual mark |
| 6.2 | Security checks: tampered token, expired replay, wrong-station staff, PIN brute force | pending | | | all rejected per `docs/api.md` |
| 6.3 | Deploy to Vercel; env vars set; production smoke test | pending | | | live URL kiosk/scan/admin work from phone + PC |
| 6.4 | Station PC setup procedure verified on one real machine (full-screen autostart) | pending | | | one station running as kiosk at 08:15–09:30 |
| 6.5 | Update README + operations runbook with any deviations | pending | | | docs match shipped behavior |

## Changelog

- `2026-07-31` — plan created per `docs/decisions.md` §1–9 and the Q&A locked earlier.
- `2026-08-01` — Phase 4 done: `/scan` page (Suspense + `useSearchParams`), `GET /api/scan/info`, staff picker with localStorage identity, success/duplicate/error screens, 400px mobile layout — all live-verified in headless Chrome against Turso.
