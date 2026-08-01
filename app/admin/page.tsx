"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import styles from "./admin.module.css";

interface StationTile {
  id: string;
  name: string;
  isActive: boolean;
  heartbeatAt: number | null;
  heartbeatAgeSec: number | null;
  scansToday: number;
  staffCount: number;
}

interface Overview {
  now: number;
  qrLive: boolean;
  liveWindow: {
    shiftId: number;
    shiftName: string;
    startTime: string;
    windowStart: number;
    windowEnd: number;
  } | null;
  nextWindowAt: number | null;
  stations: StationTile[];
}

interface ShiftRow {
  id: number;
  name: string;
  startTime: string;
  qrStartsMin: number;
  qrEndsMin: number;
  isActive: boolean;
}

interface StaffRow {
  id: number;
  stationId: string;
  stationName: string;
  name: string;
  isActive: boolean;
}

interface LogRow {
  id: number;
  stationId: string;
  stationName: string;
  staffId: number;
  staffName: string;
  shiftId: number;
  shiftName: string;
  logDate: string;
  scannedAt: number;
  status: "on_time" | "late";
  source: "qr" | "manual";
  note: string | null;
}

type TileStatus = "red" | "green" | "amber";

function tileStatus(s: StationTile, qrLive: boolean): TileStatus {
  if (!s.isActive || s.heartbeatAgeSec === null || s.heartbeatAgeSec > 120) {
    return "red";
  }
  if (qrLive && s.scansToday > 0) return "green";
  return "amber";
}

