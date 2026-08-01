"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import styles from "./scan.module.css";

interface ShiftInfo {
  id: number;
  name: string;
  startTime: string;
}

interface ScanInfo {
  stationId: string;
  stationName: string;
  shift: ShiftInfo;
  expiresAt: number;
  staff: { id: number; name: string }[];
}

type Screen =
  | { kind: "loading" }
  | { kind: "error"; title: string; detail: string }
  | { kind: "pick"; info: ScanInfo; now: number }
  | { kind: "marking"; info: ScanInfo; staffName: string }
  | {
      kind: "success";
      status: "on_time" | "late";
      scannedAt: number;
      stationName: string;
      shiftName: string;
      staffName: string;
    }
  | {
      kind: "duplicate";
      scannedAt: number;
      status: "on_time" | "late";
      stationName: string;
      shiftName: string;
      staffName: string;
    };

function fmtTime(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ScanClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("t") ?? "";

  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`/api/scan/info?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setScreen({ kind: "error", title: "Token expired", detail: "The QR expired. Scan a fresh one on the station screen." });
          return;
        }
        if (res.status === 400) {
          const body = await res.json().catch(() => ({}));
          if (body.error === "no_active_shift") {
            setScreen({ kind: "error", title: "Window closed", detail: "The shift window has closed. See the station supervisor." });
          } else {
            setScreen({ kind: "error", title: "Invalid QR", detail: "This QR is not valid. Scan the QR shown on the station screen." });
          }
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const info: ScanInfo = await res.json();
        setScreen({ kind: "pick", info, now: Date.now() });
        const saved = localStorage.getItem(`scan:identity:${info.stationId}`);
        if (saved) {
          const parsed = JSON.parse(saved) as { id: number };
          if (info.staff.some((s) => s.id === parsed.id)) {
            setSelectedStaffId(parsed.id);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setScreen({ kind: "error", title: "No connection", detail: "Could not reach the server. Check your internet and try again." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const expiresAt = screen.kind === "pick" ? screen.info.expiresAt : 0;
  useEffect(() => {
    if (screen.kind !== "pick") return;
    const t = setInterval(() => setScreen((s) => (s.kind === "pick" ? { ...s, now: Date.now() } : s)), 1000);
    return () => clearInterval(t);
  }, [screen.kind, expiresAt]);

  const mark = async () => {
    if (screen.kind !== "pick" || selectedStaffId === null) return;
    const staffName = screen.info.staff.find((s) => s.id === selectedStaffId)?.name ?? "";
    setScreen({ kind: "marking", info: screen.info, staffName });
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, staffId: selectedStaffId }),
      });
      if (res.status === 409) {
        const body = await res.json();
        setScreen({
          kind: "duplicate",
          scannedAt: body.scannedAt ?? Math.floor(Date.now() / 1000),
          status: body.status ?? "on_time",
          stationName: screen.info.stationName,
          shiftName: screen.info.shift.name,
          staffName,
        });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const title =
          body.error === "token_expired"
            ? "Token expired"
            : body.error === "staff_not_at_station"
              ? "Wrong station"
              : body.error === "staff_inactive"
                ? "Account disabled"
                : "Could not mark";
        setScreen({
          kind: "error",
          title,
          detail:
            body.error === "no_active_shift"
              ? "The shift window has closed."
              : "Please try again or see the station supervisor.",
        });
        return;
      }
      const body = await res.json();
      localStorage.setItem(`scan:identity:${screen.info.stationId}`, JSON.stringify({ id: selectedStaffId }));
      setScreen({
        kind: "success",
        status: body.status,
        scannedAt: body.scannedAt,
        stationName: body.stationName,
        shiftName: body.shiftName,
        staffName: body.staffName,
      });
    } catch {
      setScreen({ kind: "error", title: "No connection", detail: "Could not reach the server. Try again." });
    }
  };

  const retry = () => {
    setSelectedStaffId(null);
    setScreen({ kind: "loading" });
    window.location.reload();
  };

  if (!token) {
    return (
      <main className={styles.screen}>
        <div className={styles.card}>
          <div className={styles.errorIcon} aria-hidden>
            !
          </div>
          <h1 className={styles.title}>Missing token</h1>
          <p className={styles.muted}>Scan the QR on the station screen.</p>
        </div>
      </main>
    );
  }

  switch (screen.kind) {
    case "loading":
      return (
        <main className={styles.screen}>
          <div className={styles.card}>
            <div className={styles.spinner} aria-hidden />
            <p className={styles.muted}>Validating QR…</p>
          </div>
        </main>
      );

    case "error":
      return (
        <main className={styles.screen}>
          <div className={styles.card}>
            <div className={styles.errorIcon} aria-hidden>
              !
            </div>
            <h1 className={styles.title}>{screen.title}</h1>
            <p className={styles.muted}>{screen.detail}</p>
            <button onClick={retry} className={styles.button}>
              Try again
            </button>
          </div>
        </main>
      );

    case "pick": {
      const info = screen.info;
      const secsLeft = Math.max(0, info.expiresAt - Math.floor(screen.now / 1000));
      return (
        <main className={styles.screen}>
          <div className={styles.card}>
            <p className={styles.stationName}>{info.stationName}</p>
            <p className={styles.shiftName}>
              {info.shift.name} shift · starts {info.shift.startTime}
            </p>
            <p className={styles.expiry}>
              {secsLeft > 0 ? `QR expires in ${secsLeft}s` : "QR expired — refresh the station screen"}
            </p>

            <label className={styles.label} htmlFor="staff">
              Who are you?
            </label>
            <select
              id="staff"
              className={styles.select}
              value={selectedStaffId ?? ""}
              onChange={(e) => setSelectedStaffId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="" disabled>
                Select your name…
              </option>
              {info.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <button
              onClick={mark}
              disabled={selectedStaffId === null}
              className={styles.button}
            >
              Mark attendance
            </button>
            <p className={styles.hint}>
              Your identity is remembered on this phone for next time.
            </p>
          </div>
        </main>
      );
    }

    case "marking":
      return (
        <main className={styles.screen}>
          <div className={styles.card}>
            <div className={styles.spinner} aria-hidden />
            <p className={styles.muted}>Marking {screen.staffName}…</p>
          </div>
        </main>
      );

    case "success":
      return (
        <main className={styles.screen}>
          <div className={`${styles.card} ${styles.successCard}`}>
            <div className={styles.checkIcon} aria-hidden>
              ✓
            </div>
            <h1 className={styles.title}>
              {screen.status === "on_time" ? "On time" : "Late"}
            </h1>
            <p className={styles.bigTime}>{fmtTime(screen.scannedAt)}</p>
            <p className={styles.muted}>
              {screen.staffName} · {screen.stationName} · {screen.shiftName}
            </p>
          </div>
        </main>
      );

    case "duplicate":
      return (
        <main className={styles.screen}>
          <div className={styles.card}>
            <div className={styles.dupIcon} aria-hidden>
              i
            </div>
            <h1 className={styles.title}>Already marked</h1>
            <p className={styles.bigTime}>{fmtTime(screen.scannedAt)}</p>
            <p className={styles.muted}>
              {screen.staffName} was marked {screen.status === "on_time" ? "on time" : "late"} today at {screen.stationName}.
            </p>
          </div>
        </main>
      );
  }
}

export default function ScanPage() {
  return (
    <Suspense fallback={null}>
      <ScanClient />
    </Suspense>
  );
}
