"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import QRCode from "qrcode";

import styles from "./kiosk.module.css";

interface TokenResponse {
  token: string | null;
  expiresAt?: number;
  refreshInSec?: number;
  stationName: string;
  shift?: { id: number; name: string; startTime: string };
  isActive: boolean;
  nextWindowAt?: number | null;
  logDate?: string;
  scanCountToday?: number;
}

const POLL_MS = 30_000;

function fmtClock(sec: number): string {
  if (sec <= 0) return "0s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtHm(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
  });
}

function fmtCountdown(sec: number): string {
  if (sec <= 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function useStoredPin(stationId: string): string | null {
  return useSyncExternalStore(
    () => () => {},
    () =>
      typeof window === "undefined"
        ? null
        : localStorage.getItem(`kiosk:pin:${stationId}`),
    () => null
  );
}

export default function KioskPage() {
  const params = useParams<{ stationId: string }>();
  const stationId = params.stationId;
  const storedPin = useStoredPin(stationId);

  const [enteredPin, setEnteredPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [manualPin, setManualPin] = useState<string | null>(null);
  const activePin = manualPin ?? storedPin;

  const [stationName, setStationName] = useState<string | null>(null);
  const [shiftName, setShiftName] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [nextWindowAt, setNextWindowAt] = useState<number | null>(null);
  const [scanCountToday, setScanCountToday] = useState(0);
  const [scanDelta, setScanDelta] = useState(0);

  const [offline, setOffline] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  const [nextPollAt, setNextPollAt] = useState(() => Date.now() + POLL_MS);

  const failCountRef = useRef(0);
  const prevScanCount = useRef<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!stationId || !activePin) return;
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch("/api/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stationId, pin: activePin }),
        });
        if (cancelled) return;
        if (res.status === 401) {
          localStorage.removeItem(`kiosk:pin:${stationId}`);
          setManualPin(null);
          setPinError("PIN rejected — station PIN may have changed.");
          return;
        }
        if (res.status === 403) {
          setManualPin(null);
          setPinError("This station is disabled by the admin.");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: TokenResponse = await res.json();
        failCountRef.current = 0;
        setOffline(false);
        setStationName(data.stationName);
        setShiftName(data.shift?.name ?? null);
        setActive(data.isActive);
        setToken(data.token);
        setExpiresAt(data.expiresAt ?? 0);
        setNextWindowAt(data.nextWindowAt ?? null);
        if (typeof data.scanCountToday === "number") {
          const scans = data.scanCountToday;
          const prev = prevScanCount.current;
          if (prev !== null && scans > prev) {
            setScanDelta(scans - prev);
          }
          prevScanCount.current = scans;
          setScanCountToday(scans);
        }
        setNextPollAt(Date.now() + POLL_MS);
      } catch {
        failCountRef.current += 1;
        if (failCountRef.current >= 2) {
          setOffline(true);
          setToken(null);
        }
      }
    }

    void tick();
    const interval = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [stationId, activePin]);

  useEffect(() => {
    if (!token) return;
    const qrText = `${window.location.origin}/scan?t=${token}`;
    QRCode.toDataURL(qrText, {
      width: 480,
      margin: 2,
      color: { dark: "#0a0a0a", light: "#ffffff" },
    })
      .then(setQrUrl)
      .catch(() => setQrUrl(null));
  }, [token]);

  useEffect(() => {
    if (!scanDelta) return;
    const t = setTimeout(() => setScanDelta(0), 5000);
    return () => clearTimeout(t);
  }, [scanDelta]);

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    if (!enteredPin.trim()) {
      setPinError("Enter the station PIN.");
      return;
    }
    try {
      const res = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationId, pin: enteredPin }),
      });
      if (res.status === 401) {
        setPinError("Invalid station PIN.");
        return;
      }
      if (res.status === 403) {
        setPinError("This station is disabled by the admin.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TokenResponse = await res.json();
      localStorage.setItem(`kiosk:pin:${stationId}`, enteredPin);
      prevScanCount.current =
        typeof data.scanCountToday === "number" ? data.scanCountToday : null;
      setManualPin(enteredPin);
      setEnteredPin("");
    } catch {
      setPinError("Could not reach the server. Try again.");
    }
  };

  const resetPin = () => {
    localStorage.removeItem(`kiosk:pin:${stationId}`);
    setManualPin(null);
    setOffline(false);
    failCountRef.current = 0;
  };

  const secUntilPoll = Math.max(0, Math.ceil((nextPollAt - now) / 1000));
  const secUntilExpiry = expiresAt ? Math.max(0, expiresAt - Math.floor(now / 1000)) : 0;
  const secUntilWindow = nextWindowAt
    ? Math.max(0, nextWindowAt - Math.floor(now / 1000))
    : 0;

  if (!activePin) {
    return (
      <main className={styles.pinScreen}>
        <form onSubmit={submitPin} className={styles.pinCard}>
          <h1 className={styles.pinTitle}>Station {stationId}</h1>
          <p className={styles.pinSubtitle}>Enter the station PIN to start</p>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={enteredPin}
            onChange={(e) => setEnteredPin(e.target.value)}
            className={styles.pinInput}
            placeholder="••••"
            maxLength={6}
          />
          {pinError && <p className={styles.pinError}>{pinError}</p>}
          <button type="submit" className={styles.pinButton}>
            Unlock
          </button>
        </form>
      </main>
    );
  }

  const clockLabel = new Date(now).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.station}>
          <span className={styles.stationName}>
            {stationName ?? `Station ${stationId}`}
          </span>
          {shiftName && <span className={styles.shiftName}>{shiftName} shift</span>}
        </div>
        <div className={styles.clock}>{clockLabel}</div>
      </header>

      {offline && (
        <div className={styles.offlineBanner} role="alert">
          OFFLINE — check the station PC connection
        </div>
      )}

      <div className={styles.body}>
        {active && token && qrUrl ? (
          <>
            <div className={styles.qrCard}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="Attendance QR" className={styles.qrImage} />
            </div>
            <p className={styles.qrHint}>Scan to mark attendance</p>
            <p className={styles.countdown}>Refreshing in {fmtClock(secUntilPoll)}</p>
            {secUntilExpiry > 0 && secUntilExpiry < 45 && (
              <p className={styles.expiry}>QR expires in {fmtClock(secUntilExpiry)}</p>
            )}
          </>
        ) : active && !offline ? (
          <p className={styles.waiting}>Loading QR…</p>
        ) : !offline ? (
          <>
            <p className={styles.nextQr}>
              Next QR at {nextWindowAt ? fmtHm(nextWindowAt) : "—"}
            </p>
            {nextWindowAt && (
              <p className={styles.windowCountdown}>{fmtCountdown(secUntilWindow)}</p>
            )}
            <p className={styles.qrHint}>QR appears when the shift window opens</p>
          </>
        ) : null}
      </div>

      <footer className={styles.footer}>
        {scanCountToday > 0 && (
          <span className={styles.scanCount}>
            {scanCountToday} scan{scanCountToday === 1 ? "" : "s"} today
          </span>
        )}
        <button onClick={resetPin} className={styles.lockButton} aria-label="Lock kiosk">
          🔒
        </button>
      </footer>

      {scanDelta > 0 && (
        <div className={styles.toast} role="status">
          ✓ New scan recorded ({scanCountToday} today)
        </div>
      )}
    </main>
  );
}
