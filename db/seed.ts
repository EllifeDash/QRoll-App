import "dotenv/config";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { randomInt } from "crypto";

import { shifts, staff, stations } from "./schema";

const db = drizzle(
  createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })
);

const STATION_NAMES = [
  "Station 1",
  "Station 2",
  "Station 3",
  "Station 4",
  "Station 5",
  "Station 6",
  "Station 7",
  "Station 8",
  "Station 9",
  "Station 10",
  "Station 11",
];

function pin(): string {
  return String(randomInt(1000, 9999));
}

async function main() {
  const stationRows = await db
    .select({ id: stations.id })
    .from(stations)
    .all();
  if (stationRows.length === 0) {
    await db
      .insert(stations)
      .values(STATION_NAMES.map((name, i) => ({
        id: `s${String(i + 1).padStart(2, "0")}`,
        name,
        secret: pin(),
      })))
      .run();
    console.log(`Seeded ${STATION_NAMES.length} stations`);
  } else {
    console.log("Stations already exist, skipping");
  }

  const shiftRows = await db.select({ id: shifts.id }).from(shifts).all();
  if (shiftRows.length === 0) {
    await db
      .insert(shifts)
      .values([
        { name: "Day", startTime: "09:00", qrStartsMin: 45, qrEndsMin: 30 },
        { name: "Evening", startTime: "17:00", qrStartsMin: 45, qrEndsMin: 30 },
      ])
      .run();
    console.log("Seeded Day + Evening shifts");
  } else {
    console.log("Shifts already exist, skipping");
  }

  const staffRows = await db.select({ id: staff.id }).from(staff).all();
  if (staffRows.length === 0) {
    await db
      .insert(staff)
      .values([
        { stationId: "s01", name: "Staff One" },
        { stationId: "s01", name: "Staff Two" },
        { stationId: "s02", name: "Staff Three" },
      ])
      .run();
    console.log("Seeded placeholder staff (edit names in admin UI)");
  } else {
    console.log("Staff already exist, skipping");
  }

  db.$client.close();
  console.log("Seed complete — idempotent, re-run safe");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
