import { NextResponse } from "next/server";

import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SEC,
  checkLockout,
  clearAttempts,
  passwordMatches,
  recordFailedAttempt,
  signAdminSession,
} from "@/lib/admin";

export const runtime = "nodejs";

function clientKey(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
}

export async function POST(req: Request) {
  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { password } = body;
  if (typeof password !== "string" || password.length === 0) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const key = clientKey(req);
  const lock = checkLockout(key);
  if (lock.locked) {
    return NextResponse.json(
      { error: "locked", retryAfterSec: lock.retryAfterSec },
      { status: 429 }
    );
  }

  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!passwordMatches(password, expected)) {
    const state = recordFailedAttempt(key);
    return NextResponse.json(
      {
        error: "invalid_password",
        remaining: state.remaining,
        locked: state.locked,
        retryAfterSec: state.retryAfterSec,
      },
      { status: 401 }
    );
  }

  clearAttempts(key);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, signAdminSession(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SEC,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
