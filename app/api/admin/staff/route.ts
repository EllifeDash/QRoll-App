import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { staff, stations } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const rows = await db
    .select({
      id: staff.id,
      stationId: staff.stationId,
      name: staff.name,
      isActive: staff.isActive,
      stationName: stations.name,
    })
    .from(staff)
    .innerJoin(stations, eq(staff.stationId, stations.id))
    .orderBy(desc(staff.isActive), staff.name);

  return NextResponse.json({ staff: rows });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: { stationId?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { stationId, name } = body;
  if (typeof stationId !== "string" || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const [station] = await db
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.id, stationId))
    .limit(1);
  if (!station) {
    return NextResponse.json({ error: "station_not_found" }, { status: 400 });
  }

  const [row] = await db
    .insert(staff)
    .values({ stationId, name: name.trim(), isActive: true })
    .returning({ id: staff.id });

  return NextResponse.json({ id: row.id }, { status: 201 });
}
