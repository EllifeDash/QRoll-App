# QRoll — Station Attendance QR System

Staff attendance system for a head office monitoring **11 stations**. Each station PC runs a full-screen kiosk that displays a **rotating QR code** during shift check-in windows. Staff scan the QR with their phone camera, confirm their identity, and their attendance (timestamp + staff ID) is recorded. The admin at head office gets a live dashboard of all stations.

## Why this design

- **The PC screen is the physical anchor** — to mark attendance you must be physically at the station.
- **Rotating QR (60s expiry)** defeats screenshot/photo-sharing fraud — a shared photo dies within a minute.
- **Server issues tokens; the PC only displays them** — station PC clocks are never trusted.
- **Zero-install for staff** — phone camera → web page → one tap (identity remembered in the browser).
- **Shift windows are data, not code** — schedule changes are an admin UI edit.

## Stack

| Layer | Choice | Cost |
|---|---|---|
| App | Next.js (App Router), deployed on Vercel | Free (Hobby) |
| Database | Turso (libSQL/SQLite) | Free (5 GB, 500M reads / 10M writes per month) |
| ORM / migrations | Drizzle ORM + `drizzle-kit` | — |
| Admin auth | Single password + signed HTTP-only cookie | — |
| QR rendering | `qrcode` (client-side) | — |
| Token signing | HMAC-SHA256 (stateless) | — |

## Repo layout

```
/
├── README.md
├── docs/
│   ├── architecture.md   # system design, flows, decisions
│   ├── schema.md         # data model
│   ├── api.md            # endpoint + token specification
│   ├── operations.md     # admin day-to-day runbook
│   ├── decisions.md      # brainstorm Q&A log
│   └── build-plan.md     # live build tracker with timestamps
└── app/                  # Next.js application
```

## Quick start

1. Create a Turso database: `turso db create attendance` → copy URL + auth token.
2. Set env vars (see `docs/operations.md` for the full list).
3. `npm install`, `npm run db:push`, `npm run db:seed`.
4. `npm run dev` — kiosk at `/kiosk/<stationId>`, scan flow at `/scan?t=…` (admin dashboard ships in Phase 5).
5. Deploy to Vercel (`vercel deploy`), then set up each station PC as a full-screen kiosk tab.

## Pages

| Page | Who | What |
|---|---|---|
| `/kiosk/:stationId` | Station PC | Rotating QR, countdown, offline state, next-window countdown |
| `/scan?t=…` | Staff phone | Identity picker → mark attendance → confirmation with timestamp |
| `/admin` | Head office admin | Live station grid, logs, CSV export, CRUD, manual corrections — **planned (Phase 5)** |

## Security posture (summary)

- No RLS in SQLite — **all** DB access goes through validated API routes; the DB credential never reaches the browser.
- QR token: HMAC-signed, 60s lifetime, bound to station + shift.
- Admin routes: password login → signed cookie, 7-day expiry.
- Full threat model: `docs/architecture.md#threat-model`.
