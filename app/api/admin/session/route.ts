import { NextRequest, NextResponse } from "next/server";

import { ADMIN_COOKIE, verifyAdminSession } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  const authenticated = Boolean(token && verifyAdminSession(token).ok);
  return NextResponse.json({ authenticated });
}
