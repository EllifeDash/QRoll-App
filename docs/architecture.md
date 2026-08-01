# Architecture

## System overview

```
Station PC (kiosk)          Phone (staff)              Head office (admin)
┌──────────────────┐  scan  ┌──────────────┐    ┌──────────────────────────┐
│ Full-screen      │───────→│ /scan page   │    │ /admin dashboard         │
│ browser tab      │   QR   │ identity     │    │ live station grid, logs, │
│ polls /api/token │        │ picker + mark│    │ CSV export, CRUD         │
└────────┬─────────┘        └──────┬───────┘    └────────────┬─────────────┘
         │                         │                         │
         └───────── Next.js API routes (Vercel) ─────────────┘
                              │
                        Turso (SQLite)
```

## Components

### 1. Kiosk (station PC)

- Plain browser tab in full-screen mode (Chrome kiosk flag or F11) pointed at `/kiosk/:stationId`.
- First-time setup: enter the station PIN (from `stations.secret`) — stored in `localStorage`.
- **Poll loop**: every 30s, `POST /api/token` with station PIN → renders the returned QR via the `qrcode` library. Countdown shows seconds until refresh.
- **Offline state**: if polling fails twice, show `OFFLINE` banner and stop refreshing. Staff use the manual fallback (see `operations.md`).
- **Outside shift windows**: show "Next QR at 08:15" countdown instead of a QR.
- The kiosk renders *only* what the server signs. Its local clock is never used for validation.

### 2. Scan flow (staff phone)

1. Phone camera scans the on-screen QR → opens `/scan?t=<token>`.
2. Page calls `GET /api/scan/info` to validate the token and fetch the station's staff list (no writes).
3. Fresh visitors: pick their name from the station's staff list, then `POST /api/scan` with token + staff id. Identity is stored in `localStorage` → **next day is one tap**.
4. Confirmation screen: "Marked at 09:01 — On time ✓" or "09:14 — Late".
5. Duplicate attempt: "Already marked at 09:02:11" (rendered from the 409 response).

Identity via name-picker (no password) is acceptable because a valid token is only obtainable by being physically present at the station screen.

### 3. Admin dashboard (head office)

- Password login → signed cookie.
- **Live station grid**: one tile per station:
  - 🟢 green — QR live and station has scans today
  - 🟡 amber — QR live, no scans yet
  - 🔴 red — no heartbeat > 2 min (PC off / offline)
- Today's attendance table (filter by station/shift/status), CSV export.
- CRUD: stations, staff, shifts. Manual corrections (mark/delete entries) — the fallback for failed scans.

## Token design (stateless)

Format: `base64url(payload).base64url(hmac)` where

```
payload = { s: stationId, sh: shiftId, exp: unixSeconds }   // exp = now + 60
hmac    = HMAC-SHA256(payload, HMAC_SECRET)
```

- No token table → nothing to clean up, no DB hit on the kiosk poll path.
- Kiosk polling is pure edge compute: 1 HMAC sign per poll. The only DB write is the throttled heartbeat (1/min).

## Window logic

A shift window is: `[start_time - qr_starts_min, start_time + qr_ends_min]`, e.g. day shift 09:00 with `qr_starts_min=45, qr_ends_min=30` → QR live **08:15–09:30**.

- Scans before `start_time` → `on_time`.
- Scans after `start_time` (still inside window) → `late`.
- Scans outside any window → rejected.
- All window math uses **server time**.
- `log_date` = the date of the shift's `start_time` (evening shift crossing midnight logs to the shift-start date).

## Heartbeat & liveness

- Each kiosk token request updates `stations.last_heartbeat_at` (throttled to 1/min).
- Admin marks a station red when heartbeat is older than 2 min.
- The heartbeat itself is admin-visible telemetry: a station PC that is off at 09:00 is immediately visible.

## Deployment topology

- Single Vercel app serves all three surfaces (kiosk, scan, admin) — one deploy, one domain.
- Turso DB: one database, location ideally close to staff stations.
- Env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `HMAC_SECRET`, `ADMIN_PASSWORD`, `APP_URL`.

## Threat model

| Threat | Mitigation | Residual risk |
|---|---|---|
| Screenshot shared via chat | Token expires in 60s | Low (must be at screen to scan) |
| Photo of QR taken → used later | Expiry + rotation | None for same-day reuse |
| Station PC clock manipulated | Server signs tokens; PC never validates | None |
| Random person mints tokens | Station PIN required by kiosk | PIN known by station staff only |
| Colleague scans for absent colleague | Rotating QR (needs live screen); GPS check deliberately **not** added per decision | Medium — inherent to non-biometric systems |
| Staff scans wrong station's QR | Token bound to station; staff must belong to that station | None |
| Double-scan | `UNIQUE(staff_id, shift_id, log_date)` | None |
| Replay token within window | Same token could scan twice → second attempt marks a *different* staff if unused; add `token_used_at` table if replay abuse emerges | Low — see `api.md` note |
| Kiosk PC offline at shift start | Window opens 45 min early + admin manual-mark fallback | Low |

## Scale envelope

11 stations × up to ~10 staff → ~1,000 scans/day, ~22K scans/year, ~2,000 row reads/day. Turso free quota (5 GB / 500M reads / 10M writes per month) covers ~1,000× this. No scaling work foreseen.
