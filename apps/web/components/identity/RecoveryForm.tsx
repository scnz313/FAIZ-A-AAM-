"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { identityService } from "@/modules/services/identity";
import type { RecoveryResult } from "@/modules/services/identity";

import styles from "./RecoveryForm.module.css";

/**
 * Account recovery. Starts with the phone or email on the account; the demo
 * adapter returns a recovery reference plus the fixed demo reset code, which
 * the UI shows inline (a real backend would send it by SMS/email).
 */
export default function RecoveryForm() {
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const successRef = useRef<HTMLElement>(null);

  /* Move focus to the recovery panel so it is announced and visible. */
  useEffect(() => {
    if (result !== null) successRef.current?.focus();
  }, [result]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (identifier.trim() === "") {
      setError("Enter the phone number or email linked to the account.");
      document.getElementById("recovery-identifier")?.focus();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      setResult(await identityService.startRecovery(identifier.trim()));
    } finally {
      setSubmitting(false);
    }
  }

  if (result !== null) {
    return (
      <section ref={successRef} tabIndex={-1} className={styles.success} role="status" aria-live="polite">
        <p className="section-label">Recovery started</p>
        <p className={styles.successTitle}>Reset reference issued</p>
        <p className={styles.successLine}>
          Reference <strong className="num">{result.ref}</strong>
        </p>
        <p className={styles.demoCode}>
          <span className="demo-badge">Demo</span>
          <span>
            Your reset code is <strong className="num">{result.demoResetCode}</strong> — a real backend sends it by
            SMS or email.
          </span>
        </p>
        <p className={styles.successNote}>
          Use the code at the sign-in screen to reset the password. The office cannot reset passwords over the phone.
        </p>
        <p className={styles.back}>
          <a className="link-arrow" href="/sign-in">
            Back to sign in →
          </a>
        </p>
      </section>
    );
  }

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {error !== null ? "Recovery form has an error." : "Recovery form — phone or email."}
      </p>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={`field ${error !== null ? "field--invalid" : ""}`}>
          <label htmlFor="recovery-identifier">
            Phone or email <span aria-hidden="true">*</span>
          </label>
          <input
            id="recovery-identifier"
            className="input"
            type="text"
            autoComplete="username"
            value={identifier}
            onChange={(event) => {
              setIdentifier(event.target.value);
              setError(null);
            }}
            placeholder="+91 … or you@example.com"
            aria-invalid={error !== null}
            aria-describedby={error !== null ? "recovery-identifier-error" : "recovery-identifier-help"}
          />
          <p id="recovery-identifier-help" className="field-help">
            The phone or email the school has on file for the guardian account.
          </p>
          {error !== null && (
            <p id="recovery-identifier-error" className="field-error">
              {error}
            </p>
          )}
        </div>

        <div className={styles.actions}>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Starting recovery…" : "Start recovery"}
          </Button>
          <p className={styles.actionNote}>
            Demo: any identifier is accepted here; the code is shown on the next panel.
          </p>
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
