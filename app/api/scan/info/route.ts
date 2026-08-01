import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { staff, stations, shifts } from "@/db/schema";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t");
  if (!token) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const verified = verifyToken(token);
  if (!verified.ok) {
    return NextResponse.json(
      { error: verified.error },
      { status: verified.error === "token_expired" ? 401 : 400 }
    );
  }
  const { s: stationId, sh: shiftId, exp } = verified.payload;

  const [station] = await db
    .select()
    .from(stations)
    .where(and(eq(stations.id, stationId), eq(stations.isActive, true)))
    .limit(1);
  if (!station) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.isActive, true)))
    .limit(1);
  if (!shift) {
    return NextResponse.json({ error: "no_active_shift" }, { status: 400 });
  }

  const staffRows = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(and(eq(staff.stationId, stationId), eq(staff.isActive, true)))
    .orderBy(staff.name);

  return NextResponse.json({
    stationId,
    stationName: station.name,
    shift: {
      id: shift.id,
      name: shift.name,
      startTime: shift.startTime,
    },
    expiresAt: exp,
    staff: staffRows.map((s) => ({ id: s.id, name: s.name })),
  });
}
