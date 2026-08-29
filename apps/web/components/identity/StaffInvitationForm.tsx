"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { usersService, type InviteAcceptanceResult } from "@/modules/services/users";

import styles from "./StaffInvitationForm.module.css";

type FieldErrors = {
  invitationRef?: string;
  oneTimeRef?: string;
  givenName?: string;
  familyName?: string;
  password?: string;
  confirmation?: string;
};

export default function StaffInvitationForm({ initialInvitationRef = "" }: { initialInvitationRef?: string }) {
  const [invitationRef, setInvitationRef] = useState(initialInvitationRef);
  const [oneTimeRef, setOneTimeRef] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteAcceptanceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = clientAdapterMode() === "demo";

  function validate(): FieldErrors {
    return {
      invitationRef: invitationRef.trim() ? undefined : "Enter the invitation reference from the school.",
      oneTimeRef: demo && oneTimeRef.trim().length < 16 ? "Enter the one-time reference exactly as supplied." : undefined,
      givenName: givenName.trim() ? undefined : "Enter your given name.",
      familyName: familyName.trim() ? undefined : "Enter your family name.",
      password: !demo && (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) ? "Use at least 8 characters with a letter and a number." : undefined,
      confirmation: !demo && confirmation !== password ? "The passwords do not match." : undefined,
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
      if (!demo) {
        const { error: passwordError } = await createSupabaseBrowserClient().auth.updateUser({ password });
        if (passwordError !== null) throw new Error("Your password could not be saved. Reopen the invitation email and try again.");
      }
      const accepted = await usersService.acceptInvitation({
        invitationRef: invitationRef.trim(),
        ...(demo ? { oneTimeRef: oneTimeRef.trim() } : {}),
        givenName: givenName.trim(),
        familyName: familyName.trim(),
      });
      setResult(accepted);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invitation could not be accepted.");
    } finally {
      setBusy(false);
    }
  }

  if (result !== null) {
    return (
      <section className={styles.success} aria-live="polite" role="status">
        <p className="section-label">Invitation accepted</p>
        <h2 className={styles.successTitle}>Your staff account is ready.</h2>
        <p>
          {demo
            ? "The local demo materialized the account records without contacting an identity provider."
            : "The verified invitation email matched the school record and the account was linked."} {" "}
          The <strong>{result.userRow.role}</strong> workspace is ready. Complete two-step verification before opening staff records.
        </p>
        <dl className={styles.references}>
          <div>
            <dt>Account</dt>
            <dd className="num">{result.accountRef}</dd>
          </div>
          <div>
            <dt>Role grant</dt>
            <dd className="num">{result.grantRef}</dd>
          </div>
        </dl>
        <a className="button button--primary" href={demo ? "/sign-in" : "/sign-in/totp?next=%2Fstaff"}>
          {demo ? "Continue to sign in" : "Set up two-step verification"}
        </a>
      </section>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {demo ? (
        <p className="demo-note">
          <span className="demo-badge">Local demo</span> This exercises the complete invitation lifecycle locally;
          no email or account provider is contacted.
        </p>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.fields}>
        <Field
          id="invitation-reference"
          label="Invitation reference"
          value={invitationRef}
          onChange={setInvitationRef}
          error={errors.invitationRef}
          placeholder="INV-2026-0501"
        />
        {demo ? (
          <Field
            id="one-time-reference"
            label="One-time reference"
            value={oneTimeRef}
            onChange={setOneTimeRef}
            error={errors.oneTimeRef}
            placeholder="Paste the private reference"
            mono
          />
        ) : (
          <p className={styles.providerNote}>
            Your signed-in invitation email is checked against the school invitation. No manual token is required.
          </p>
        )}
        <div className={styles.nameFields}>
          <Field
            id="given-name"
            label="Given name"
            value={givenName}
            onChange={setGivenName}
            error={errors.givenName}
            placeholder="Given name"
            autoComplete="given-name"
          />
          <Field
            id="family-name"
            label="Family name"
            value={familyName}
            onChange={setFamilyName}
            error={errors.familyName}
            placeholder="Family name"
            autoComplete="family-name"
          />
        </div>
        {!demo ? (
          <div className={styles.nameFields}>
            <Field
              id="staff-password"
              label="Password"
              value={password}
              onChange={setPassword}
              error={errors.password}
              placeholder="At least 8 characters"
              type="password"
              autoComplete="new-password"
            />
            <Field
              id="staff-password-confirmation"
              label="Confirm password"
              value={confirmation}
              onChange={setConfirmation}
              error={errors.confirmation}
              placeholder="Enter it again"
              type="password"
              autoComplete="new-password"
            />
          </div>
        ) : null}
      </div>
      <div className={styles.actions}>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Accepting…" : "Accept invitation"}
        </Button>
        <a className="link-arrow" href="/sign-in">Already have access? Sign in →</a>
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
  placeholder,
  mono = false,
  type = "text",
  autoComplete = "off",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder: string;
  mono?: boolean;
  type?: "text" | "password";
  autoComplete?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className={`field ${error ? "field--invalid" : ""}`}>
      <label htmlFor={id}>{label} <span aria-hidden="true">*</span></label>
      <input
        id={id}
        className={`input ${mono ? "num" : ""}`}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={error !== undefined}
        aria-describedby={error ? errorId : undefined}
        autoComplete={autoComplete}
      />
      {error ? <p id={errorId} className="field-error">{error}</p> : null}
    </div>
  );
}
