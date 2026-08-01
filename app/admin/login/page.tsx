"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import styles from "../admin.module.css";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/admin");
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setError(`Too many attempts. Locked for ${body.retryAfterSec ?? 900}s.`);
      } else if (res.status === 401) {
        setError(
          body.remaining > 0
            ? `Wrong password. ${body.remaining} attempts left.`
            : "Wrong password. Locked for 15 minutes."
        );
      } else {
        setError("Something went wrong. Try again.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.loginScreen}>
      <form className={styles.loginCard} onSubmit={submit}>
        <h1 className={styles.loginTitle}>QRoll Admin</h1>
        <p className={styles.loginHint}>Head office sign-in</p>
        <input
          type="password"
          autoFocus
          className={styles.input}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        {error && <p className={styles.errorText}>{error}</p>}
        <button type="submit" className={styles.button} disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
