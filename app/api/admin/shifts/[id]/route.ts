import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { shifts } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const shiftId = Number(id);
  if (!Number.isInteger(shiftId)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

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

  const patch: Partial<{
    name: string;
    startTime: string;
    qrStartsMin: number;
    qrEndsMin: number;
    isActive: boolean;
  }> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    patch.name = body.name.trim();
  }
  if (body.startTime !== undefined) {
    if (typeof body.startTime !== "string" || !TIME_RE.test(body.startTime)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    patch.startTime = body.startTime;
  }
  if (body.qrStartsMin !== undefined) {
    if (typeof body.qrStartsMin !== "number") {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    patch.qrStartsMin = body.qrStartsMin;
  }
  if (body.qrEndsMin !== undefined) {
    if (typeof body.qrEndsMin !== "number") {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    patch.qrEndsMin = body.qrEndsMin;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    patch.isActive = body.isActive;
  }

  const [row] = await db
    .update(shifts)
    .set(patch)
    .where(eq(shifts.id, shiftId))
    .returning({ id: shifts.id });

  if (!row) {
    return NextResponse.json({ error: "shift_not_found" }, { status: 404 });
  }
  return NextResponse.json({ id: row.id });
}
