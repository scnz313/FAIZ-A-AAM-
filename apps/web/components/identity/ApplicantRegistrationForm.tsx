"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";

export default function ApplicantRegistrationForm() {
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!givenName.trim() || !familyName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter your given name, family name, and a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/applicant-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ givenName, familyName, email, purpose: "student_admission" }),
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; errors?: Array<{ message?: string }> } | null;
      if (!response.ok || result?.ok !== true) throw new Error(result?.errors?.[0]?.message ?? "Registration could not be completed.");
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Registration could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (complete) {
    return (
      <section role="status" aria-live="polite">
        <p className="section-label">Check your email</p>
        <h2>Verify your email to continue.</h2>
        <p>We sent a verification invitation to {email}. Follow it first, then sign in with the same email to start or resume an application.</p>
        <a className="button button--primary" href="/sign-in?next=%2Fapply%2Fstudent">Go to sign in</a>
      </section>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="field">
        <label htmlFor="applicant-given-name">Given name <span aria-hidden="true">*</span></label>
        <input id="applicant-given-name" className="input" value={givenName} onChange={(event) => setGivenName(event.target.value)} autoComplete="given-name" />
      </div>
      <div className="field">
        <label htmlFor="applicant-family-name">Family name <span aria-hidden="true">*</span></label>
        <input id="applicant-family-name" className="input" value={familyName} onChange={(event) => setFamilyName(event.target.value)} autoComplete="family-name" />
      </div>
      <div className="field">
        <label htmlFor="applicant-email">Email <span aria-hidden="true">*</span></label>
        <input id="applicant-email" className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        <p className="field-help">This verified contact owns the applicant drafts and status.</p>
      </div>
      <Button variant="primary" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create applicant account"}</Button>
    </form>
  );
}
