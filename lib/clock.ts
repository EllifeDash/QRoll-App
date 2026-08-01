/**
 * Timezone-explicit clock. All shift-window math runs against Asia/Karachi
 * wall time regardless of the process timezone (Vercel reserves the `TZ`
 * env var name and runs Node in UTC, so relying on process TZ breaks
 * window math in production).
 *
 * Convention: window Dates are **real instants**. `atWallTime` returns the
 * true epoch moment of the given wall-clock time (Karachi is UTC+5, no
 * DST, so the offset is constant), and `tzNow()` is the real current
 * instant. Epochs serialized to the API are therefore always real.
 */

export const APP_TIMEZONE = "Asia/Karachi";

const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;

export interface WallParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

const partsCache = new WeakMap<Date, WallParts>();

/** Wall-clock components of `date` in the app timezone. */
export function wallParts(date: Date): WallParts {
  const cached = partsCache.get(date);
  if (cached) return cached;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const out: WallParts = {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
  partsCache.set(date, out);
  return out;
}

/** Current real instant (call this instead of `new Date()` in routes). */
export function tzNow(): Date {
  return new Date();
}

/** Real instant of `hh:mm` (24h) on the anchor's wall-clock day, in the app timezone. */
export function atWallTime(anchor: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const p = wallParts(anchor);
  return wallInstant(p.year, p.month, p.day, h, m);
}

/** `YYYY-MM-DD` of the wall-clock date in the app timezone. */
export function wallDateString(date: Date): string {
  const p = wallParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function wallInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0
): Date {
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - KARACHI_OFFSET_MS
  );
}
