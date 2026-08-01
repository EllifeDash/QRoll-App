import type { Shift } from "@/db/schema";

/**
 * All window math runs against the process timezone (set via TZ env var,
 * e.g. TZ=Asia/Karachi — shift start times are wall-clock local times).
 * `now` is injectable for tests.
 */

export interface ShiftWindow {
  shift: Shift;
  windowStart: Date;
  windowEnd: Date;
  shiftStart: Date;
}

function atTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

export function shiftWindowFor(shift: Shift, onDate: Date): ShiftWindow {
  const shiftStart = atTime(onDate, shift.startTime);
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
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    candidates.push(shiftWindowFor(shift, tomorrow).windowStart);
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((min, c) => (c < min ? c : min));
}

/** `YYYY-MM-DD` of the shift start — the log date (evening shift crossing midnight logs to start date). */
export function logDateFor(shiftStart: Date): string {
  const y = shiftStart.getFullYear();
  const m = String(shiftStart.getMonth() + 1).padStart(2, "0");
  const d = String(shiftStart.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
