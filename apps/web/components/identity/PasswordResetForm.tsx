"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { adapterCall } from "@/modules/services/adapter-client";

import styles from "./RecoveryForm.module.css";

export default function PasswordResetForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError("Use at least 8 characters with a letter and a number.");
      passwordRef.current?.focus();
      return;
    }
    if (confirmation !== password) {
      setError("The passwords do not match.");
      confirmationRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError !== null) {
        /* Accounts with an authenticator factor must reach AAL2 before the
           provider will change a password. A recovery link signs in at AAL1,
           so send the user through the existing challenge and come straight
           back here; calling it an invalid link would be dishonest. */
        const needsSecondFactor =
          updateError.code === "insufficient_aal" || /aal2/i.test(updateError.message ?? "");
        if (needsSecondFactor) {
          setError("Two-step verification is required before changing the password. Enter your authenticator code to continue.");
          router.replace(`/sign-in/totp?next=${encodeURIComponent("/sign-in/reset-password")}`);
          return;
        }
        setError("This recovery link is no longer valid. Request a fresh password reset email.");
        return;
      }
      await adapterCall("identity.recordAuthEvent", { event: "password_changed" }).catch(() => null);
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "global" }),
      });
      if (!response.ok) {
        setError("Your password changed, but other sessions could not be closed. Sign out before using the new password.");
        return;
      }
      router.replace("/sign-in?reset=complete");
      router.refresh();
    } catch {
      setError("The password could not be updated. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {error !== null ? <p className="field-error" role="alert">{error}</p> : null}
      <div className="field">
        <label htmlFor="reset-password">New password <span aria-hidden="true">*</span></label>
        <input
          ref={passwordRef}
          id="reset-password"
          className="input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby="reset-password-help"
          required
        />
        <p id="reset-password-help" className="field-help">At least 8 characters with a letter and a number.</p>
      </div>
      <div className="field">
        <label htmlFor="reset-password-confirmation">Confirm new password <span aria-hidden="true">*</span></label>
        <input
          ref={confirmationRef}
          id="reset-password-confirmation"
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          required
        />
      </div>
      <div className={styles.actions}>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Saving password…" : "Save new password"}
        </Button>
        <p className={styles.actionNote}>After the change, all sessions close and you sign in again with the new password.</p>
      </div>
    </form>
  );
}
