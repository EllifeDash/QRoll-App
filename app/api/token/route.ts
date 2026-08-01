import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { tzNow } from "@/lib/clock";
import { db } from "@/lib/db";
import { mintToken } from "@/lib/token";
import { getActiveWindow, logDateFor, nextWindowAt } from "@/lib/window";
import { attendanceLog, stations } from "@/db/schema";

export const runtime = "nodejs";

const HEARTBEAT_THROTTLE_MS = 60_000;

export async function POST(req: Request) {
  let body: { stationId?: unknown; pin?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_station_or_pin" }, { status: 401 });
  }

  const { stationId, pin } = body;
  if (typeof stationId !== "string" || typeof pin !== "string") {
    return NextResponse.json({ error: "invalid_station_or_pin" }, { status: 401 });
  }

  const [station] = await db
    .select()
    .from(stations)
    .where(eq(stations.id, stationId))
    .limit(1);

  if (!station || station.secret !== pin) {
    return NextResponse.json({ error: "invalid_station_or_pin" }, { status: 401 });
  }
  if (!station.isActive) {
    return NextResponse.json({ error: "station_inactive" }, { status: 403 });
  }

  const now = tzNow();
  const activeShifts = await db.query.shifts.findMany({
    where: (s, { eq }) => eq(s.isActive, true),
  });
  const window = getActiveWindow(activeShifts, now);

  const nowMs = Date.now();
  if (nowMs - station.lastHeartbeatAt >= HEARTBEAT_THROTTLE_MS) {
    await db
      .update(stations)
      .set({ lastHeartbeatAt: nowMs })
      .where(eq(stations.id, stationId));
  }

  const todayLogDate = logDateFor(now);
  const scanRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(attendanceLog)
    .where(
      and(
        eq(attendanceLog.stationId, stationId),
        eq(attendanceLog.logDate, todayLogDate)
      )
    );
  const scanCountToday = scanRows[0]?.count ?? 0;

  if (!window) {
    const nextAt = nextWindowAt(activeShifts, now);
    return NextResponse.json({
      token: null,
      isActive: false,
      nextWindowAt: nextAt ? Math.floor(nextAt.getTime() / 1000) : null,
      stationName: station.name,
      scanCountToday,
    });
  }

  const { token, expiresAt } = mintToken(station.id, window.shift.id, nowMs);
  return NextResponse.json({
    token,
    expiresAt,
    refreshInSec: 30,
    stationName: station.name,
    shift: {
      id: window.shift.id,
      name: window.shift.name,
      startTime: window.shift.startTime,
    },
    isActive: true,
    logDate: logDateFor(window.shiftStart),
    scanCountToday,
  });
}
