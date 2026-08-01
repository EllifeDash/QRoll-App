# API Specification

All routes are Next.js API routes on the same origin. JSON in/out. Times are unix seconds (UTC) unless noted.

## Public endpoints (no auth — the rotating token IS the credential)

### `POST /api/token`

Kiosk → server. Issues a signed QR token for the current active shift window.

**Request**
```json
{ "stationId": "s03", "pin": "4821" }
```

**Success 200**
```json
{
  "token": "eyJzIjoiczAzIiwi... .ZmlT9nAkPq8w0xKf1VjbHg",
  "expiresAt": 1782950400,
  "refreshInSec": 30,
  "stationName": "Station 3 – North Gate",
  "shift": { "id": 1, "name": "Day", "startTime": "09:00" },
  "isActive": true
}
```

**`isActive: false`** → no QR shown; kiosk displays "Next QR at HH:MM" using `nextWindowAt` (unix sec, or null if no shift is configured).

**`scanCountToday`** (both responses) → number of scans for this station so far today (kiosk counter/toast).

**Errors**
| Status | Body `error` | When |
|---|---|---|
| 401 | `invalid_station_or_pin` | bad station ID or PIN |
| 403 | `station_inactive` | station disabled |

**Side effects**: updates `last_heartbeat_at` (throttled to 1/min — the kiosk sends a heartbeat on every 2nd poll).

**Behavior**: the QR payload is shown **only while `start_time − qr_starts_min ≤ now ≤ start_time + qr_ends_min`** for an active shift (server time). Outside any window: `isActive: false`.

### `GET /api/scan/info?t=<token>`

Phone → server, before the mark flow. Validates the token and returns what the scan page needs to render (no DB writes).

**Success 200**
```json
{
  "stationId": "s03",
  "stationName": "Station 3 – North Gate",
  "shift": { "id": 1, "name": "Day", "startTime": "09:00" },
  "expiresAt": 1782950400,
  "staff": [ { "id": 7, "name": "Imran Khan" } ]
}
```
`staff` = active staff belonging to that station (drives the identity picker).

**Errors** (same contract as `/api/scan`): 400 `invalid_token` · 401 `token_expired` · 400 `no_active_shift`.

### `POST /api/scan`

Phone → server. Records attendance.

**Request**
```json
{ "token": "<token from QR>", "staffId": 7 }
```

**Success 200**
```json
{
  "status": "on_time",            // or "late"
  "scannedAt": 1782950471,
  "stationName": "Station 3 – North Gate",
  "shiftName": "Day",
  "staffName": "Imran Khan",
  "alreadyMarked": false
}
```

**Errors**
| Status | Body `error` | When |
|---|---|---|
| 400 | `invalid_token` | malformed or bad signature |
| 401 | `token_expired` | scanned after expiry |
| 400 | `no_active_shift` | token valid but window closed (race) |
| 403 | `staff_not_at_station` | staff belongs to a different station |
| 403 | `staff_inactive` | staff disabled |
| 409 | `already_marked` | unique constraint hit — duplicate scan. Response includes `{ scannedAt, status }` of the original entry |
| 400 | `staff_not_found` | unknown staffId |

**Flow inside**: verify signature → check expiry → resolve station+shift → verify staff belongs to station → insert with status derived from `now vs start_time` → return.

**Replay note**: a minted token is valid for 60s; two staff scanning the same token is legitimate (multi-staff station). An attacker replaying the *same* token+staffId within 60s hits the unique constraint → `already_marked`. If cross-staff replay abuse ever appears in practice, add a `token_used_at` table; not shipped because a live 60s token is only obtainable at the screen.

## Admin endpoints (require admin cookie)

All admin routes validate the session cookie `qroll_admin` (signed with HMAC_SECRET, HttpOnly, Secure in prod, SameSite=Lax, 7-day expiry). Unauthorized → `401 { "error": "unauthorized" }`.

### `POST /api/admin/login`
```json
{ "password": "..." }
```
→ `200 { "ok": true }` + sets cookie. Wrong password → `401 { "error": "invalid_password", "remaining": n }`. The 5th failure locks the IP → `429 { "error": "locked", "retryAfterSec": n }` for 15 min (in-memory map; acceptable at this scale).

