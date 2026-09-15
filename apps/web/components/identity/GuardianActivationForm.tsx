"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { guardiansService, type GuardianActivationPreview } from "@/modules/services/guardians";

import styles from "./StaffInvitationForm.module.css";

type FieldErrors = {
  givenName?: string;
  familyName?: string;
  password?: string;
  confirmation?: string;
};

export default function GuardianActivationForm({
  token,
  preview,
  passwordMode,
  navigate,
}: {
  token: string;
  preview: GuardianActivationPreview & { valid: true };
  passwordMode: boolean;
  navigate?: (href: string) => void;
}) {
  const [givenName, setGivenName] = useState(preview.givenName ?? "");
  const [familyName, setFamilyName] = useState(preview.familyName ?? "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): FieldErrors {
    return {
      givenName: givenName.trim() ? undefined : "Enter your given name.",
      familyName: familyName.trim() ? undefined : "Enter your family name.",
      password: passwordMode && (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
        ? "Use at least 8 characters with a letter and a number."
        : undefined,
      confirmation: passwordMode && confirmation !== password ? "The passwords do not match." : undefined,
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const next = validate();
    setErrors(next);
    if (Object.values(next).some((value) => value !== undefined)) return;
    setBusy(true);
    try {
      if (passwordMode) {
        const { error: passwordError } = await createSupabaseBrowserClient().auth.updateUser({ password });
        if (passwordError !== null && passwordError.code !== "same_password") {
          if (passwordError.code === "weak_password") {
            setErrors((current) => ({ ...current, password: "Choose a longer password with letters and numbers." }));
            return;
          }
          if (passwordError.code === "session_not_found" || passwordError.status === 401) {
            setError("Open the activation email and use its link before completing this form.");
            return;
          }
          throw new Error("Your password could not be saved. Reopen the activation email and try again.");
        }
      }
      await guardiansService.accept({
        token,
        givenName: givenName.trim(),
        familyName: familyName.trim(),
      });
      if (navigate) navigate("/portal");
      else window.location.replace("/portal");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Portal activation could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div>
        <p className="section-label">Family portal activation</p>
        <h2 className={styles.successTitle}>Activating access for {preview.guardianDisplayName}</h2>
      </div>
      <div className="facts-ledger" aria-label="Students linked to this activation">
        {(preview.students ?? []).map((student) => (
          <div className="fl-row" key={`${student.displayName}-${student.classLabel}`}>
            <span className="k">Student</span>
            <span className="v">{student.displayName} · {student.classLabel}</span>
          </div>
        ))}
      </div>
      {!passwordMode ? (
        <p className="callout">You will sign in with a one-time code sent to this email.</p>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.fields}>
        <div className={styles.nameFields}>
          <Field id="guardian-given-name" label="Given name" value={givenName} onChange={setGivenName} error={errors.givenName} autoComplete="given-name" />
          <Field id="guardian-family-name" label="Family name" value={familyName} onChange={setFamilyName} error={errors.familyName} autoComplete="family-name" />
        </div>
        {passwordMode ? (
          <div className={styles.nameFields}>
            <Field id="guardian-password" label="Password" value={password} onChange={setPassword} error={errors.password} type="password" autoComplete="new-password" />
            <Field id="guardian-password-confirmation" label="Confirm password" value={confirmation} onChange={setConfirmation} error={errors.confirmation} type="password" autoComplete="new-password" />
          </div>
        ) : null}
      </div>
      <div className={styles.actions}>
        <Button variant="primary" type="submit" disabled={busy}>{busy ? "Activating…" : "Activate portal access"}</Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  type = "text",
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: "text" | "password";
  autoComplete: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className={`field ${error ? "field--invalid" : ""}`}>
      <label htmlFor={id}>{label} <span aria-hidden="true">*</span></label>
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={error ? errorId : undefined}
        autoComplete={autoComplete}
      />
      {error ? <p id={errorId} className="field-error">{error}</p> : null}
    </div>
  );
}
