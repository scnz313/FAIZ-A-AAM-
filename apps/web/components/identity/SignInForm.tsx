"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DEMO_PHONE, STAFF_DEMO_NOTE, identityService } from "@/modules/services/identity";

import styles from "./SignInForm.module.css";

type FieldErrors = {
  identifier?: string;
  password?: string;
  code?: string;
};

type SignInFormProps = {
  /** Runtime data adapter — "supabase" runs the real email-OTP flow. */
  adapter: "demo" | "supabase";
};

const FIELD_IDS: ReadonlyArray<keyof FieldErrors> = ["identifier", "password", "code"];

function fieldId(field: keyof FieldErrors): string {
  return `sign-in-${field}`;
}

/**
 * Sign-in card, adapter-aware (plan.md §10):
 * - Supabase mode: real email-OTP flow — send a code to a verified email,
 *   enter the six-digit code, and land in the portal. The response is
 *   deliberately generic for known/unknown addresses (plan.md §4).
 * - Demo mode: the honest prototype flow (+91 90000 00000, any password of
 *   6+ characters) which moves to the demo verification screen.
 */
export default function SignInForm({ adapter }: SignInFormProps) {
  const router = useRouter();
  const supabaseMode = adapter === "supabase";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [rejected, setRejected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
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
    if (nextStep || codeSent) statusRef.current?.focus();
  }, [nextStep, codeSent]);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (identifier.trim() === "") {
      next.identifier = supabaseMode ? "Enter the email on the account." : "Enter the phone number or email on the account.";
    } else if (supabaseMode && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())) {
      next.identifier = "Enter a valid email address.";
    }
    if (!supabaseMode && password === "") next.password = "Enter your password.";
    else if (!supabaseMode && password.length < 6) next.password = "Password must be at least 6 characters.";
    if (codeSent && code.trim().length !== 6) next.code = "Enter the 6-digit code from the email.";
    return next;
  }

  async function sendCode(): Promise<void> {
    const supabase = createSupabaseBrowserClient();
    const email = identifier.trim();
    const redirectTo = `${window.location.origin}/auth/callback?next=/portal`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error !== null) {
      /* Generic response for known/unknown accounts (plan.md §4). */
      setRejected("The code could not be sent right now — check the address and try again.");
      return;
    }
    setCodeSent(true);
    setRejected(null);
  }

  async function verifyCode(): Promise<void> {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.verifyOtp({
      email: identifier.trim(),
      token: code.trim(),
      type: "email",
    });
    if (error !== null) {
      setRejected("That code is not right — check it and try again.");
      return;
    }
    router.push("/portal");
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
      if (supabaseMode) {
        if (codeSent) {
          await verifyCode();
        } else {
          await sendCode();
        }
        return;
      }
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
          ? "Sign-in was not accepted. Check the details and try again."
          : supabaseMode
            ? "Sign-in form — a code is sent to your email."
            : "Sign-in form — demo account only."}
      </p>

      {codeSent ? (
        <section ref={statusRef} tabIndex={-1} className={styles.success} role="status" aria-live="polite">
          <p className="section-label">Code sent</p>
          <p className={styles.successLine}>
            We&apos;ve emailed a 6-digit code to <strong>{identifier.trim()}</strong>. Enter it below to continue.
          </p>
        </section>
      ) : nextStep ? (
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
              <p className="field-error">{rejected}</p>
              {!supabaseMode && (
                <p className={styles.demoLine}>
                  <span className="demo-badge">Demo</span>
                  <span>
                    Demo account: {DEMO_PHONE}, any password of 6+ characters — real accounts arrive with the
                    backend.
                  </span>
                </p>
              )}
            </div>
          )}

          <div className={`field ${errors.identifier ? "field--invalid" : ""}`}>
            <label htmlFor={fieldId("identifier")}>
              {supabaseMode ? "Email" : "Phone or email"} <span aria-hidden="true">*</span>
            </label>
            <input
              id={fieldId("identifier")}
              className="input"
              type={supabaseMode ? "email" : "tel"}
              inputMode={supabaseMode ? "email" : "tel"}
              autoComplete={supabaseMode ? "email" : "tel"}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={supabaseMode ? "you@example.com" : "+91 …"}
              aria-invalid={errors.identifier !== undefined}
              aria-describedby={errors.identifier ? `${fieldId("identifier")}-error` : undefined}
            />
            {errors.identifier && (
              <p id={`${fieldId("identifier")}-error`} className="field-error">
                {errors.identifier}
              </p>
            )}
          </div>

          {!supabaseMode && (
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
          )}

          {codeSent && (
            <div className={`field ${errors.code ? "field--invalid" : ""}`}>
              <label htmlFor={fieldId("code")}>
                Verification code <span aria-hidden="true">*</span>
              </label>
              <input
                id={fieldId("code")}
                className="input num"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                  setErrors((current) => (current.code ? { ...current, code: undefined } : current));
                }}
                aria-invalid={errors.code !== undefined}
                aria-describedby={errors.code ? `${fieldId("code")}-error` : undefined}
              />
              {errors.code && (
                <p id={`${fieldId("code")}-error`} className="field-error">
                  {errors.code}
                </p>
              )}
              <p className={styles.actionNote}>
                Demo environment: check the email inbox the code was sent to.
              </p>
            </div>
          )}

          <div className={styles.actions}>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting
                ? "Sending…"
                : codeSent
                  ? "Verify code"
                  : supabaseMode
                    ? "Send code"
                    : "Sign in"}
            </Button>
            {!supabaseMode && (
              <p className={styles.actionNote}>Demo account: {DEMO_PHONE} · any password of 6+ characters.</p>
            )}
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
      {!supabaseMode && <p className={styles.staffNote}>{STAFF_DEMO_NOTE}</p>}
    </div>
  );
}
