import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const ADMIN_COOKIE = "qroll_admin";
export const ADMIN_SESSION_TTL_SEC = 7 * 24 * 3600;

interface AdminPayload {
  exp: number;
  iat: number;
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", process.env.HMAC_SECRET!).update(payload).digest("base64url");
}

export function signAdminSession(now = Date.now()): string {
  const payload: AdminPayload = {
    exp: Math.floor(now / 1000) + ADMIN_SESSION_TTL_SEC,
    iat: Math.floor(now / 1000),
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export type AdminVerify =
  | { ok: true }
  | { ok: false; error: "invalid_session" | "session_expired" };

export function verifyAdminSession(token: string, now = Date.now()): AdminVerify {
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, error: "invalid_session" };
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payloadB64);
  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, error: "invalid_session" };
  }

  let payload: AdminPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as AdminPayload;
  } catch {
    return { ok: false, error: "invalid_session" };
  }
  if (typeof payload.exp !== "number" || typeof payload.iat !== "number") {
    return { ok: false, error: "invalid_session" };
  }
  if (payload.exp <= Math.floor(now / 1000)) {
    return { ok: false, error: "session_expired" };
  }
  return { ok: true };
}

export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token || !verifyAdminSession(token).ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export function passwordMatches(input: string, expected: string): boolean {
  const a = createHmac("sha256", "pw").update(input).digest();
  const b = createHmac("sha256", "pw").update(expected).digest();
  return timingSafeEqual(a, b);
}

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

interface AttemptState {
  count: number;
  lockedUntil: number;
}

const attempts = new Map<string, AttemptState>();

function prune() {
  const now = Date.now();
  for (const [key, state] of attempts) {
    if (state.lockedUntil && state.lockedUntil <= now) attempts.delete(key);
  }
}

export function checkLockout(key: string): { locked: boolean; retryAfterSec: number } {
  prune();
  const state = attempts.get(key);
  if (state && state.lockedUntil > Date.now()) {
    return { locked: true, retryAfterSec: Math.ceil((state.lockedUntil - Date.now()) / 1000) };
  }
  return { locked: false, retryAfterSec: 0 };
}

export function recordFailedAttempt(key: string): {
  remaining: number;
  locked: boolean;
  retryAfterSec: number;
} {
  prune();
  const state = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
  state.count += 1;
  if (state.count >= MAX_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOCK_MS;
    state.count = 0;
    attempts.set(key, state);
    return { remaining: 0, locked: true, retryAfterSec: LOCK_MS / 1000 };
  }
  attempts.set(key, state);
  return { remaining: MAX_ATTEMPTS - state.count, locked: false, retryAfterSec: 0 };
}

export function clearAttempts(key: string) {
  attempts.delete(key);
}
