"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import { DEFAULT_STAFF_PORTAL, isStaffPath } from "@/lib/auth/portal-routes";
import { safeAuthRedirect } from "@/lib/auth/redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { adapterCall } from "@/modules/services/adapter-client";
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
  audience?: "family" | "staff";
  navigate?: (href: string) => void;
  /** Whether TOTP/AAL2 is required. When false (dev only), staff sign-in
   *  auto-elevates via /api/auth/mfa/dev-elevate instead of showing the QR. */
  totpRequired?: boolean;
  developmentPasswordAuth?: boolean;
};

const FIELD_IDS: ReadonlyArray<keyof FieldErrors> = ["identifier", "password", "code"];

/** Minimum gap between OTP sends, so the button stays honest about when a
 * fresh code can actually arrive. */
const RESEND_COOLDOWN_SECONDS = 60;

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
export default function SignInForm({
  adapter,
  audience = "family",
  navigate,
  totpRequired = true,
  developmentPasswordAuth = false,
}: SignInFormProps) {
  const router = useRouter();
  const [safeNext, setSafeNext] = useState(audience === "staff" ? DEFAULT_STAFF_PORTAL : "/portal");
  const supabaseMode = adapter === "supabase";
  const staffPasswordMode = supabaseMode && audience === "staff";
  const passwordMode = staffPasswordMode || (supabaseMode && developmentPasswordAuth);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [rejected, setRejected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [resentOnce, setResentOnce] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);
  const [nextStep, setNextStep] = useState(false);
  const statusRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const fallback = audience === "staff" ? DEFAULT_STAFF_PORTAL : "/portal";
    setSafeNext(safeAuthRedirect(new URLSearchParams(window.location.search).get("next"), fallback));
  }, [audience]);

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
    if ((!supabaseMode || passwordMode) && password === "") next.password = "Enter your password.";
    else if (!supabaseMode && password.length < 6) next.password = "Password must be at least 6 characters.";
    else if (passwordMode && password.length < 8) next.password = "Password must be at least 8 characters.";
    if (!passwordMode && codeSent && code.trim().length !== 6) next.code = "Enter the 6-digit code from the email.";
    return next;
  }

  /* Count down the resend cooldown one second at a time. */
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((seconds) => (seconds <= 1 ? 0 : seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  async function sendCode(): Promise<void> {
    const supabase = createSupabaseBrowserClient();
    const email = identifier.trim();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        /* Existing-account sign-in must never silently create an Auth user.
         * Applicant registration is a separate server-controlled path. */
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
      });
      if (error?.status === 429) {
        setRejected("Too many code requests. Wait before trying again.");
        return;
      }
    } catch {
      /* Keep known/unknown/provider errors indistinguishable. The next verify
       * step remains generic and will fail safely if no account exists. */
    }
    setCodeSent(true);
    setResentOnce((already) => already || codeSent);
    setResendIn(RESEND_COOLDOWN_SECONDS);
    setRejected(null);
  }

  async function handleResend(): Promise<void> {
    if (resending || resendIn > 0) return;
    setResending(true);
    try {
      await sendCode();
    } finally {
      setResending(false);
    }
  }

  async function signInWithPassword(): Promise<void> {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: identifier.trim(),
      password,
    });
    if (error !== null) {
      setRejected(error.status === 429 ? "Too many sign-in attempts. Wait before trying again." : "Sign-in could not be accepted. Check your details and try again.");
      return;
    }
    const staffDestination = isStaffPath(safeNext.split("?", 1)[0] ?? "") ? safeNext : DEFAULT_STAFF_PORTAL;
    const destination = audience === "staff" ? staffDestination : safeNext;
    if (audience === "staff" && !totpRequired) {
      /* Dev auto-elevation: programmatically enroll+verify TOTP so the
         session becomes aal2 without scanning a QR (plan.md §4). */
      try {
        const res = await fetch("/api/auth/mfa/dev-elevate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!res.ok) throw new Error("elevation failed");
      } catch {
        setRejected("Sign-in succeeded but dev MFA elevation failed · try again.");
        return;
      }
    }
    const next = audience === "staff" && totpRequired
      ? `/sign-in/totp?next=${encodeURIComponent(destination)}`
      : destination;
    /* Applicants have no family access; the portal guard would only bounce
       them back to sign-in. Their workspace is the application they
       registered to start, exactly as in the verified-code path. */
    if (audience !== "staff" && next === "/portal" && supabaseMode) {
      const applicantCheck = await adapterCall<boolean>("identity.hasApplicant").catch(() => null);
      if (applicantCheck?.ok && applicantCheck.value) {
        if (navigate) navigate("/apply/student");
        else window.location.assign("/apply/student");
        return;
      }
    }
    if (navigate) navigate(next);
    else window.location.assign(next);
  }

  async function verifyCode(): Promise<void> {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.verifyOtp({
      email: identifier.trim(),
      token: code.trim(),
      type: "email",
    });
    if (error !== null) {
      setRejected("That code is not right · check it and try again.");
      return;
    }
    await adapterCall("identity.recordAuthEvent", { event: "signed_in" }).catch(() => null);
    if (supabaseMode) {
      /* Staff accounts continue to the TOTP gate (plan.md §4); everyone
         else lands in the portal. A non-staff context is the normal case. */
      try {
        const staffCheck = await adapterCall<boolean>("identity.hasStaff");
        if (staffCheck.ok && staffCheck.value) {
          if (!totpRequired) {
            await fetch("/api/auth/mfa/dev-elevate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            }).catch(() => null);
          }
          router.push(totpRequired ? `/sign-in/totp?next=${encodeURIComponent(safeNext)}` : safeNext);
          return;
        }
        /* Applicants have no guardian role until conversion completes; their
           workspace is the application they registered to start. */
        const applicantCheck = await adapterCall<boolean>("identity.hasApplicant");
        if (applicantCheck.ok && applicantCheck.value && safeNext === "/portal") {
          router.push("/apply/student");
          return;
        }
        router.push(safeNext);
        return;
      } catch {
        /* Network hiccup after a successful sign-in still opens the portal;
           server-side RLS re-authorizes every protected page anyway. */
      }
    }
    router.push(safeNext);
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
        if (passwordMode) {
          await signInWithPassword();
        } else if (codeSent) {
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
          : codeSent
            ? resentOnce
              ? "If an account exists, a new code has been sent to your email."
              : "If an account exists, a 6-digit code has been sent to your email. Enter it below."
            : passwordMode
              ? audience === "staff"
                ? "Staff sign-in form · email and password."
                : "Guardian sign-in form · email and password."
              : supabaseMode
                ? "Sign-in form · a code is sent to your email."
                : "Sign-in form · demo account only."}
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
            Sign-in accepted · a verification code is on the next screen. <span className="demo-badge">Demo</span>
          </p>
        </section>
      ) : (
        <>
          {codeSent ? (
            <section ref={statusRef} tabIndex={-1} className={styles.success} role="status" aria-live="polite">
              <p className="section-label">Code sent</p>
              <p className={styles.successLine}>
                If an account exists for <strong>{identifier.trim()}</strong>, we&apos;ve sent a 6-digit code. Enter it below to continue.
              </p>
            </section>
          ) : null}
          <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {rejected !== null && (
            <div className={styles.summary} role="alert">
              <p className="field-error">{rejected}</p>
              {!supabaseMode && (
                <p className={styles.demoLine}>
                  <span className="demo-badge">Demo</span>
                  <span>
                    Demo account: {DEMO_PHONE}, any password of 6+ characters · real accounts arrive with the
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

          {(!supabaseMode || passwordMode) && (
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

          {!passwordMode && codeSent && (
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
              <div className={styles.resendRow}>
                <Button
                  variant="quiet"
                  onClick={() => void handleResend()}
                  disabled={resending || resendIn > 0}
                >
                  {resending ? "Sending…" : resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                </Button>
                <p className={styles.actionNote}>
                  {resendIn > 0
                    ? "You can request a fresh code when the countdown ends."
                    : "No email yet? Request a new code · the newest one replaces the old."}
                </p>
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting
                ? passwordMode
                  ? "Signing in…"
                  : "Sending…"
                : passwordMode
                  ? "Sign in"
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
        </>
      )}

      <div className={styles.links}>
        {supabaseMode && !staffPasswordMode ? (
          <Link className="link-arrow" prefetch={false} href={`/register/applicant?purpose=${safeNext.startsWith("/apply/job") ? "job_application" : "student_admission"}&next=${encodeURIComponent(safeNext)}`}>
            New applicant? Create an account →
          </Link>
        ) : null}
        <Link className="link-arrow" prefetch={false} href="/sign-in/recovery">
          Forgot password →
        </Link>
        {supabaseMode ? (
          <Link className="link-arrow" prefetch={false} href={staffPasswordMode ? "/sign-in" : "/sign-in/staff"}>
            {staffPasswordMode ? "Family or applicant sign in →" : "Staff sign in →"}
          </Link>
        ) : (
          <Link className="link-arrow" prefetch={false} href={DEFAULT_STAFF_PORTAL}>
            Demo staff access →
          </Link>
        )}
      </div>
      {!supabaseMode && <p className={styles.staffNote}>{STAFF_DEMO_NOTE}</p>}
    </div>
  );
}
