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
    device: "This device · Chrome, macOS",
    location: "Bandipora, Jammu & Kashmir",
    lastActive: "Now",
    current: true,
  },
  {
    id: "session-2",
    device: "Redmi Note 11 · app",
    location: "Bandipora, Jammu & Kashmir",
    lastActive: "Yesterday, 8:42 pm",
  },
  {
    id: "session-3",
    device: "Windows PC · Firefox",
    location: "Srinagar, Jammu & Kashmir",
    lastActive: "3 days ago",
  },
];

/**
 * Security settings — V14 aligned. PageHead + grid of panels for active
 * sessions and sign-in method. A client page so the demo "sign out this
 * session" toggle can flip a row to its signed-out state without a backend.
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
  const [mfaStatus, setMfaStatus] = useState<"checking" | "verified" | "not-enrolled" | "unavailable">("checking");
  const [mfaReload, setMfaReload] = useState(0);
  const [securityBusy, setSecurityBusy] = useState<"local" | "others" | "global" | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);

  useEffect(() => {
    if (confirmingId !== null) confirmRef.current?.focus();
  }, [confirmingId]);

  useEffect(() => {
    if (!supabaseMode) return;
    let cancelled = false;
    setMfaStatus("checking");
    void createSupabaseBrowserClient().auth.mfa.listFactors().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setMfaStatus("unavailable");
        return;
      }
      setMfaStatus((data?.totp ?? []).some((factor) => factor.status === "verified") ? "verified" : "not-enrolled");
    }).catch(() => {
      if (!cancelled) setMfaStatus("unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [supabaseMode, mfaReload]);

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
        {/* V14 PageHead */}
        <div className="page-head">
          <div>
            <h1 className={styles.title}>Security</h1>
            <p className="ph-sub">Sessions, devices and sign-in methods for your guardian account.</p>
          </div>
        </div>

        {securityError ? <p className="field-error" role="alert">{securityError}</p> : null}
        {securityMessage ? <p role="status" aria-live="polite">{securityMessage}</p> : null}

        {/* V14 grid of panels */}
        <div className={styles.grid}>
          <section className="panel">
            <div className="pn-head"><h2>Active sessions</h2></div>
            <div className="pn-body flush">
              <div
                className="table-wrap"
                role="region"
                aria-label="Active sessions table"
                tabIndex={0}
              >
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>Last active</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="strong small">Current browser · verified Supabase session</td>
                      <td className="num small muted">Active now</td>
                      <td style={{ textAlign: "right" }}>
                        <StatusBadge tone="good">Current</StatusBadge>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="pn-body" style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
                <p className="small muted" style={{ marginBottom: 10 }}>Close sessions on other browsers if you no longer recognize or use them.</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button variant="quiet" onClick={() => void signOutProvider("others")} disabled={securityBusy !== null}>
                    {securityBusy === "others" ? "Closing…" : "Sign out other devices"}
                  </Button>
                  <Button variant="quiet" onClick={() => void signOutProvider("global")} disabled={securityBusy !== null}>
                    {securityBusy === "global" ? "Closing all…" : "Sign out everywhere"}
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="pn-head"><h2>Sign-in method</h2></div>
            <div className="pn-body" style={{ paddingTop: 12 }}>
              <div className={styles.methodRow}>
                <span className="small">Password</span>
                <span className="tiny muted">Reset by email link</span>
              </div>
              <div className={styles.methodRow}>
                <span className="small">Authenticator app (TOTP)</span>
                {mfaStatus === "checking" ? (
                  <span className="tiny muted" role="status" aria-live="polite">Checking…</span>
                ) : mfaStatus === "verified" ? (
                  <StatusBadge tone="good">Enabled</StatusBadge>
                ) : mfaStatus === "unavailable" ? (
                  <span className={styles.methodActions}>
                    <span className="tiny muted">Could not check</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMfaReload((key) => key + 1)}>
                      Try again
                    </button>
                  </span>
                ) : (
                  <StatusBadge tone="neutral">Not set up</StatusBadge>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                <Button href="/sign-in/recovery" variant="quiet">Send password reset email</Button>
              </div>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                Authenticator verification is mandatory for staff workspaces. Guardian enrollment remains subject to school policy.
              </p>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* V14 PageHead */}
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Security</h1>
          <p className="ph-sub">Sessions, devices and sign-in methods for your guardian account.</p>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {activeCount} of {SESSIONS.length} active sessions.
      </p>

      {/* V14 grid of panels */}
      <div className={styles.grid}>
        {/* Active sessions panel with flush ledger table */}
        <section className="panel">
          <div className="pn-head"><h2>Active sessions</h2></div>
          <div className="pn-body flush">
            <div className="table-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Last active</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {SESSIONS.map((session) => {
                    const out = signedOut[session.id] === true;
                    return (
                      <tr key={session.id} style={out ? { opacity: 0.5 } : undefined}>
                        <td className="strong small">{session.device}</td>
                        <td className="num small muted">{session.lastActive}</td>
                        <td style={{ textAlign: "right" }}>
                          {out ? (
                            <StatusBadge tone="neutral">Signed out</StatusBadge>
                          ) : session.current ? (
                            <StatusBadge tone="good">Current</StatusBadge>
                          ) : confirmingId === session.id ? (
                            <div className={styles.confirmBox} role="group" aria-label={`Confirm sign out of ${session.device}`}>
                              <p className={styles.confirmText}>
                                Sign out <strong>{session.device}</strong>?
                              </p>
                              <div className={styles.confirmActions}>
                                <button
                                  ref={confirmRef}
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => signOut(session.id)}
                                >
                                  Yes, sign out
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => cancelConfirm(session.id)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => beginConfirm(session.id)}>
                              Sign out
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Sign-in method panel */}
        <section className="panel">
          <div className="pn-head"><h2>Sign-in method</h2></div>
          <div className="pn-body" style={{ paddingTop: 12 }}>
            <div className={styles.methodRow}>
              <span className="small">Password</span>
              <span className="tiny muted">Disabled in demo</span>
            </div>
            <div className={styles.methodRow}>
              <span className="small">Second factor (SMS)</span>
              <StatusBadge tone="good">On</StatusBadge>
            </div>
            <div className={styles.methodRow}>
              <span className="small">Authenticator app (TOTP)</span>
              <span className="tiny muted">Not set up</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <Button variant="quiet" disabled>Change password</Button>
              <Button variant="quiet" disabled>Set up authenticator</Button>
            </div>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              Authenticator enrolment is disabled in this prototype. The provider wording above follows the school&apos;s live configuration.
            </p>
          </div>
        </section>
      </div>

      <p className={styles.demoNote}>
        <span className="demo-badge">Demo data</span>
        <span>Fictional sessions and settings · real security controls arrive with authentication.</span>
      </p>
    </div>
  );
}
