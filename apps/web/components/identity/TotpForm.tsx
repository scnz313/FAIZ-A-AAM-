"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import { safeAuthRedirect } from "@/lib/auth/redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import styles from "./TotpForm.module.css";

/**
 * Staff TOTP second factor against the real Supabase session (plan.md §4).
 * First visit enrolls a factor (QR / manual key, then one code); later visits
 * go straight to challenge + verify. Demo sign-ins never reach this form, so
 * the demo adapter renders an honest "sign in with a demo identity instead"
 * state and never touches the Supabase client.
 */

type Phase = "checking" | "enroll" | "challenge" | "error";

const CODE_PATTERN = /^\d{6}$/;

export default function TotpForm({ adapter }: { adapter?: "demo" | "supabase" }) {
  const router = useRouter();
  const demoMode = adapter !== "supabase";
  const [safeNext, setSafeNext] = useState("/staff");
  const [phase, setPhase] = useState<Phase>("checking");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [rejected, setRejected] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSafeNext(safeAuthRedirect(new URLSearchParams(window.location.search).get("next"), "/staff"));
  }, []);

  useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    async function start() {
      const supabase = createSupabaseBrowserClient();
      try {
        const { data } = await supabase.auth.mfa.listFactors();
        if (cancelled) return;
        const existing = data?.totp ?? [];
        if (existing.length > 0 && existing[0] !== undefined) {
          setFactorId(existing[0].id);
          setPhase("challenge");
          return;
        }
        const { data: enrolled, error } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Staff access",
        });
        if (cancelled) return;
        if (error !== null || enrolled === null) {
          setFatal("Setup could not start — restart sign-in and try again.");
          setPhase("error");
          return;
        }
        setFactorId(enrolled.id);
        setQrUri(enrolled.totp?.qr_code ?? null);
        setSecret(enrolled.totp?.secret ?? null);
        setPhase("enroll");
      } catch {
        if (!cancelled) {
          setFatal("Sign-in state could not be read — restart sign-in.");
          setPhase("error");
        }
      }
    }
    void start();
    return () => {
      cancelled = true;
    };
  }, [demoMode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demoMode) return;
    const trimmed = code.trim();
    if (!CODE_PATTERN.test(trimmed) || factorId === null || busy) return;
    setBusy(true);
    setRejected(null);
    const supabase = createSupabaseBrowserClient();
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError !== null || challenge === null) throw new Error("challenge failed");
      const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: trimmed });
      if (error !== null) {
        setRejected("That code is not right — check your authenticator and try again.");
        setCode("");
        codeRef.current?.focus();
        return;
      }
      const recorded = await fetch("/api/auth/mfa/verified", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!recorded.ok) throw new Error("MFA record failed");
      router.push(safeNext);
      router.refresh();
    } catch {
      setRejected("Verification could not complete — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (demoMode) {
    return (
      <div>
        <p className={styles.stepNote}>
          <span className="section-label">Demo sign-in</span>
          Two-step verification is part of the school sign-in service. Demo identities sign in directly — pick a
          demo guardian or staff identity from the sign-in screen instead.
        </p>
        <p className={styles.back}>
          <a className="link-arrow" href="/sign-in">
            ← Back to sign-in
          </a>
        </p>
      </div>
    );
  }

  if (phase === "checking") {
    return <p className="field-help">Checking your authenticator setup…</p>;
  }

  if (phase === "error") {
    return (
      <div>
        <p className="field-error" role="alert">
          {fatal}
        </p>
        <p className={styles.back}>
          <a className="link-arrow" href="/sign-in">
            ← Restart sign-in
          </a>
        </p>
      </div>
    );
  }

  return (
    <div>
      {phase === "enroll" ? (
        <>
          <p className={styles.stepNote}>
            <span className="section-label">One-time setup</span>
            Add this key with your authenticator app, then confirm the six-digit code it shows.
          </p>
          {qrUri !== null ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={qrUri} alt="Authenticator setup QR code" width={180} height={180} className={styles.qr} />
          ) : null}
          {secret !== null ? (
            <div className={`field ${rejected !== null ? "field--invalid" : ""}`}>
              <span className="field-help">Can&apos;t scan? Enter this key manually:</span>
              <code className={styles.secretKey}>{secret}</code>
            </div>
          ) : null}
        </>
      ) : (
        <p className={styles.stepNote}>
          <span className="section-label">Verify</span> Enter the current code from your authenticator app.
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className={`field ${rejected !== null ? "field--invalid" : ""}`}>
          <label htmlFor="totp-code">
            Six-digit code <span aria-hidden="true">*</span>
          </label>
          <input
            id="totp-code"
            ref={codeRef}
            className={`input num ${styles.codeInput}`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            pattern="[0-9]{6}"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, ""));
              setRejected(null);
            }}
            placeholder="000000"
            aria-invalid={rejected !== null}
            aria-describedby={rejected !== null ? "totp-code-error" : "totp-code-help"}
            autoFocus
            required
          />
          <p id="totp-code-help" className="field-help">
            Six digits from your authenticator app.
          </p>
          {rejected !== null && (
            <p id="totp-code-error" className="field-error" role="alert">
              {rejected}
            </p>
          )}
        </div>

        <div className={styles.actions}>
          <Button variant="primary" type="submit" disabled={busy || !CODE_PATTERN.test(code.trim())}>
            {busy ? "Verifying…" : phase === "enroll" ? "Finish setup and continue" : "Verify and continue"}
          </Button>
          <p className="field-help">Each code works once — a fresh one appears in your app every 30 seconds.</p>
        </div>
      </form>

      <p className={styles.back}>
        <a className="link-arrow" href="/sign-in">
          ← Back to sign in
        </a>
      </p>
    </div>
  );
}
