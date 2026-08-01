import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const stations = sqliteTable("stations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  secret: text("secret").notNull(),
  lastHeartbeatAt: integer("last_heartbeat_at").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const staff = sqliteTable(
  "staff",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    stationId: text("station_id")
      .notNull()
      .references(() => stations.id),
    name: text("name").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("staff_station_idx").on(t.stationId)]
);

export const shifts = sqliteTable("shifts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),
  qrStartsMin: integer("qr_starts_min").notNull().default(45),
  qrEndsMin: integer("qr_ends_min").notNull().default(30),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const attendanceLog = sqliteTable(
  "attendance_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    stationId: text("station_id")
      .notNull()
      .references(() => stations.id),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id),
    shiftId: integer("shift_id")
      .notNull()
      .references(() => shifts.id),
    logDate: text("log_date").notNull(),
    scannedAt: integer("scanned_at").notNull(),
    status: text("status", { enum: ["on_time", "late"] }).notNull(),
    source: text("source", { enum: ["qr", "manual"] }).notNull().default("qr"),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("attendance_unique").on(t.staffId, t.shiftId, t.logDate),
    index("attendance_station_date_idx").on(t.stationId, t.logDate),
    index("attendance_staff_date_idx").on(t.staffId, t.logDate),
  ]
);

export type Station = typeof stations.$inferSelect;
export type Staff = typeof staff.$inferSelect;
export type Shift = typeof shifts.$inferSelect;
export type AttendanceLog = typeof attendanceLog.$inferSelect;
