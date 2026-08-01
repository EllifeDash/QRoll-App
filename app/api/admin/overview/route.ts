import { NextRequest, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";

import { attendanceLog, shifts, staff, stations } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { tzNow } from "@/lib/clock";
import { getActiveWindow, logDateFor, nextWindowAt } from "@/lib/window";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const now = tzNow();

  const [stationRows, shiftRows, scanRows, staffRows] = await Promise.all([
    db
      .select({
        id: stations.id,
        name: stations.name,
        lastHeartbeatAt: stations.lastHeartbeatAt,
        isActive: stations.isActive,
      })
      .from(stations),
    db.select().from(shifts).where(eq(shifts.isActive, true)),
    db
      .select({
        stationId: attendanceLog.stationId,
        count: count(),
      })
      .from(attendanceLog)
      .where(eq(attendanceLog.logDate, logDateFor(now)))
      .groupBy(attendanceLog.stationId),
    db
      .select({
        stationId: staff.stationId,
        count: count(),
      })
      .from(staff)
      .where(eq(staff.isActive, true))
      .groupBy(staff.stationId),
  ]);

  const scansByStation = new Map(scanRows.map((r) => [r.stationId, r.count]));
  const staffByStation = new Map(staffRows.map((r) => [r.stationId, r.count]));

  const live = getActiveWindow(shiftRows, now);
  const next = nextWindowAt(shiftRows, now);
  const nowSec = Math.floor(now.getTime() / 1000);

  return NextResponse.json({
    now: nowSec,
    qrLive: live !== null,
    liveWindow: live
      ? {
          shiftId: live.shift.id,
          shiftName: live.shift.name,
          startTime: live.shift.startTime,
          windowStart: Math.floor(live.windowStart.getTime() / 1000),
          windowEnd: Math.floor(live.windowEnd.getTime() / 1000),
        }
      : null,
    nextWindowAt: next ? Math.floor(next.getTime() / 1000) : null,
    stations: stationRows.map((s) => ({
      id: s.id,
      name: s.name,
      isActive: s.isActive,
      heartbeatAt: s.lastHeartbeatAt > 0 ? s.lastHeartbeatAt : null,
      heartbeatAgeSec:
        s.lastHeartbeatAt > 0 ? Math.max(0, nowSec - s.lastHeartbeatAt) : null,
      scansToday: scansByStation.get(s.id) ?? 0,
      staffCount: staffByStation.get(s.id) ?? 0,
    })),
  });
}