function fmtAgo(ageSec: number): string {
  if (ageSec < 60) return `${ageSec}s ago`;
  const m = Math.floor(ageSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function fmtClock(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDateTime(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<TileStatus, string> = {
  red: "Offline",
  green: "Live · scanning",
  amber: "Live · no scans",
};

export default function AdminPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [staffRows, setStaffRows] = useState<StaffRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [fStation, setFStation] = useState("");
  const [fShift, setFShift] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fDate, setFDate] = useState(todayDate());
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [loadedFor, setLoadedFor] = useState("");
  const logsLoading = [fStation, fShift, fStatus, fDate].join("|") !== loadedFor;

  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/session")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (!body.authenticated) {
          router.replace("/admin/login");
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/overview");
        if (res.status === 401) {
          router.replace("/admin/login");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Overview;
        if (!cancelled) {
          setOverview(data);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Could not load overview.");
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/admin/shifts").then((r) => r.json()),
      fetch("/api/admin/staff").then((r) => r.json()),
    ])
      .then(([s, st]) => {
        if (cancelled) return;
        setShifts(s.shifts as ShiftRow[]);
        setStaffRows(st.staff as StaffRow[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams();
    if (fStation) qs.set("station", fStation);
    if (fShift) qs.set("shift", fShift);
    if (fStatus) qs.set("status", fStatus);
    if (fDate) qs.set("date", fDate);
    fetch(`/api/admin/logs?${qs.toString()}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          router.replace("/admin/login");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        setLogs(body.logs as LogRow[]);
        setLoadedFor([fStation, fShift, fStatus, fDate].join("|"));
      })
      .catch(() => {
        if (!cancelled) {
          setLogs([]);
          setLoadedFor([fStation, fShift, fStatus, fDate].join("|"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fStation, fShift, fStatus, fDate, router]);

  const downloadCsv = async () => {
    const qs = new URLSearchParams();
    if (fStation) qs.set("station", fStation);
    if (fShift) qs.set("shift", fShift);
    if (fStatus) qs.set("status", fStatus);
    if (fDate) qs.set("date", fDate);
    qs.set("format", "csv");
    const res = await fetch(`/api/admin/logs?${qs.toString()}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qroll-logs-${fDate || "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  };

  const reloadLists = async () => {
    const [s, st] = await Promise.all([
      fetch("/api/admin/shifts").then((r) => r.json()),
      fetch("/api/admin/staff").then((r) => r.json()),
    ]);
    setShifts(s.shifts as ShiftRow[]);
    setStaffRows(st.staff as StaffRow[]);
  };

  if (checking) {
    return (
      <main className={styles.screen}>
        <p className={styles.muted}>Checking session…</p>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.pageTitle}>QRoll Admin</h1>
        <div className={styles.headerActions}>
          {overview && (
            <span className={styles.muted}>
              {overview.qrLive
                ? `${overview.liveWindow?.shiftName} window live`
                : overview.nextWindowAt
                  ? `Next QR ${fmtClock(overview.nextWindowAt)}`
                  : "No shift scheduled"}
            </span>
          )}
          <button className={styles.ghostButton} onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      {error && <p className={styles.errorText}>{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      {overview && (
        <section className={styles.grid}>
          {overview.stations.map((s) => {
            const status = tileStatus(s, overview.qrLive);
            return (
              <article key={s.id} className={`${styles.tile} ${styles[status]}`}>
                <div className={styles.tileHeader}>
                  <span className={styles.tileName}>{s.name}</span>
                  <span className={`${styles.dot} ${styles[status]}`} aria-hidden />
                </div>
                <p className={styles.tileStatus}>{STATUS_LABEL[status]}</p>
                <p className={styles.tileMeta}>
                  {overview.qrLive
                    ? `${overview.liveWindow!.shiftName} ${fmtClock(overview.liveWindow!.windowStart)}–${fmtClock(overview.liveWindow!.windowEnd)}`
                    : "QR window closed"}
                </p>
                <p className={styles.tileMeta}>
                  {s.scansToday} scans today · {s.staffCount} staff
                </p>
                <p className={styles.tileMeta}>
                  {s.heartbeatAgeSec === null
                    ? "no heartbeat yet"
                    : `heartbeat ${fmtAgo(s.heartbeatAgeSec)}`}
                </p>
              </article>
            );
          })}
        </section>
      )}

      <section className={styles.logsSection}>
        <h2 className={styles.sectionTitle}>Attendance log</h2>
        <div className={styles.filters}>
          <select
            className={styles.input}
            value={fStation}
            onChange={(e) => setFStation(e.target.value)}
          >
            <option value="">All stations</option>
            {overview?.stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            className={styles.input}
            value={fShift}
            onChange={(e) => setFShift(e.target.value)}
          >
            <option value="">All shifts</option>
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            className={styles.input}
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="on_time">On time</option>
            <option value="late">Late</option>
          </select>
          <input
            type="date"
            className={styles.input}
            value={fDate}
            onChange={(e) => setFDate(e.target.value)}
          />
          <button className={styles.ghostButton} onClick={() => setFDate(todayDate())}>
            Today
          </button>
          <button className={styles.ghostButton} onClick={downloadCsv}>
            Export CSV
          </button>
        </div>

        {logsLoading && <p className={styles.muted}>Loading…</p>}
        {!logsLoading && logs && logs.length === 0 && (
          <p className={styles.muted}>No entries match the filters.</p>
        )}
        {!logsLoading && logs && logs.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Staff</th>
                  <th>Station</th>
                  <th>Shift</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className={styles.num}>{fmtDateTime(l.scannedAt)}</td>
                    <td>{l.staffName}</td>
                    <td>{l.stationName}</td>
                    <td>{l.shiftName}</td>
                    <td>{l.logDate}</td>
                    <td>
                      <span
                        className={`${styles.badge} ${l.status === "on_time" ? styles.badgeGreen : styles.badgeAmber}`}
                      >
                        {l.status}
                      </span>
                    </td>
                    <td>{l.source}</td>
                    <td className={styles.muted}>{l.note ?? ""}</td>
                    <td>
                      <button
                        className={styles.dangerLink}
                        title="Delete entry"
                        onClick={async () => {
                          if (!confirm(`Delete ${l.staffName}'s entry?`)) return;
                          const res = await fetch(`/api/admin/marks/${l.id}`, {
                            method: "DELETE",
                          });
                          if (res.ok) {
                            setNotice("Entry deleted.");
                            setLoadedFor("");
                          } else {
                            setNotice("Could not delete entry.");
                          }
                        }}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.logsSection}>
        <h2 className={styles.sectionTitle}>Staff</h2>
        <StaffManager
          stations={overview?.stations ?? []}
          staffRows={staffRows}
          onChanged={reloadLists}
          onNotice={setNotice}
        />
      </section>

      <section className={styles.logsSection}>
        <h2 className={styles.sectionTitle}>Stations</h2>
        <StationManager
          stations={overview?.stations ?? []}
          onChanged={() => {
            reloadLists();
            window.location.reload();
          }}
          onNotice={setNotice}
        />
      </section>

      <section className={styles.logsSection}>
        <h2 className={styles.sectionTitle}>Shifts</h2>
        <ShiftManager shifts={shifts} onChanged={reloadLists} onNotice={setNotice} />
      </section>

      <section className={styles.logsSection}>
        <h2 className={styles.sectionTitle}>Manual entry</h2>
        <ManualMark
          stations={overview?.stations ?? []}
          staffRows={staffRows}
          shifts={shifts}
          onAdded={async () => {
            await reloadLists();
            setLoadedFor("");
          }}
          onNotice={setNotice}
        />
      </section>
    </main>
  );
}

function StaffManager({
  stations,
  staffRows,
  onChanged,
  onNotice,
}: {
  stations: StationTile[];
  staffRows: StaffRow[];
  onChanged: () => Promise<void>;
  onNotice: (n: string) => void;
}) {
  const [name, setName] = useState("");
  const [stationId, setStationId] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !stationId || busy) return;
    setBusy(true);
    const res = await fetch("/api/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), stationId }),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      onNotice("Staff member added.");
      await onChanged();
    } else {
      onNotice("Could not add staff member.");
    }
  };

  const toggle = async (s: StaffRow) => {
    const res = await fetch(`/api/admin/staff/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !s.isActive }),
    });
    if (res.ok) {
      onNotice(`${s.name} ${s.isActive ? "disabled" : "enabled"}.`);
      await onChanged();
    }
  };

  const move = async (s: StaffRow, toStation: string) => {
    const res = await fetch(`/api/admin/staff/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stationId: toStation }),
    });
    if (res.ok) {
      onNotice(`${s.name} moved to ${toStation}.`);
      await onChanged();
    }
  };

  return (
    <div>
      <form className={styles.filters} onSubmit={add}>
        <input
          className={styles.input}
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className={styles.input}
          value={stationId}
          onChange={(e) => setStationId(e.target.value)}
        >
          <option value="">Station…</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className={styles.button} type="submit" disabled={busy || !name || !stationId}>
          Add staff
        </button>
      </form>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Station</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {staffRows.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>
                  <select
                    className={styles.inlineSelect}
                    value={s.stationId}
                    onChange={(e) => move(s, e.target.value)}
                  >
                    {stations.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className={s.isActive ? styles.dangerLink : styles.link}
                    onClick={() => toggle(s)}
                  >
                    {s.isActive ? "disable" : "enable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StationManager({
  stations,
  onChanged,
  onNotice,
}: {
  stations: StationTile[];
  onChanged: () => void;
  onNotice: (n: string) => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !name.trim() || busy) return;
    setBusy(true);
    const res = await fetch("/api/admin/stations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id.trim(), name: name.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      const body = await res.json();
      setId("");
      setName("");
      onNotice(`Station created. PIN: ${body.pin}`);
      onChanged();
    } else if (res.status === 409) {
      onNotice("Station ID already exists.");
    } else {
      onNotice("Could not add station.");
    }
  };

  const toggle = async (s: StationTile) => {
    const res = await fetch(`/api/admin/stations/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !s.isActive }),
    });
    if (res.ok) {
      onNotice(`${s.name} ${s.isActive ? "disabled" : "enabled"}.`);
      onChanged();
    }
  };

  const resetPin = async (s: StationTile) => {
    if (!confirm(`Reset PIN for ${s.name}? The kiosk will ask for the new PIN.`)) return;
    const res = await fetch(`/api/admin/stations/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resetPin: true }),
    });
    if (res.ok) {
      const body = await res.json();
      onNotice(`New PIN for ${s.name}: ${body.pin}`);
    }
  };

  return (
    <div>
      <form className={styles.filters} onSubmit={add}>
        <input
          className={styles.input}
          placeholder="Station ID (e.g. s12)"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          className={styles.input}
          placeholder="Station name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className={styles.button} type="submit" disabled={busy || !id || !name}>
          Add station
        </button>
      </form>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>PIN</th>
            </tr>
          </thead>
          <tbody>
            {stations.map((s) => (
              <tr key={s.id}>
                <td>{s.id}</td>
                <td>{s.name}</td>
                <td>
                  <button
                    className={s.isActive ? styles.dangerLink : styles.link}
                    onClick={() => toggle(s)}
                  >
                    {s.isActive ? "disable" : "enable"}
                  </button>
                </td>
                <td>
                  <button className={styles.link} onClick={() => resetPin(s)}>
                    reset PIN
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShiftManager({
  shifts,
  onChanged,
  onNotice,
}: {
  shifts: ShiftRow[];
  onChanged: () => Promise<void>;
  onNotice: (n: string) => void;
}) {
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [qrStartsMin, setQrStartsMin] = useState("45");
  const [qrEndsMin, setQrEndsMin] = useState("30");

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const res = await fetch("/api/admin/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        startTime,
        qrStartsMin: Number(qrStartsMin),
        qrEndsMin: Number(qrEndsMin),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      onNotice("Shift created.");
      await onChanged();
    } else {
      onNotice("Could not add shift.");
    }
  };

  const toggle = async (s: ShiftRow) => {
    const res = await fetch(`/api/admin/shifts/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !s.isActive }),
    });
    if (res.ok) {
      onNotice(`${s.name} ${s.isActive ? "deactivated" : "activated"}.`);
      await onChanged();
    }
  };

  const patch = async (s: ShiftRow, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/shifts/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      onNotice("Shift updated.");
      await onChanged();
    }
  };

  const [busy, setBusy] = useState(false);

  return (
    <div>
      <form className={styles.filters} onSubmit={add}>
        <input
          className={styles.input}
          placeholder="Shift name (e.g. Night)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="time"
          className={styles.input}
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
        />
        <input
          type="number"
          className={styles.input}
          style={{ width: 90 }}
          title="QR starts minutes before"
          value={qrStartsMin}
          onChange={(e) => setQrStartsMin(e.target.value)}
        />
        <input
          type="number"
          className={styles.input}
          style={{ width: 90 }}
          title="QR ends minutes after"
          value={qrEndsMin}
          onChange={(e) => setQrEndsMin(e.target.value)}
        />
        <button className={styles.button} type="submit" disabled={busy || !name}>
          Add shift
        </button>
      </form>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Start</th>
              <th>QR ±min</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>
                  <input
                    type="time"
                    className={styles.inlineSelect}
                    defaultValue={s.startTime}
                    onBlur={(e) => {
                      if (e.target.value !== s.startTime) patch(s, { startTime: e.target.value });
                    }}
                  />
                </td>
                <td className={styles.num}>
                  {s.qrStartsMin} / {s.qrEndsMin}
                </td>
                <td>
                  <button
                    className={s.isActive ? styles.dangerLink : styles.link}
                    onClick={() => toggle(s)}
                  >
                    {s.isActive ? "deactivate" : "activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManualMark({
  stations,
  staffRows,
  shifts,
  onAdded,
  onNotice,
}: {
  stations: StationTile[];
  staffRows: StaffRow[];
  shifts: ShiftRow[];
  onAdded: () => Promise<void>;
  onNotice: (n: string) => void;
}) {
  const [stationId, setStationId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const filteredStaff = staffRows.filter((s) => s.isActive && s.stationId === stationId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stationId || !staffId || !shiftId || busy) return;
    setBusy(true);
    const res = await fetch("/api/admin/marks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stationId,
        staffId: Number(staffId),
        shiftId: Number(shiftId),
        note,
      }),
    });
    setBusy(false);
    if (res.status === 201) {
      setNote("");
      onNotice("Manual entry added.");
      await onAdded();
    } else if (res.status === 409) {
      onNotice("Already marked — that staff member has an entry for this shift.");
    } else {
      onNotice("Could not add manual entry.");
    }
  };

  return (
    <form className={styles.filters} onSubmit={submit}>
      <select
        className={styles.input}
        value={stationId}
        onChange={(e) => {
          setStationId(e.target.value);
          setStaffId("");
        }}
      >
        <option value="">Station…</option>
        {stations.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        className={styles.input}
        value={staffId}
        onChange={(e) => setStaffId(e.target.value)}
      >
        <option value="">Staff…</option>
        {filteredStaff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        className={styles.input}
        value={shiftId}
        onChange={(e) => setShiftId(e.target.value)}
      >
        <option value="">Shift…</option>
        {shifts.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <input
        className={styles.input}
        placeholder="Note (e.g. kiosk offline)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        className={styles.button}
        type="submit"
        disabled={busy || !stationId || !staffId || !shiftId}
      >
        Mark manually
      </button>
    </form>
  );
}
