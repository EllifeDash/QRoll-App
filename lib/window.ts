import type { Shift } from "@/db/schema";
import { atWallTime, wallDateString } from "@/lib/clock";

/**
 * All window math runs against Asia/Karachi wall time via lib/clock.ts —
 * independent of the process timezone (Vercel reserves the `TZ` env var).
 * `now` is injectable for tests; pass `tzNow()` from lib/clock in routes.
 */

export interface ShiftWindow {
  shift: Shift;
  windowStart: Date;
  windowEnd: Date;
  shiftStart: Date;
}

export function shiftWindowFor(shift: Shift, onDate: Date): ShiftWindow {
  const shiftStart = atWallTime(onDate, shift.startTime);
  const windowStart = new Date(
    shiftStart.getTime() - shift.qrStartsMin * 60_000
  );
  const windowEnd = new Date(shiftStart.getTime() + shift.qrEndsMin * 60_000);
  return { shift, windowStart, windowEnd, shiftStart };
}

/** Active window for `now`, or null when no active shift window is open. */
export function getActiveWindow(
  activeShifts: Shift[],
  now: Date
): ShiftWindow | null {
  for (const shift of activeShifts) {
    const w = shiftWindowFor(shift, now);
    if (now >= w.windowStart && now <= w.windowEnd) return w;
  }
  return null;
}

export type ScanStatus = "on_time" | "late";

export function scanStatus(now: Date, shiftStart: Date): ScanStatus {
  return now < shiftStart ? "on_time" : "late";
}

/** Next future window start for countdown display, or null if none. */
export function nextWindowAt(
  activeShifts: Shift[],
  now: Date
): Date | null {
  const candidates: Date[] = [];
  for (const shift of activeShifts) {
    const today = shiftWindowFor(shift, now);
    if (today.windowEnd > now) {
      candidates.push(today.windowStart);
      continue;
    }
    const tomorrow = new Date(now.getTime() + 86_400_000);
    candidates.push(shiftWindowFor(shift, tomorrow).windowStart);
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((min, c) => (c < min ? c : min));
}

/** `YYYY-MM-DD` of the shift start — the log date (evening shift crossing midnight logs to start date). */
export function logDateFor(shiftStart: Date): string {
  return wallDateString(shiftStart);
}
