# Operations Runbook

Day-to-day administration of the attendance system from head office.

## Env vars (Vercel + local `.env`)

| Var | Purpose |
|---|---|
| `TURSO_DATABASE_URL` | Turso DB URL (`libsql://…`) |
| `TURSO_AUTH_TOKEN` | Turso API token (read-write) |
| `HMAC_SECRET` | 32+ random chars; signs QR tokens + admin cookies. Rotating it invalidates all live QR tokens immediately |
| `ADMIN_PASSWORD` | admin login password (set via `openssl rand -base64 24` or similar) |
| `APP_URL` | public base URL, e.g. `https://att.example.com` — used in logs/links |

Timezone: **fixed in code** (`lib/clock.ts` → `Asia/Karachi`), so shift times are always Karachi wall-clock. No `TZ` env var is read — Vercel reserves the `TZ` name and runs Node in UTC, so don't add it there.

## Station setup (once per PC)

1. Open Chrome/Edge → navigate to `{APP_URL}/kiosk/<stationId>`.
2. Enter the station PIN (generated at seed; visible in admin → Stations).
3. Full-screen: Chrome → `F11`, or launch with `--kiosk --app={URL}`. Auto-start at boot: create a Startup shortcut or scheduled task; this is the **most reliable way** to guarantee the QR is showing at 08:15.
4. Keep the machine's power settings: never sleep/hibernate. If the station PC has no dedicated machine, set the tab to reopen on restart.

## Shift configuration

Admin → Shifts. Defaults:

| Shift | start_time | qr_starts_min | qr_ends_min | QR live |
|---|---|---|---|---|
| Day | 09:00 | 45 | 30 | 08:15–09:30 |
| Evening | 17:00 | 45 | 30 | 16:15–17:30 |

- Scan **before** start → `on_time`; scan **after** start → `late`.
- `qr_starts_min` is your tolerance for kiosk outages: with 45 min, a PC that crashes at 08:50 still has 10 min to recover before any impact.
- Schedule changes (e.g. shift moved to 10:00) = edit `start_time` in admin. Logs are unaffected; new rule applies from the next window.

## Reading the dashboard

| Tile | Meaning | Action |
|---|---|---|
| 🟢 green | QR live + scans recorded | none |
| 🟡 amber | QR live, no scans | wait until window closes; if still empty → call station |
| 🔴 red | no heartbeat > 2 min (PC off/offline) | call station to check PC; manual-mark if staff couldn't scan |

## Offline / failure procedures

### Kiosk offline at check-in time
1. Station staff call head office (or admin sees the red tile).
2. Admin opens `POST /api/admin/marks` flow (UI: Logs → Add manual entry) with `source: manual`, note `kiosk offline`.
3. Late vs on-time still applies from `scanned_at` they report (server time).

### Staff phone broken / no camera
Manual mark with note `phone issue`.

### Wrong scan (staff picked wrong name)
Admin deletes the erroneous entry (`DELETE /api/admin/marks/:id`) and adds a correct manual mark. The unique constraint applies to manual marks too — delete must come first.

### Staff transferred to another station
Admin → Staff → edit `station_id`. Old logs keep the old station (denormalized copy). From the next scan, token validation uses the new station.

## Data exports & retention

- CSV export per day/filter via `GET /api/admin/logs?format=csv` — usable in Excel/Sheets for payroll.
- Retention: logs are append-only by design; keep them (1 row/staff/day ≈ 22K rows/year at 11 stations × 5 staff — trivial for Turso).
- Backup: Turso free includes point-in-time restore (1 day) + `turso db dump` for manual backups. Weekly `turso db dump <db> > backup.sql` is a cheap habit.

## Monitoring you get for free

- Heartbeat = station PC liveness telemetry. A red tile at 08:50 *before* the window opens tells you to pre-empt.
- `late` counts per station surface punctuality patterns; export and compare weekly.

## Quota headroom (Turso free)

| Metric | App usage/mo (est.) | Free quota | Headroom |
|---|---|---|---|
| Reads | ~60K (kiosk polling hits only HMAC; DB reads are dashboard/logs) | 500M | ~8,000× |
| Writes | ~1.5K (scans + heartbeats 1/min × 11) | 10M | ~6,000× |
| Storage | < 1 MB | 5 GB | — |

If quotas ever approach limits (they won't at this scale), `turso.tech/pricing` → Developer $5/mo.
