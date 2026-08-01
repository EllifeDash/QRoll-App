# Decisions Log

Brainstorming Q&A and design decisions, in order. Last entry = current state.

## 1. Core concept
- **Idea**: PC at each of 11 stations generates a QR daily at 09:00; staff scan with phone camera → timestamp + user ID recorded → attendance.
- **Refinement**: QR window opens **45 min early** (08:15) so short kiosk outages self-heal; window closes 30 min after start.
- **Refinement**: rotating QR (60s) instead of static daily QR — a screenshot of a static QR works all day from anywhere; a rotated token dies in a minute.

## 2. Where does the "PC app" live?
- **Decision**: kiosk browser tab (full-screen Chrome pointed at a URL), not a native app.
- **Why**: zero deployment per station, central updates, no installers to maintain across 11 machines.

## 3. Who is the source of truth for time?
- **Decision**: server only. The PC is a dumb display; its clock is never trusted (prevents clock-tampering fraud). Tokens are HMAC-signed server-side with `exp = now + 60s`.

## 4. Q&A round (answered)
| Question | Answer | Consequence |
|---|---|---|
| Staff per station? | **Multiple**, two main shifts 09:00–17:00 & 17:00–00:00 | Scan page needs an identity picker (not implicit) |
| Anti-fraud level? | **Rotating QR only** (no GPS) | No location permissions; photo-sharing defeated by rotation; collusion remains an accepted residual risk |
| Staff phone UX? | **Zero-install web page** | Identity saved in localStorage → one-tap after first scan |
| Attendance events? | **Check-in only** | Two check-in windows (one per shift), no check-out |
| Shifts configurable? | **Yes** | Shifts are DB rows editable in admin UI, not code |

## 5. Backend choice — Supabase rejected
- **Constraint**: Supabase free tier allows 2 projects; user is at the limit for other projects.
- **Decision**: **Vercel (Hobby) + Turso (SQLite)**.
  - Turso free: 100 DBs, 5 GB, 500M reads / 10M writes per month — verified 2026 pricing page. App needs ~1,000× less.
  - Vercel free: 100K function invocations/day; kiosk polling at 30s × 11 stations ≈ 32K/day — under quota.
  - No cold starts, nothing sleeps — required because kiosks poll continuously.
- Alternatives considered: Cloudflare Workers + D1 (more headroom, but full rewrite in Workers/Hono), self-host at head office (zero quotas, but uptime = office PC uptime), Neon Postgres (0.5 GB / 190 compute-hrs — polling can burn compute hours; unnecessary since SQLite suffices).

## 6. Security model shift (no RLS)
- **Decision**: all DB access via validated API routes; DB credential never reaches the browser. Admin = single password + signed cookie.
- **Accepted**: 1-admin system doesn't need an auth provider (no Supabase Auth, no Clerk).

## 7. Identity on scan
- **Decision**: no passwords for staff. Fresh visitor picks their name from the station's staff list; stored in localStorage.
- **Why safe**: a valid token exists only on the live station screen; name-picking without a token is useless.

## 8. Dedupe mechanism
- **Decision**: `UNIQUE(staff_id, shift_id, log_date)` in the DB — the constraint error *is* the duplicate detection (no application-level race).

## 9. Token replay
- **Decision**: no `token_used_at` table in v1. A 60s token scanned by multiple staff at one station is legitimate. Replay of the same token+staff hits the unique constraint. **Escalation path if abuse emerges**: add token usage tracking.

## Open items (deferred, not forgotten)
- GPS geofence if fraud becomes a real problem (deliberately excluded per decision 4).
- Biometrics for full collusion prevention (overkill at 11 stations).
- Audit trail on manual corrections (v1 logs `note` + `source: manual` only).
