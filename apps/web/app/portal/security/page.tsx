"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";

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
  const activeCount = SESSIONS.filter((session) => !signedOut[session.id]).length;

  function signOut(id: string) {
    setSignedOut((previous) => ({ ...previous, [id]: true }));
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
                  ) : (
                    <Button variant="quiet" onClick={() => signOut(session.id)}>
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
