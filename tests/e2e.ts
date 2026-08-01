/**
 * Phase 6 E2E runbook (6.1 scenarios + 6.2 security checks).
 *
 * Self-contained: spawns `next start` on port 3100, creates temp shifts
 * (start times relative to now => clock-independent), runs the battery,
 * tears down DB rows and the server. Exit code 0 = all green.
 *
 * Run: npm run test:e2e   (requires `npm run build` first)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createClient } from "@libsql/client";

const localRequire = createRequire(import.meta.url);
const nextBin = localRequire.resolve("next/dist/bin/next");

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS ${name}`);
    })
    .catch((e) => {
      failed += 1;
      failures.push(name);
      console.log(`  FAIL ${name} — ${e instanceof Error ? e.message : String(e)}`);
    });
}

interface ApiResult {
  status: number;
  body: any;
  setCookie: string | null;
}

async function api(
  path: string,
  init?: RequestInit & { headers?: Record<string, string> }
): Promise<ApiResult> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return {
    status: res.status,
    body: await res.json().catch(() => null),
    setCookie: res.headers.get("set-cookie"),
  };
}

function hmacToken(stationId: string, shiftId: number, expSec: number): string {
  const payload = Buffer.from(
    JSON.stringify({ s: stationId, sh: shiftId, exp: expSec })
  ).toString("base64url");
  const sig = createHmac("sha256", process.env.HMAC_SECRET!)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

const fmtHHMM = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);

function flipLastChar(s: string): string {
  return s.slice(0, -1) + (s.endsWith("A") ? "B" : "A");
}

async function main() {
  // Self-heal any stale E2E rows from a crashed/aborted previous run.
  await cleanE2E();

  const now = new Date();
  const lateStart = new Date(now.getTime() - 10 * 60_000); // scan now => late
  const onTimeStart = new Date(now.getTime() + 30 * 60_000); // scan now => on_time
  console.log(`E2E run at ${now.toISOString()} — temp shifts relative to now`);

  const lateShift = (
    await db.execute(
      "INSERT INTO shifts (name, start_time, qr_starts_min, qr_ends_min, is_active) VALUES ('E2E-LATE', ?, 45, 60, 1) RETURNING id",
      [fmtHHMM(lateStart)]
    )
  ).rows[0].id as number;
  const onTimeShift = (
    await db.execute(
      "INSERT INTO shifts (name, start_time, qr_starts_min, qr_ends_min, is_active) VALUES ('E2E-ONTIME', ?, 45, 60, 0) RETURNING id",
      [fmtHHMM(onTimeStart)]
    )
  ).rows[0].id as number;

  const staff1 = (
    await db.execute("INSERT INTO staff (station_id, name, is_active) VALUES ('s01', 'E2E One', 1) RETURNING id")
  ).rows[0].id as number;
  const staff2 = (
    await db.execute("INSERT INTO staff (station_id, name, is_active) VALUES ('s01', 'E2E Two', 1) RETURNING id")
  ).rows[0].id as number;
  const staff3 = (
    await db.execute("INSERT INTO staff (station_id, name, is_active) VALUES ('s02', 'E2E Three', 1) RETURNING id")
  ).rows[0].id as number;

  const pinRows = await db.execute("SELECT id, secret FROM stations WHERE id IN ('s01', 's02')");
  const pin1 = pinRows.rows.find((r) => r.id === "s01")!.secret as string;

  // Run-time independence: real shifts off, only temp windows active.
  await db.execute("UPDATE shifts SET is_active = 0 WHERE name IN ('Day', 'Evening')");

  // Fail fast if the port is already serving a stale server.
  try {
    const stale = await fetch(`${BASE}/`);
    if (stale.ok) throw new Error("port 3100 already in use — stop the existing server first");
  } catch (e) {
    if (e instanceof Error && e.message.includes("already in use")) throw e;
  }

  console.log("spawning `next start` on :3100 …");
  const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
    env: { ...process.env },
    stdio: "ignore",
  });

  let lateToken = "";
  let lateShiftId = 0;
  let manualMarkId = 0;
  let adminCookie = "";

  try {
    await waitForServer();

    // ---- 6.1 scenarios ----
    await ok("kiosk: wrong PIN rejected → 401", async () => {
      const r = await api("/api/token", { method: "POST", body: JSON.stringify({ stationId: "s01", pin: "0000" }) });
      assert.equal(r.status, 401);
      assert.equal(r.body.error, "invalid_station_or_pin");
    });

    await ok("kiosk: correct PIN issues token (LATE shift)", async () => {
      const r = await api("/api/token", { method: "POST", body: JSON.stringify({ stationId: "s01", pin: pin1 }) });
      assert.equal(r.status, 200);
      assert.equal(r.body.isActive, true);
      assert.equal(r.body.shift.name, "E2E-LATE");
      lateToken = r.body.token;
      lateShiftId = r.body.shift.id;
    });

    await ok("scan: /api/scan/info lists station staff", async () => {
      const r = await api(`/api/scan/info?t=${encodeURIComponent(lateToken)}`);
      assert.equal(r.status, 200);
      assert.equal(r.body.stationId, "s01");
      const names = r.body.staff.map((s: { name: string }) => s.name);
      assert.ok(names.includes("E2E One") && names.includes("E2E Two"));
    });

    await ok("scan: late status (shift started 10 min ago)", async () => {
      const r = await api("/api/scan", { method: "POST", body: JSON.stringify({ token: lateToken, staffId: staff2 }) });
      assert.equal(r.status, 200);
      assert.equal(r.body.status, "late");
      assert.equal(r.body.alreadyMarked, false);
      assert.equal(r.body.staffName, "E2E Two");
    });

    await ok("scan: replay of same token+staff → 409 with original time/status", async () => {
      const r = await api("/api/scan", { method: "POST", body: JSON.stringify({ token: lateToken, staffId: staff2 }) });
      assert.equal(r.status, 409);
      assert.equal(r.body.error, "already_marked");
      assert.equal(r.body.alreadyMarked, true);
      assert.equal(r.body.status, "late");
      assert.equal(typeof r.body.scannedAt, "number");
    });

    await ok("scan: wrong-station staff → 403 staff_not_at_station", async () => {
      const r = await api("/api/scan", { method: "POST", body: JSON.stringify({ token: lateToken, staffId: staff3 }) });
      assert.equal(r.status, 403);
      assert.equal(r.body.error, "staff_not_at_station");
    });

    // ---- admin login (needed for CRUD/manual-mark scenarios) ----
    const loginRes = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
    });
    assert.equal(loginRes.status, 200, "admin login should succeed");
    adminCookie = (loginRes.setCookie ?? "").split(";")[0];
    assert.ok(adminCookie.startsWith("qroll_admin="), "session cookie issued");
    const adminHeaders = { Cookie: adminCookie, "Content-Type": "application/json" };

    await ok("admin: staff CRUD — create, disable blocks scan, enable", async () => {
      const c = await api("/api/admin/staff", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ stationId: "s01", name: "E2E Four" }),
      });
      assert.equal(c.status, 201);
      const id = c.body.id as number;
      await api(`/api/admin/staff/${id}`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ isActive: false }),
      });
      const scan = await api("/api/scan", { method: "POST", body: JSON.stringify({ token: lateToken, staffId: id }) });
      assert.equal(scan.status, 403);
      assert.equal(scan.body.error, "staff_inactive");
      await api(`/api/admin/staff/${id}`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ isActive: true }),
      });
      await db.execute("DELETE FROM staff WHERE id = ?", [id]);
    });

    await ok("admin: manual mark (offline fallback) → 201 source=manual, late", async () => {
      const r = await api("/api/admin/marks", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ stationId: "s02", staffId: staff3, shiftId: lateShift, note: "kiosk offline" }),
      });
      assert.equal(r.status, 201);
      assert.equal(r.body.status, "late");
      manualMarkId = r.body.id as number;
    });

    await ok("admin: duplicate manual mark → 409", async () => {
      const r = await api("/api/admin/marks", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ stationId: "s02", staffId: staff3, shiftId: lateShift }),
      });
      assert.equal(r.status, 409);
      assert.equal(r.body.error, "already_marked");
    });

    await ok("admin: manual mark delete → 200, re-delete → 404", async () => {
      const d = await api(`/api/admin/marks/${manualMarkId}`, { method: "DELETE", headers: adminHeaders });
      assert.equal(d.status, 200);
      const d2 = await api(`/api/admin/marks/${manualMarkId}`, { method: "DELETE", headers: adminHeaders });
      assert.equal(d2.status, 404);
    });

    // ---- on_time phase: only ONTIME shift active ----
    await db.execute("UPDATE shifts SET is_active = 0 WHERE id = ?", [lateShift]);
    await db.execute("UPDATE shifts SET is_active = 1 WHERE id = ?", [onTimeShift]);

    await ok("scan: on_time status (shift starts in 30 min)", async () => {
      const t = await api("/api/token", { method: "POST", body: JSON.stringify({ stationId: "s01", pin: pin1 }) });
      assert.equal(t.body.shift.name, "E2E-ONTIME");
      const r = await api("/api/scan", { method: "POST", body: JSON.stringify({ token: t.body.token, staffId: staff1 }) });
      assert.equal(r.status, 200);
      assert.equal(r.body.status, "on_time");
      assert.equal(r.body.staffName, "E2E One");
    });

    // ---- 6.2 security checks ----
    await ok("security: tampered signature → 400 invalid_token", async () => {
      const [p, s] = lateToken.split(".");
      const r = await api("/api/scan", { method: "POST", body: JSON.stringify({ token: `${p}.${flipLastChar(s)}`, staffId: staff1 }) });
      assert.equal(r.status, 400);
      assert.equal(r.body.error, "invalid_token");
    });

    await ok("security: forged payload (bad HMAC) → 400 invalid_token", async () => {
      const forged = hmacToken("s01", lateShiftId, Math.floor(Date.now() / 1000) + 60);
      const tampered = flipLastChar(forged);
      const r = await api("/api/scan", { method: "POST", body: JSON.stringify({ token: tampered, staffId: staff1 }) });
      assert.equal(r.status, 400);
      assert.equal(r.body.error, "invalid_token");
    });

    await ok("security: signed expired token → 401 token_expired (scan)", async () => {
      const expired = hmacToken("s01", lateShiftId, Math.floor(Date.now() / 1000) - 60);
      const r = await api("/api/scan", { method: "POST", body: JSON.stringify({ token: expired, staffId: staff1 }) });
      assert.equal(r.status, 401);
      assert.equal(r.body.error, "token_expired");
    });

    await ok("security: signed expired token → 401 token_expired (info)", async () => {
      const expired = hmacToken("s01", lateShiftId, Math.floor(Date.now() / 1000) - 60);
      const r = await api(`/api/scan/info?t=${encodeURIComponent(expired)}`);
      assert.equal(r.status, 401);
      assert.equal(r.body.error, "token_expired");
    });

    await ok("security: admin routes unauthenticated → 401", async () => {
      const r = await api("/api/admin/overview");
      assert.equal(r.status, 401);
      assert.equal(r.body.error, "unauthorized");
    });

    await ok("security: tampered admin cookie → 401", async () => {
      const r = await api("/api/admin/overview", { headers: { Cookie: flipLastChar(adminCookie) } });
      assert.equal(r.status, 401);
      assert.equal(r.body.error, "unauthorized");
    });

    await ok("security: admin lockout after 5 wrong passwords (fake IP)", async () => {
      const fake: Record<string, string> = { "x-forwarded-for": "203.0.113.99" };
      for (let i = 0; i < 5; i += 1) {
        const r = await api("/api/admin/login", { method: "POST", headers: fake, body: JSON.stringify({ password: "wrong" }) });
        assert.equal(r.status, 401);
      }
      const locked = await api("/api/admin/login", { method: "POST", headers: fake, body: JSON.stringify({ password: "wrong" }) });
      assert.equal(locked.status, 429);
      assert.equal(locked.body.error, "locked");
      assert.ok(locked.body.retryAfterSec > 0);
    });

    await ok("security: real admin IP not affected by the lockout", async () => {
      const r = await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
      assert.equal(r.status, 200);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.log("failures:", failures.join(", "));
      process.exitCode = 1;
    }
  } finally {
    await cleanE2E();
    await db.execute("UPDATE shifts SET is_active = 1 WHERE name IN ('Day', 'Evening')");
    await db.execute("UPDATE stations SET last_heartbeat_at = 0 WHERE id IN ('s01', 's02')");
    console.log("  teardown ok (temp rows removed, shifts restored)");
    killServer(server);
  }
}

async function cleanE2E(): Promise<void> {
  try {
    await db.execute("DELETE FROM attendance_log WHERE shift_id IN (SELECT id FROM shifts WHERE name LIKE 'E2E-%')");
    await db.execute("DELETE FROM staff WHERE name LIKE 'E2E %'");
    await db.execute("DELETE FROM shifts WHERE name LIKE 'E2E-%'");
  } catch (e) {
    console.log("  cleanup error:", e instanceof Error ? e.message : e);
  }
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.status >= 200 && r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not become ready on :3100");
}

function killServer(server: ReturnType<typeof spawn>): void {
  try {
    if (server.pid) {
      spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
    }
  } catch {
    /* already dead */
  }
}

main().catch((e) => {
  console.error("E2E runner error:", e);
  process.exitCode = 1;
});
