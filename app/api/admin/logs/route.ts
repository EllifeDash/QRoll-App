import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { attendanceLog, shifts, staff, stations } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const MAX_ROWS = 500;

function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const stationId = params.get("station");
  const shiftIdRaw = params.get("shift");
  const status = params.get("status");
  const logDate = params.get("date");
  const asCsv = params.get("format") === "csv";

  const where = and(
    stationId ? eq(attendanceLog.stationId, stationId) : undefined,
    shiftIdRaw ? eq(attendanceLog.shiftId, Number(shiftIdRaw)) : undefined,
    status === "on_time" || status === "late"
      ? eq(attendanceLog.status, status)
      : undefined,
    logDate ? eq(attendanceLog.logDate, logDate) : undefined
  );

  const rows = await db
    .select({
      id: attendanceLog.id,
      stationId: attendanceLog.stationId,
      stationName: stations.name,
      staffId: attendanceLog.staffId,
      staffName: staff.name,
      shiftId: attendanceLog.shiftId,
      shiftName: shifts.name,
      logDate: attendanceLog.logDate,
      scannedAt: attendanceLog.scannedAt,
      status: attendanceLog.status,
      source: attendanceLog.source,
      note: attendanceLog.note,
    })
    .from(attendanceLog)
    .innerJoin(stations, eq(attendanceLog.stationId, stations.id))
    .innerJoin(staff, eq(attendanceLog.staffId, staff.id))
    .innerJoin(shifts, eq(attendanceLog.shiftId, shifts.id))
    .where(where)
    .orderBy(desc(attendanceLog.scannedAt))
    .limit(MAX_ROWS);

  if (asCsv) {
    const header = ["id", "station", "staff", "shift", "date", "scanned_at", "status", "source", "note"];
    const lines = rows.map((r) =>
      [r.id, r.stationName, r.staffName, r.shiftName, r.logDate, r.scannedAt, r.status, r.source, r.note]
        .map(csvEscape)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="qroll-logs-${logDate ?? "all"}.csv"`,
      },
    });
  }

  return NextResponse.json({ logs: rows, total: rows.length, maxRows: MAX_ROWS });
}
