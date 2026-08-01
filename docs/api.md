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

All admin routes validate the session cookie (signed, HttpOnly, Secure, 7 days). Unauthorized → `401 { "error": "unauthorized" }`.

### `POST /api/admin/login`
```json
{ "password": "..." }
```
→ `200 { "ok": true }` + sets cookie. Wrong password → `401 { "error": "invalid_password" }`. Brute-force: 5 attempts → 15 min lockout per IP (in-memory map; acceptable at this scale).

### `POST /api/admin/logout`
Clears cookie.

### `GET /api/admin/overview`
Live dashboard payload:
```json
{
  "stations": [
    {
      "id": "s03", "name": "Station 3 – North Gate",
      "heartbeatAgeSec": 40, "qrLive": true,
      "scanCountToday": 4, "lateCountToday": 1
    }
  ],
  "today": "2026-07-31",
  "shifts": [ { "id": 1, "name": "Day" } ]
}
```
`qrLive` = heartbeat fresh AND a shift window active. Admin derives tile color: red (heartbeat > 120s), amber (live, 0 scans), green (live, scans).

### `GET /api/admin/logs?stationId=&shiftId=&date=&status=`
Filtered attendance list + totals. Supports CSV via `?format=csv` (Content-Disposition attachment).

### `POST /api/admin/staff` · `PUT /api/admin/staff/:id` · `DELETE /api/admin/staff/:id`
Staff CRUD. Body: `{ stationId, name, isActive }`. Delete is hard delete; prefer `isActive: false` to preserve log FK integrity.

### `POST /api/admin/stations` · `PUT /api/admin/stations/:id`
Station CRUD. Body: `{ id?, name, secret?, isActive }`. Changing `secret` forces kiosk re-setup on that station.

### `GET /api/admin/shifts` · `POST /api/admin/shifts` · `PUT /api/admin/shifts/:id`
Shift CRUD. Body: `{ name, startTime, qrStartsMin, qrEndsMin, isActive }`. Edits apply from the next window; logs keep the shift snapshot via FK.

### `POST /api/admin/marks`
Manual correction (fallback for offline kiosk). Body:
```json
{ "staffId": 7, "shiftId": 1, "logDate": "2026-07-31", "scannedAt": 1782950471, "note": "kiosk offline" }
```
Same validation as `/api/scan` minus token; `source: "manual"`. Duplicate → `409` like above.

### `DELETE /api/admin/marks/:id`
Remove an erroneous entry (e.g. wrong person scanned). Last resort — no audit trail beyond `note` (acceptable at this scale).

## Token spec (internal)

```
payload = { s, sh, exp }   base64url(JSON)
token   = base64url(payload) + "." + base64url(HMAC-SHA256(payload, HMAC_SECRET))
```
- `exp = now + 60s`; kiosk refreshes every 30s so displayed QR is always fresh.
- `HMAC_SECRET` shared between token and scan routes (same app process).