### `POST /api/admin/logout`
Clears cookie.

### `GET /api/admin/session`
→ `200 { "authenticated": true | false }` (never 401 — used by the login gate).

### `GET /api/admin/overview`
Live dashboard payload:
```json
{
  "now": 1785570000,
  "qrLive": true,
  "liveWindow": { "shiftId": 6, "shiftName": "Day", "startTime": "09:00", "windowStart": 1785566100, "windowEnd": 1785570600 },
  "nextWindowAt": 1785582900,
  "stations": [
    {
      "id": "s03", "name": "Station 3 – North Gate",
      "isActive": true,
      "heartbeatAt": 1785569960, "heartbeatAgeSec": 40,
      "scansToday": 4, "staffCount": 2
    }
  ]
}
```
Admin derives tile color: **red** = station inactive, no heartbeat yet, or heartbeat > 120s · **green** = heartbeat fresh AND `qrLive` AND scans today > 0 · **amber** = otherwise. `nextWindowAt` is null when no shift is configured.

### `GET /api/admin/logs?station=&shift=&status=&date=&format=csv`
Filtered attendance list joined with station/staff/shift names, newest first, max 500 rows:
```json
{ "logs": [ { "id": 9, "stationId": "s03", "stationName": "...", "staffId": 7, "staffName": "...", "shiftId": 1, "shiftName": "Day", "logDate": "2026-07-31", "scannedAt": 1782950471, "status": "on_time", "source": "qr", "note": null } ], "total": 1, "maxRows": 500 }
```
`format=csv` returns `text/csv` attachment with the same filters applied.

### `GET /api/admin/staff` · `POST /api/admin/staff` · `PATCH /api/admin/staff/:id`
Staff CRUD. GET returns `{ staff: [{ id, stationId, stationName, name, isActive }] }` (active first). POST body `{ stationId, name }` → `201 { id }`. PATCH accepts `{ name?, stationId?, isActive? }`. Prefer `isActive: false` over deleting — logs keep the FK.

### `POST /api/admin/stations` · `PATCH /api/admin/stations/:id`
Station CRUD. POST body `{ id, name }` → `201 { id, pin }` (PIN auto-generated, 1000–9999); duplicate id → `409`. PATCH accepts `{ name?, isActive?, resetPin?: true }` — `resetPin` rotates `secret` and returns `{ id, pin }`; the kiosk then fails PIN auth and re-prompts (PIN gate is keyed to the stored PIN).

### `GET /api/admin/shifts` · `POST /api/admin/shifts` · `PATCH /api/admin/shifts/:id`
Shift CRUD. GET returns `{ shifts: [{ id, name, startTime, qrStartsMin, qrEndsMin, isActive }] }`. POST body `{ name, startTime "HH:MM", qrStartsMin, qrEndsMin, isActive? }` → `201 { id }`. PATCH accepts any subset. Edits apply from the next window; existing logs are unaffected.

### `POST /api/admin/marks`
Manual correction (fallback for offline kiosk). Body:
```json
{ "stationId": "s03", "staffId": 7, "shiftId": 1, "note": "kiosk offline" }
```
Uses server time: `scanned_at = now`, `status` derived from now vs `start_time`, `log_date` from shift start, `source: "manual"`. Duplicate (same staff+shift+date) → `409 { "error": "already_marked" }`.

### `DELETE /api/admin/marks/:id`
Remove an erroneous entry (e.g. wrong person scanned) → `200 { id }`; unknown id → `404`. Last resort — no audit trail beyond `note` (acceptable at this scale).

## Token spec (internal)

```
payload = { s, sh, exp }   base64url(JSON)
token   = base64url(payload) + "." + base64url(HMAC-SHA256(payload, HMAC_SECRET))
```
- `exp = now + 60s`; kiosk refreshes every 30s so displayed QR is always fresh.
- `HMAC_SECRET` shared between token and scan routes (same app process).
