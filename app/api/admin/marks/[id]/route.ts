import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { attendanceLog } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const entryId = Number(id);
  if (!Number.isInteger(entryId)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const [row] = await db
    .delete(attendanceLog)
    .where(and(eq(attendanceLog.id, entryId)))
    .returning({ id: attendanceLog.id });

  if (!row) {
    return NextResponse.json({ error: "entry_not_found" }, { status: 404 });
  }
  return NextResponse.json({ id: row.id });
}
