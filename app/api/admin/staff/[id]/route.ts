import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { staff } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const staffId = Number(id);
  if (!Number.isInteger(staffId)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  let body: { name?: unknown; stationId?: unknown; isActive?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const patch: Partial<{ name: string; stationId: string; isActive: boolean }> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    patch.name = body.name.trim();
  }
  if (body.stationId !== undefined) {
    if (typeof body.stationId !== "string") {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    patch.stationId = body.stationId;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    patch.isActive = body.isActive;
  }

  const [row] = await db
    .update(staff)
    .set(patch)
    .where(eq(staff.id, staffId))
    .returning({ id: staff.id });

  if (!row) {
    return NextResponse.json({ error: "staff_not_found" }, { status: 404 });
  }
  return NextResponse.json({ id: row.id });
}
