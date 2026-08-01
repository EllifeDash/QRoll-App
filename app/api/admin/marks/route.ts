import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { attendanceLog, shifts, staff, stations } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { logDateFor, scanStatus } from "@/lib/window";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: {
    stationId?: unknown;
    staffId?: unknown;
    shiftId?: unknown;
    scannedAt?: unknown;
    logDate?: unknown;
    note?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { stationId, staffId, shiftId, note } = body;
  if (
    typeof stationId !== "string" ||
    typeof staffId !== "number" ||
    typeof shiftId !== "number"
  ) {
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
  const [staffRow] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.id, staffId))
    .limit(1);
  if (!staffRow) {
    return NextResponse.json({ error: "staff_not_found" }, { status: 400 });
  }
  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .limit(1);
  if (!shift) {
    return NextResponse.json({ error: "shift_not_found" }, { status: 400 });
  }

  const scannedAt = Math.floor(Date.now() / 1000);
  const shiftStart = new Date();
  const [h, m] = shift.startTime.split(":").map(Number);
  shiftStart.setHours(h, m, 0, 0);
  const logDate = logDateFor(shiftStart);
  const status = scanStatus(new Date(), shiftStart);

  try {
    const [row] = await db
      .insert(attendanceLog)
      .values({
        stationId,
        staffId,
        shiftId,
        logDate,
        scannedAt,
        status,
        source: "manual",
        note: typeof note === "string" && note.trim() ? note.trim() : null,
      })
      .returning({ id: attendanceLog.id });
    return NextResponse.json(
      { id: row.id, scannedAt, status, logDate },
      { status: 201 }
    );
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null;
    const msg = cause?.message ?? (err instanceof Error ? err.message : String(err));
    const isUnique = /UNIQUE/i.test(msg);
    if (isUnique) {
      return NextResponse.json(
        { error: "already_marked", detail: "This staff member already has an entry for this shift." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
