import { test } from "node:test";
import assert from "node:assert/strict";

import type { Shift } from "@/db/schema";
import { wallParts } from "@/lib/clock";
import {
  getActiveWindow,
  logDateFor,
  nextWindowAt,
  scanStatus,
  shiftWindowFor,
} from "@/lib/window";

const DAY: Shift = {
  id: 1,
  name: "Day",
  startTime: "09:00",
  qrStartsMin: 45,
  qrEndsMin: 30,
  isActive: true,
};

const EVENING: Shift = {
  id: 2,
  name: "Evening",
  startTime: "17:00",
  qrStartsMin: 45,
  qrEndsMin: 30,
  isActive: true,
};

/** Real instant of the given Asia/Karachi wall-clock time (UTC+5, no DST). */
function at(date: string, hhmm: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, m, s = 0] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m, s) - 5 * 60 * 60 * 1000);
}

function wall(date: Date, key: "hour" | "minute" | "day"): number {
  return wallParts(date)[key];
}

test("shift window spans start minus qrStartsMin to start plus qrEndsMin", () => {
  const w = shiftWindowFor(DAY, at("2026-08-01", "09:00"));
  assert.equal(wall(w.windowStart, "hour"), 8);
  assert.equal(wall(w.windowStart, "minute"), 15);
  assert.equal(wall(w.windowEnd, "hour"), 9);
  assert.equal(wall(w.windowEnd, "minute"), 30);
  assert.equal(wall(w.shiftStart, "hour"), 9);
  assert.equal(wall(w.shiftStart, "minute"), 0);
});

test("getActiveWindow returns null outside any window", () => {
  const now = at("2026-08-01", "07:00");
  assert.equal(getActiveWindow([DAY, EVENING], now), null);
});

test("getActiveWindow returns day shift inside 08:15 window", () => {
  const now = at("2026-08-01", "08:30");
  const w = getActiveWindow([DAY, EVENING], now);
  assert.ok(w);
  assert.equal(w.shift.id, 1);
});

test("getActiveWindow returns day shift exactly at window start and end", () => {
  assert.equal(getActiveWindow([DAY], at("2026-08-01", "08:15"))?.shift.id, 1);
  assert.equal(getActiveWindow([DAY], at("2026-08-01", "09:30"))?.shift.id, 1);
  assert.equal(getActiveWindow([DAY], at("2026-08-01", "09:30:01")), null);
});

test("getActiveWindow picks evening shift in its window", () => {
  const w = getActiveWindow([DAY, EVENING], at("2026-08-01", "17:15"));
  assert.equal(w?.shift.id, 2);
});

test("scanStatus: before start is on_time, after is late", () => {
  const shiftStart = shiftWindowFor(DAY, at("2026-08-01", "09:00")).shiftStart;
  assert.equal(scanStatus(at("2026-08-01", "08:59"), shiftStart), "on_time");
  assert.equal(scanStatus(at("2026-08-01", "09:00"), shiftStart), "late");
  assert.equal(scanStatus(at("2026-08-01", "09:30"), shiftStart), "late");
});

test("nextWindowAt returns next window start after current day's window closes", () => {
  const now = at("2026-08-01", "09:31");
  const next = nextWindowAt([DAY], now);
  assert.ok(next);
  assert.equal(wall(next, "day"), 2);
  assert.equal(wall(next, "hour"), 8);
  assert.equal(wall(next, "minute"), 15);
});

test("nextWindowAt rolls to tomorrow when no window remains today", () => {
  const now = at("2026-08-01", "23:00");
  const next = nextWindowAt([EVENING], now);
  assert.ok(next);
  assert.equal(wall(next, "day"), 2);
  assert.equal(wall(next, "hour"), 16);
  assert.equal(wall(next, "minute"), 15);
});

test("logDateFor uses the shift-start date", () => {
  const shiftStart = shiftWindowFor(EVENING, at("2026-08-01", "17:00"))
    .shiftStart;
  assert.equal(logDateFor(shiftStart), "2026-08-01");
});
