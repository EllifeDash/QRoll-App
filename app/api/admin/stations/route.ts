import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";

import { stations } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: { id?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { id, name } = body;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const pin = String(randomInt(1000, 10000));
  try {
    await db.insert(stations).values({ id, name: name.trim(), secret: pin });
  } catch {
    return NextResponse.json({ error: "station_exists" }, { status: 409 });
  }
  return NextResponse.json({ id, pin }, { status: 201 });
}
