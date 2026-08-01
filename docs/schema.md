# Data Model

Managed with Drizzle ORM. SQLite via Turso. All timestamps stored in UTC (`unix` or ISO strings); display in local time.

## Tables

### `stations`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | slug, e.g. `s01` |
| `name` | text | display name, e.g. "Station 3 – North Gate" |
| `secret` | text | kiosk PIN, set at setup; verified on `/api/token` |
| `last_heartbeat_at` | integer (unix) | updated by kiosk polling, throttled to 1/min |
| `is_active` | boolean | default true |

### `staff`

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK autoincrement | |
| `station_id` | text FK → `stations.id` | scan only valid if staff's station == token's station |
| `name` | text | shown in scan-page picker |
| `is_active` | boolean | default true; inactive staff can't scan |

### `shifts`

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK autoincrement | |
| `name` | text | e.g. "Day", "Evening" |
| `start_time` | text `"HH:MM"` 24h | e.g. `09:00`, `17:00` |
| `qr_starts_min` | integer | minutes before `start_time` QR appears, default 45 |
| `qr_ends_min` | integer | minutes after `start_time` QR disappears, default 30 |
| `is_active` | boolean | default true |

Schedule changes = admin UI edit. Two shifts ship by default: Day `09:00`, Evening `17:00`.

### `attendance_log`

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK autoincrement | |
| `station_id` | text FK → `stations.id` | denormalized for fast reporting |
| `staff_id` | integer FK → `staff.id` | |
| `shift_id` | integer FK → `shifts.id` | |
| `log_date` | text `"YYYY-MM-DD"` | date of shift `start_time` (evening shift → start date) |
| `scanned_at` | integer (unix) | server time at scan |
| `status` | text | `on_time` \| `late` |
| `source` | text | `qr` \| `manual` (admin correction) |
| `note` | text nullable | admin note for manual entries |

**Unique constraint**: `UNIQUE(staff_id, shift_id, log_date)` — blocks double-scanning; the constraint error is the dedupe mechanism.

## Indexes

- `attendance_log(station_id, log_date)` — dashboard "today per station" query
- `attendance_log(staff_id, log_date)` — per-staff history
- `staff(station_id)` — scan-page picker

## Seed data

`npm run db:seed` creates: 11 stations (`s01`–`s11`, PINs generated), the two default shifts, and a starter staff list (names provided by admin; seed ships with placeholder staff to be edited).
