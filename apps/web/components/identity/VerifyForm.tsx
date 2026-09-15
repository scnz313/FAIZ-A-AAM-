"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";

import Button from "@/components/ui/Button";
import { DEMO_CODE, DemoIdentityError, identityService } from "@/modules/services/identity";
import type { DemoSession } from "@/modules/services/identity";

import styles from "./VerifyForm.module.css";

/**
 * Verification step. V14-style 6 individual OTP boxes, each accepting one
 * digit, with auto-advance and backspace navigation. The demo code is shown
 * inline — a real backend would deliver it by SMS. On success the guardian
 * demo session is stored and the portal opens.
 */
export default function VerifyForm() {
  const [code, setCode] = useState<string[]>(["", "", "", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [session, setSession] = useState<DemoSession | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const successRef = useRef<HTMLElement>(null);

  /* Move focus to the signed-in panel so it is announced and visible. */
  useEffect(() => {
    if (session !== null) successRef.current?.focus();
  }, [session]);

  function setDigit(i: number, v: string) {
    const clean = v.replace(/\D/g, "").slice(-1);
    const next = [...code];
    next[i] = clean;
    setCode(next);
    setError(null);
    if (clean && i < 5) inputs.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !code[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const joined = code.join("");
    if (!/^\d{6}$/.test(joined)) {
      setError("Enter all 6 digits.");
      inputs.current[0]?.focus();
      return;
    }
    setError(null);
    setVerifying(true);
    try {
      setSession(await identityService.verifyCode(joined));
    } catch (caught) {
      setError(
        caught instanceof DemoIdentityError ? caught.message : "Verification failed · please try again.",
      );
    } finally {
      setVerifying(false);
    }
  }

  if (session !== null) {
    return (
      <section ref={successRef} tabIndex={-1} className={styles.success} role="status" aria-live="polite">
        <p className="section-label">Verification complete</p>
        <p className={styles.successLine}>
          Signed in as {session.name} <span className="demo-badge">demo session</span>
        </p>
        <p className={styles.successNote}>
          The session is stored in this browser only · nothing is protected and no data is real.
        </p>
        <div className={styles.successAction}>
          <Button href="/portal" variant="primary">
            Open the portal →
          </Button>
        </div>
      </section>
    );
  }

  const complete = code.every((c) => c);

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {error !== null ? "Verification failed · check the code and try again." : "Verification form · 6-digit code."}
      </p>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <p className={styles.demoCode}>
          <span className="demo-badge">Demo</span>
          <span>
            Your code is <strong className="num">{DEMO_CODE}</strong> · a real backend sends it by SMS.
          </span>
        </p>

        {error !== null && (
          <p className={styles.errorLine} role="alert">
            {error}
          </p>
        )}

        <div className={styles.otpRow}>
          {code.map((c, i) => (
            <input
              key={i}
              ref={(el) => { inputs.current[i] = el; }}
              className={styles.otp}
              type="text"
              inputMode="numeric"
              aria-label={`Digit ${i + 1}`}
              maxLength={1}
              value={c}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
            />
          ))}
        </div>

        <div className={styles.actions}>
          <Button variant="primary" type="submit" disabled={verifying || !complete} className={styles.submitBtn}>
            {verifying ? "Verifying…" : "Verify and continue"}
          </Button>
        </div>
      </form>

      <p className={styles.back}>
        <Link className="link-arrow" prefetch={false} href="/sign-in">
          ← Back to sign in
        </Link>
      </p>
    </div>
  );
}
