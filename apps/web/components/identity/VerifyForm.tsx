"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { DEMO_CODE, DemoIdentityError, identityService } from "@/modules/services/identity";
import type { DemoSession } from "@/modules/services/identity";

import styles from "./VerifyForm.module.css";

/**
 * Verification step. One 6-digit code input (numeric, max 6 characters).
 * The demo code is shown inline — a real backend would deliver it by SMS.
 * On success the guardian demo session is stored and the portal opens.
 */
export default function VerifyForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [session, setSession] = useState<DemoSession | null>(null);
  const successRef = useRef<HTMLElement>(null);

  /* Move focus to the signed-in panel so it is announced and visible. */
  useEffect(() => {
    if (session !== null) successRef.current?.focus();
  }, [session]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code shown above.");
      document.getElementById("verify-code")?.focus();
      return;
    }
    setError(null);
    setVerifying(true);
    try {
      setSession(await identityService.verifyCode(code));
    } catch (caught) {
      setError(
        caught instanceof DemoIdentityError ? caught.message : "Verification failed — please try again.",
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
          The session is stored in this browser only — nothing is protected and no data is real.
        </p>
        <div className={styles.successAction}>
          <Button href="/portal" variant="primary">
            Open the portal →
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {error !== null ? "Verification failed — check the code and try again." : "Verification form — 6-digit code."}
      </p>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <p className={styles.demoCode}>
          <span className="demo-badge">Demo</span>
          <span>
            Your code is <strong className="num">{DEMO_CODE}</strong> — a real backend sends it by SMS.
          </span>
        </p>

        <div className={`field ${error !== null ? "field--invalid" : ""}`}>
          <label htmlFor="verify-code">
            Verification code <span aria-hidden="true">*</span>
          </label>
          <input
            id="verify-code"
            className={`input num ${styles.codeInput}`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            pattern="[0-9]{6}"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, ""));
              setError(null);
            }}
            placeholder="000000"
            aria-invalid={error !== null}
            aria-describedby={error !== null ? "verify-code-error" : "verify-code-help"}
          />
          <p id="verify-code-help" className="field-help">
            Six digits — the code shown above.
          </p>
          {error !== null && (
            <p id="verify-code-error" className="field-error">
              {error}
            </p>
          )}
        </div>

        <div className={styles.actions}>
          <Button variant="primary" type="submit" disabled={verifying}>
            {verifying ? "Verifying…" : "Verify code"}
          </Button>
          <p className={styles.actionNote}>Wrong code? Simply enter it again — there is no attempt limit in the demo.</p>
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
