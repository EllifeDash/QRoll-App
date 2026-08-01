import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { logDateFor, scanStatus } from "@/lib/window";
import { attendanceLog, shifts, staff, stations } from "@/db/schema";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { token?: unknown; staffId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const { token, staffId } = body;
  if (typeof token !== "string" || typeof staffId !== "number") {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const verified = verifyToken(token);
  if (!verified.ok) {
    return NextResponse.json(
      { error: verified.error },
      { status: verified.error === "token_expired" ? 401 : 400 }
    );
  }
  const { s: stationId, sh: shiftId } = verified.payload;

  const [station] = await db
    .select()
    .from(stations)
    .where(eq(stations.id, stationId))
    .limit(1);
  if (!station || !station.isActive) {
    return NextResponse.json({ error: "no_active_shift" }, { status: 400 });
  }

  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.isActive, true)))
    .limit(1);
  if (!shift) {
    return NextResponse.json({ error: "no_active_shift" }, { status: 400 });
  }

  const [staffRow] = await db
    .select()
    .from(staff)
    .where(eq(staff.id, staffId))
    .limit(1);
  if (!staffRow) {
    return NextResponse.json({ error: "staff_not_found" }, { status: 400 });
  }
  if (staffRow.stationId !== stationId) {
    return NextResponse.json({ error: "staff_not_at_station" }, { status: 403 });
  }
  if (!staffRow.isActive) {
    return NextResponse.json({ error: "staff_inactive" }, { status: 403 });
  }

  const now = new Date();
  const [sh, m] = shift.startTime.split(":").map(Number);
  const shiftStart = new Date(now);
  shiftStart.setHours(sh, m, 0, 0);

  const logDate = logDateFor(shiftStart);
  const status = scanStatus(now, shiftStart);
  const scannedAt = Math.floor(now.getTime() / 1000);

  try {
    await db.insert(attendanceLog).values({
      stationId,
      staffId,
      shiftId,
      logDate,
      scannedAt,
      status,
      source: "qr",
    });
  } catch (err) {
    const cause =
      err instanceof Error && err.cause instanceof Error ? err.cause : null;
    const msg = cause?.message ?? (err instanceof Error ? err.message : String(err));
    const causeCode =
      cause && "code" in cause ? String((cause as { code: unknown }).code) : "";
    const isUnique = causeCode === "SQLITE_CONSTRAINT" || /UNIQUE/i.test(msg);
    if (isUnique) {
      const [existing] = await db
        .select({ scannedAt: attendanceLog.scannedAt, status: attendanceLog.status })
        .from(attendanceLog)
        .where(
          and(
            eq(attendanceLog.staffId, staffId),
            eq(attendanceLog.shiftId, shiftId),
            eq(attendanceLog.logDate, logDate)
          )
        )
        .limit(1);
      return NextResponse.json(
        {
          error: "already_marked",
          alreadyMarked: true,
          scannedAt: existing?.scannedAt,
          status: existing?.status,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({
    status,
    scannedAt,
    stationName: station.name,
    shiftName: shift.name,
    staffName: staffRow.name,
    alreadyMarked: false,
  });
}
