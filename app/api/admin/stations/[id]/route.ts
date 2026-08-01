import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { eq } from "drizzle-orm";

import { stations } from "@/db/schema";
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

  let body: { name?: unknown; isActive?: unknown; resetPin?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const patch: Partial<{ name: string; isActive: boolean; secret: string }> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    patch.name = body.name.trim();
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    patch.isActive = body.isActive;
  }
  let newPin: string | null = null;
  if (body.resetPin === true) {
    newPin = String(randomInt(1000, 10000));
    patch.secret = newPin;
  }

  const [row] = await db
    .update(stations)
    .set(patch)
    .where(eq(stations.id, id))
    .returning({ id: stations.id });

  if (!row) {
    return NextResponse.json({ error: "station_not_found" }, { status: 404 });
  }
  return NextResponse.json({ id: row.id, pin: newPin });
}
