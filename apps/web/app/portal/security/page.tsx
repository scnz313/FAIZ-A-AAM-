"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./page.module.css";

type SessionRow = {
  id: string;
  device: string;
  location: string;
  lastActive: string;
  current?: boolean;
};

/* Fictional demo sessions — real device history arrives with authentication. */
const SESSIONS: ReadonlyArray<SessionRow> = [
  {
    id: "session-1",
    device: "Chrome · macOS",
    location: "Bandipora, Jammu & Kashmir",
    lastActive: "Active now",
    current: true,
  },
  {
    id: "session-2",
    device: "Firefox · Android",
    location: "Bandipora, Jammu & Kashmir",
    lastActive: "Today, 09:12",
  },
  {
    id: "session-3",
    device: "Safari · iPhone",
    location: "Srinagar, Jammu & Kashmir",
    lastActive: "Yesterday, 18:40",
  },
];

/**
 * Security settings. A client page so the demo "sign out this session"
 * toggle can flip a row to its signed-out state without a backend.
 */
export default function SecurityPage() {
  const [signedOut, setSignedOut] = useState<Record<string, boolean>>({});
  /* Sign-out is destructive: each row carries a local two-step confirmation
     (never window.confirm) naming the exact device, with Cancel as the
     focused, safe default. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const activeCount = SESSIONS.filter((session) => !signedOut[session.id]).length;
  const supabaseMode = clientAdapterMode() === "supabase";
  const [mfaStatus, setMfaStatus] = useState<"checking" | "verified" | "not-enrolled">("checking");
  const [securityBusy, setSecurityBusy] = useState<"local" | "others" | "global" | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);

  useEffect(() => {
    if (confirmingId !== null) confirmRef.current?.focus();
  }, [confirmingId]);

  useEffect(() => {
    if (!supabaseMode) return;
    let cancelled = false;
    void createSupabaseBrowserClient().auth.mfa.listFactors().then(({ data }) => {
      if (cancelled) return;
      setMfaStatus((data?.totp ?? []).some((factor) => factor.status === "verified") ? "verified" : "not-enrolled");
    }).catch(() => {
      if (!cancelled) setMfaStatus("not-enrolled");
    });
    return () => {
      cancelled = true;
    };
  }, [supabaseMode]);

  function beginConfirm(id: string) {
    setConfirmingId(id);
  }

  function cancelConfirm(id: string) {
    setConfirmingId((current) => (current === id ? null : current));
  }

  function signOut(id: string) {
    setSignedOut((previous) => ({ ...previous, [id]: true }));
    setConfirmingId(null);
  }

  async function signOutProvider(scope: "local" | "others" | "global") {
    if (securityBusy !== null) return;
    setSecurityBusy(scope);
    setSecurityError(null);
    setSecurityMessage(null);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!response.ok) throw new Error("sign out failed");
      if (scope === "others") {
        setSecurityMessage("Other device sessions were closed. This browser remains signed in.");
      } else {
        window.location.assign("/sign-in");
      }
    } catch {
      setSecurityError("The session change could not be completed. Check your connection and try again.");
    } finally {
      setSecurityBusy(null);
    }
  }

  if (supabaseMode) {
    return (
      <div className={styles.page}>
        <header>
          <p className="eyebrow">Portal · Security</p>
          <h1 className={styles.title}>Security</h1>
          <p className={styles.intro}>Manage this signed-in browser, other sessions, password recovery, and authenticator status.</p>
        </header>

        {securityError ? <p className="field-error" role="alert">{securityError}</p> : null}
        {securityMessage ? <p role="status" aria-live="polite">{securityMessage}</p> : null}

        <section aria-labelledby="sessions-heading">
          <h2 id="sessions-heading" className={styles.sectionTitle}>Session access</h2>
          <div className={styles.rows}>
            <div className={styles.sessionRow}>
              <div>
                <strong>Current browser</strong>
                <small>Verified Supabase session</small>
              </div>
              <p className={styles.lastActive}><StatusBadge tone="good">This device</StatusBadge>Active now</p>
              <div className={styles.sessionAction}>
                <Button variant="quiet" onClick={() => void signOutProvider("local")} disabled={securityBusy !== null}>
                  {securityBusy === "local" ? "Signing out…" : "Sign out this device"}
                </Button>
              </div>
            </div>
          </div>
          <div className={styles.statusLine}>
            <p className={styles.statusText}>Close sessions on other browsers if you no longer recognize or use them.</p>
            <Button variant="quiet" onClick={() => void signOutProvider("others")} disabled={securityBusy !== null}>
              {securityBusy === "others" ? "Closing sessions…" : "Sign out other devices"}
            </Button>
            <Button variant="quiet" onClick={() => void signOutProvider("global")} disabled={securityBusy !== null}>
              {securityBusy === "global" ? "Closing all sessions…" : "Sign out everywhere"}
            </Button>
          </div>
        </section>

        <section aria-labelledby="twofa-heading">
          <h2 id="twofa-heading" className={styles.sectionTitle}>Two-factor authentication</h2>
          <div className={styles.statusLine}>
            <StatusBadge tone={mfaStatus === "verified" ? "good" : "neutral"}>
              {mfaStatus === "checking" ? "Checking" : mfaStatus === "verified" ? "Enabled" : "Not enrolled"}
            </StatusBadge>
            <p className={styles.statusText}>Authenticator verification is mandatory for staff workspaces. Guardian enrollment remains subject to school policy.</p>
          </div>
        </section>

        <section aria-labelledby="password-heading">
          <h2 id="password-heading" className={styles.sectionTitle}>Password</h2>
          <p className={styles.passwordNote}>Staff passwords are changed through a time-limited recovery email. Family and applicant sign-in continues to use an email code.</p>
          <Button href="/sign-in/recovery" variant="quiet">Send password reset email</Button>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">Portal · Security</p>
        <h1 className={styles.title}>Security</h1>
        <p className={styles.intro}>
          Signed-in devices, two-factor authentication, and password handling for this account.
        </p>
      </header>

      <p className="sr-only" role="status" aria-live="polite">
        {activeCount} of {SESSIONS.length} active sessions.
      </p>

      <section aria-labelledby="sessions-heading">
        <h2 id="sessions-heading" className={styles.sectionTitle}>
          Active sessions
        </h2>
        <div className={styles.rows}>
          {SESSIONS.map((session) => {
            const out = signedOut[session.id] === true;
            return (
              <div
                key={session.id}
                className={`${styles.sessionRow}${out ? ` ${styles.sessionRowMuted}` : ""}`}
              >
                <div>
                  <strong>{session.device}</strong>
                  <small>{session.location}</small>
                </div>
                <p className={styles.lastActive}>
                  {session.current && <StatusBadge tone="good">This device</StatusBadge>}
                  {session.lastActive}
                </p>
                <div className={styles.sessionAction}>
                  {out ? (
                    <StatusBadge tone="neutral">Signed out (demo)</StatusBadge>
                  ) : confirmingId === session.id ? (
                    <div className={styles.confirmBox} role="group" aria-label={`Confirm sign out of ${session.device}`}>
                      <p className={styles.confirmText}>
                        Sign out <strong>{session.device}</strong>? Its access ends now.
                      </p>
                      <div className={styles.confirmActions}>
                        <button
                          ref={confirmRef}
                          type="button"
                          className="button button--quiet button--small"
                          onClick={() => signOut(session.id)}
                        >
                          Yes, sign out
                        </button>
                        <button
                          type="button"
                          className="button button--quiet button--small"
                          onClick={() => cancelConfirm(session.id)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="quiet" onClick={() => beginConfirm(session.id)}>
                      Sign out this session
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="twofa-heading">
        <h2 id="twofa-heading" className={styles.sectionTitle}>
          Two-factor authentication
        </h2>
        <div className={styles.statusLine}>
          <StatusBadge tone="neutral">Not enabled</StatusBadge>
          <p className={styles.statusText}>
            Available to guardians once accounts are verified.
          </p>
          <Button variant="quiet" disabled>
            Enable two-factor authentication
          </Button>
        </div>
      </section>

      <section aria-labelledby="password-heading">
        <h2 id="password-heading" className={styles.sectionTitle}>
          Password
        </h2>
        <div className={styles.passwordFields}>
          <div className="field">
            <label htmlFor="current-password">Current password</label>
            <input
              id="current-password"
              className="input"
              type="password"
              autoComplete="current-password"
              disabled
            />
          </div>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              disabled
            />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              className="input"
              type="password"
              autoComplete="new-password"
              disabled
            />
          </div>
        </div>
        <p className={styles.passwordNote}>
          Password changes are handled by the identity provider in the backend phase.
        </p>
      </section>

      <p className={styles.demoNote}>
        <span className="demo-badge">Demo data</span>
        <span>Fictional sessions and settings — real security controls arrive with authentication.</span>
      </p>
    </div>
  );
}
