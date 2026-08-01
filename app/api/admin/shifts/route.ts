import { NextRequest, NextResponse } from "next/server";

import { shifts } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: {
    name?: unknown;
    startTime?: unknown;
    qrStartsMin?: unknown;
    qrEndsMin?: unknown;
    isActive?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { name, startTime, qrStartsMin, qrEndsMin, isActive } = body;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof startTime !== "string" ||
    !TIME_RE.test(startTime) ||
    typeof qrStartsMin !== "number" ||
    typeof qrEndsMin !== "number"
  ) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const [row] = await db
    .insert(shifts)
    .values({
      name: name.trim(),
      startTime,
      qrStartsMin,
      qrEndsMin,
      isActive: isActive === undefined ? true : Boolean(isActive),
    })
    .returning({ id: shifts.id });

  return NextResponse.json({ id: row.id }, { status: 201 });
}
