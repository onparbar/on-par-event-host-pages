"use client";

import { useState } from "react";

export default function AdminAccessGate() {
  const [pin, setPin] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setError("");

    try {
      const response = await fetch("/api/admin-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ pin }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Unable to unlock admin page.");
      }

      window.location.reload();
    } catch (submitError) {
      setState("error");
      setError(submitError instanceof Error ? submitError.message : "Unable to unlock admin page.");
    }
  }

  return (
    <main className="page admin-gate-page">
      <section className="admin-gate-card">
        <span className="eyebrow">Admin Access</span>
        <h2>Enter Admin PIN</h2>
        <p className="meta">This page requires a 4 digit code before any admin controls are shown.</p>
        <form className="admin-gate-form" onSubmit={handleSubmit}>
          <label className="editor-field">
            <span>4 Digit PIN</span>
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={4}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              pattern="[0-9]{4}"
              type="password"
              value={pin}
            />
          </label>
          <button className="editor-tool admin-gate-submit" disabled={pin.length !== 4 || state === "submitting"} type="submit">
            {state === "submitting" ? "Checking..." : "Unlock Admin"}
          </button>
          {error ? <p className="admin-gate-error">{error}</p> : null}
        </form>
      </section>
    </main>
  );
}
