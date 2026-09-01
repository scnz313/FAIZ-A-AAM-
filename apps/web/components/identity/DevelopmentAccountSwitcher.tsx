"use client";

import { useState } from "react";

import { DEVELOPMENT_ACCOUNTS, type DevelopmentAccountAudience } from "@/lib/auth/dev-accounts";

import Button from "@/components/ui/Button";
import styles from "./SignInForm.module.css";

type QuickSignInResponse = {
  ok: boolean;
  value?: { destination: string; requiresMfaElevation: boolean };
  errors?: Array<{ message?: string }>;
};

export default function DevelopmentAccountSwitcher({
  audience,
  navigate,
}: {
  audience: DevelopmentAccountAudience | "all";
  navigate?: (href: string) => void;
}) {
  const choices = DEVELOPMENT_ACCOUNTS.filter((account) => audience === "all" || account.audience === audience);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function selectAccount(accountId: string) {
    if (busy !== null) return;
    setBusy(accountId);
    setError(null);
    try {
      const response = await fetch("/api/auth/dev-sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: accountId }),
      });
      const result = await response.json().catch(() => null) as QuickSignInResponse | null;
      if (!response.ok || result?.ok !== true || result.value === undefined) {
        throw new Error(result?.errors?.[0]?.message ?? "Quick sign-in could not complete.");
      }
      if (result.value.requiresMfaElevation) {
        const elevation = await fetch("/api/auth/mfa/dev-elevate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!elevation.ok) throw new Error("The staff session could not be prepared. Try again.");
      }
      if (navigate) navigate(result.value.destination);
      else window.location.assign(result.value.destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quick sign-in could not complete.");
      setBusy(null);
    }
  }

  return (
    <section className={styles.devAccounts} aria-labelledby="development-accounts-title">
      <p className="section-label" id="development-accounts-title">Local development accounts</p>
      <p className={styles.actionNote}>Real Supabase data, one-click sign-in, and no email or QR code.</p>
      <div className={styles.devAccountGrid}>
        {choices.map((account) => (
          <Button
            key={account.id}
            variant="quiet"
            disabled={busy !== null}
            onClick={() => void selectAccount(account.id)}
            className={styles.devAccountButton}
          >
            <span>{busy === account.id ? "Opening…" : account.label}</span>
            <small>{account.email}</small>
          </Button>
        ))}
      </div>
      {error !== null ? <p className="field-error" role="alert">{error}</p> : null}
    </section>
  );
}
