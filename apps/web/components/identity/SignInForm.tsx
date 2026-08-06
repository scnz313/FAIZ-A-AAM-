"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import { DEMO_PHONE, STAFF_DEMO_NOTE, identityService } from "@/modules/services/identity";

import styles from "./SignInForm.module.css";

type FieldErrors = {
  identifier?: string;
  password?: string;
};

const FIELD_IDS: ReadonlyArray<keyof FieldErrors> = ["identifier", "password"];

function fieldId(field: keyof FieldErrors): string {
  return `sign-in-${field}`;
}

/**
 * Sign-in card. Submits through the typed identity service: the demo account
 * (+91 90000 00000, any password of 6+ characters) moves to verification;
 * anything else shows the rejection summary. On acceptance the page shows a
 * short next-step line and routes to /sign-in/verify. UI demo — this is not
 * real authentication and no data is protected.
 */
export default function SignInForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [rejected, setRejected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nextStep, setNextStep] = useState(false);
  const statusRef = useRef<HTMLElement>(null);

  /* Route to verification once the acceptance line has been announced. */
  useEffect(() => {
    if (!nextStep) return;
    const timer = setTimeout(() => router.push("/sign-in/verify"), 600);
    return () => clearTimeout(timer);
  }, [nextStep, router]);

  /* Move focus to the acceptance line so it is announced and visible. */
  useEffect(() => {
    if (nextStep) statusRef.current?.focus();
  }, [nextStep]);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (identifier.trim() === "") next.identifier = "Enter the phone number or email on the account.";
    if (password === "") next.password = "Enter your password.";
    else if (password.length < 6) next.password = "Password must be at least 6 characters.";
    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRejected(null);
    const next = validate();
    setErrors(next);
    const firstInvalid = FIELD_IDS.find((field) => next[field] !== undefined);
    if (firstInvalid !== undefined) {
      document.getElementById(fieldId(firstInvalid))?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const result = await identityService.signIn(identifier.trim(), password);
      if (!result.ok) {
        setRejected(result.reason);
        return;
      }
      setNextStep(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {rejected !== null
          ? "Sign-in was not accepted. Check the phone number and password."
          : "Sign-in form — demo account only."}
      </p>

      {nextStep ? (
        <section
          ref={statusRef}
          tabIndex={-1}
          className={styles.success}
          role="status"
          aria-live="polite"
        >
          <p className="section-label">Next step</p>
          <p className={styles.successLine}>
            Sign-in accepted — a verification code is on the next screen. <span className="demo-badge">Demo</span>
          </p>
        </section>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {rejected !== null && (
            <div className={styles.summary} role="alert">
              <p className="field-error">
                {rejected} Demo account: {DEMO_PHONE}, any password.
              </p>
              <p className={styles.demoLine}>
                <span className="demo-badge">Demo</span>
                <span>The demo accepts only that account — real accounts arrive with the backend.</span>
              </p>
            </div>
          )}

          <div className={`field ${errors.identifier ? "field--invalid" : ""}`}>
            <label htmlFor={fieldId("identifier")}>
              Phone or email <span aria-hidden="true">*</span>
            </label>
            <input
              id={fieldId("identifier")}
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="+91 …"
              aria-invalid={errors.identifier !== undefined}
              aria-describedby={errors.identifier ? `${fieldId("identifier")}-error` : undefined}
            />
            {errors.identifier && (
              <p id={`${fieldId("identifier")}-error`} className="field-error">
                {errors.identifier}
              </p>
            )}
          </div>

          <div className={`field ${errors.password ? "field--invalid" : ""}`}>
            <label htmlFor={fieldId("password")}>
              Password <span aria-hidden="true">*</span>
            </label>
            <input
              id={fieldId("password")}
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={errors.password !== undefined}
              aria-describedby={errors.password ? `${fieldId("password")}-error` : undefined}
            />
            {errors.password && (
              <p id={`${fieldId("password")}-error`} className="field-error">
                {errors.password}
              </p>
            )}
          </div>

          <div className={styles.actions}>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
            <p className={styles.actionNote}>Demo account: {DEMO_PHONE} · any password of 6+ characters.</p>
          </div>
        </form>
      )}

      <div className={styles.links}>
        <a className="link-arrow" href="/sign-in/recovery">
          Forgot password →
        </a>
        <a className="link-arrow" href="/staff">
          Demo staff access →
        </a>
      </div>
      <p className={styles.staffNote}>{STAFF_DEMO_NOTE}</p>
    </div>
  );
}
