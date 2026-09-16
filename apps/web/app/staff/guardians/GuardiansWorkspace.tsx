"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import Button from "@/components/ui/Button";
import RelativeTime from "@/components/ui/RelativeTime";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatKolkata } from "@/modules/iot/domain";
import {
  guardiansService,
  type GuardianAccessState,
  type GuardianAdminRow,
} from "@/modules/services/guardians";

import styles from "./page.module.css";

const STATUS_LABEL: Record<GuardianAccessState, string> = {
  active: "Active",
  suspended: "Suspended",
  invited: "Invited",
  expired: "Expired",
  delivery_failed: "Delivery failed",
  no_contact: "No email",
  not_activated: "Not activated",
  revoked: "Revoked",
};

const STATUS_TONE: Record<GuardianAccessState, "good" | "watch" | "alert" | "neutral"> = {
  active: "good",
  suspended: "alert",
  invited: "watch",
  expired: "alert",
  delivery_failed: "alert",
  no_contact: "neutral",
  not_activated: "neutral",
  revoked: "alert",
};

type InlineAction = { guardianId: string; kind: "contact" | "activate" | "resend" | "revoke" } | null;

export default function GuardiansWorkspace() {
  const [rows, setRows] = useState<GuardianAdminRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [action, setAction] = useState<InlineAction>(null);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const refresh = useCallback(async () => {
    try {
      setRows(await guardiansService.list());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openAction(guardianId: string, kind: NonNullable<InlineAction>["kind"]) {
    setAction({ guardianId, kind });
    setEmail("");
    setReason("");
    setFieldError(null);
    setOperationError(null);
  }

  function closeAction() {
    setAction(null);
    setEmail("");
    setReason("");
    setFieldError(null);
  }

  async function submitAction(row: GuardianAdminRow) {
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      setFieldError("Enter a reason of at least 3 characters.");
      return;
    }
    if (action?.kind === "contact" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldError("Enter a valid email address.");
      return;
    }
    const contact = row.contacts.find((candidate) => candidate.channel === "email" && candidate.state !== "revoked");
    setBusy(true);
    setOperationError(null);
    try {
      if (action?.kind === "contact") {
        await guardiansService.recordContact({ guardianId: row.guardianId, value: email.trim().toLowerCase(), reason: cleanReason });
        setAnnouncement(`Email contact recorded for ${row.displayName}.`);
      } else if (action?.kind === "activate") {
        if (!contact) throw new Error("Record an email contact before sending activation.");
        await guardiansService.activate({ guardianId: row.guardianId, contactId: contact.contactId, reason: cleanReason });
        setAnnouncement(`Activation email sent to ${row.displayName}.`);
      } else if (action?.kind === "resend") {
        if (!row.claim) throw new Error("No activation claim is available to resend.");
        await guardiansService.resend({ claimReference: row.claim.reference, reason: cleanReason });
        setAnnouncement(`A new activation email was sent to ${row.displayName}.`);
      } else if (action?.kind === "revoke") {
        if (!row.claim) throw new Error("No activation claim is available to revoke.");
        await guardiansService.revoke({ claimReference: row.claim.reference, reason: cleanReason });
        setAnnouncement(`Activation revoked for ${row.displayName}.`);
      }
      closeAction();
      await refresh();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "The guardian access action failed.");
    } finally {
      setBusy(false);
    }
  }

  const summary = rows === null ? null : {
    guardians: rows.length,
    active: rows.filter((row) => row.accessState === "active").length,
    pending: rows.filter((row) => row.accessState === "invited").length,
    noEmail: rows.filter((row) => !row.contacts.some((contact) => contact.channel === "email" && contact.state !== "revoked")).length,
  };

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Administrator · Guardians</p>
          <h1 className={styles.title}>Guardians</h1>
          <p className="ph-sub">Record contacts and activate family portal access · email activation only until SMS provider registration.</p>
        </div>
      </div>

      {summary ? (
        <section className="panel" aria-label="Guardian activation summary">
          <div className={`pn-body flush ${styles.summaryStrip}`}>
            <SummaryStat label="Guardians" value={summary.guardians} />
            <SummaryStat label="With portal access" value={summary.active} />
            <SummaryStat label="Activation pending" value={summary.pending} />
            <SummaryStat label="No email recorded" value={summary.noEmail} />
          </div>
        </section>
      ) : null}

      {announcement ? <p className={styles.liveNote} aria-live="polite">{announcement}</p> : null}
      {operationError ? <p className={styles.error} role="alert">{operationError}</p> : null}

      <section className="panel" aria-labelledby="guardian-ledger-heading">
        <div className="pn-head">
          <div>
            <h2 id="guardian-ledger-heading">Family portal activation</h2>
            <p className="sub">Record email contacts, send activation links, and track portal access</p>
          </div>
        </div>
        <div className="pn-body flush">
          {loadError && rows === null ? (
            <div className={styles.statePad}>
              <ErrorPanel title="Guardians could not be loaded" note="The activation register did not respond. No records were changed.">
                <Button variant="quiet" type="button" onClick={() => void refresh()}>Try again</Button>
              </ErrorPanel>
            </div>
          ) : rows === null ? (
            <div className={styles.statePad}><LoadingSkeleton lines={5} label="Loading guardian activation rows…" /></div>
          ) : rows.length === 0 ? (
            <div className={`workspace-state ${styles.statePad}`}>
              <p className="workspace-state-title">No guardians yet</p>
              <p className="workspace-state-note">Import students and guardians first.</p>
              <Link className="underline-link" href="/administrator/imports">Open imports</Link>
            </div>
          ) : (
            <div className="table-wrap" role="region" aria-label="Guardian activation table" tabIndex={0}>
              <table className={`ledger ${styles.table}`}>
                <caption className="sr-only">Guardians, linked students, email contacts and portal activation state</caption>
                <thead>
                  <tr>
                    <th scope="col">Guardian</th>
                    <th scope="col">Students</th>
                    <th scope="col">Email contact</th>
                    <th scope="col">Portal access</th>
                    <th scope="col" className={styles.actionHead}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <GuardianRow
                      key={row.guardianId}
                      row={row}
                      action={action?.guardianId === row.guardianId ? action.kind : null}
                      email={email}
                      reason={reason}
                      fieldError={fieldError}
                      busy={busy}
                      onOpen={openAction}
                      onEmail={setEmail}
                      onReason={(value) => { setReason(value); setFieldError(null); }}
                      onCancel={closeAction}
                      onSubmit={() => void submitAction(row)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.summaryCell}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={`num ${styles.summaryValue}`}>{value}</span>
    </div>
  );
}

function GuardianRow({
  row,
  action,
  email,
  reason,
  fieldError,
  busy,
  onOpen,
  onEmail,
  onReason,
  onCancel,
  onSubmit,
}: {
  row: GuardianAdminRow;
  action: NonNullable<InlineAction>["kind"] | null;
  email: string;
  reason: string;
  fieldError: string | null;
  busy: boolean;
  onOpen: (guardianId: string, kind: NonNullable<InlineAction>["kind"]) => void;
  onEmail: (value: string) => void;
  onReason: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const contact = row.contacts.find((candidate) => candidate.channel === "email" && candidate.state !== "revoked");
  const canSend = contact !== undefined && ["not_activated", "expired", "revoked", "delivery_failed"].includes(row.accessState);
  const visibleStudents = row.students.slice(0, 2);
  const hiddenStudentCount = Math.max(0, row.students.length - visibleStudents.length);
  return (
    <>
      <tr className={styles.dataRow}>
        <td className={styles.guardianCell}>
          <strong className={styles.guardianName}>{row.displayName}</strong>
          <span className={`num ${styles.guardianRef}`}>{row.guardianId.slice(0, 8)}</span>
        </td>
        <td className={styles.studentsCell}>
          {row.students.length === 0 ? (
            <span className={styles.secondary}>No linked students</span>
          ) : (
            <div className={styles.studentList}>
              {visibleStudents.map((student) => (
                <span key={student.linkId} className={styles.studentLine}>
                  {student.displayName} · {student.classLabel}
                </span>
              ))}
              {hiddenStudentCount > 0 ? (
                <details>
                  <summary className={styles.secondary}>+{hiddenStudentCount} more {hiddenStudentCount === 1 ? "student" : "students"}</summary>
                  {row.students.slice(2).map((student) => (
                    <span key={student.linkId} className={styles.studentLine}>{student.displayName} · {student.classLabel}</span>
                  ))}
                </details>
              ) : null}
            </div>
          )}
        </td>
        <td className={styles.contactCell}>
          {contact ? (
            <>
              <span className={styles.email}>{contact.value}</span>
              <span className={styles.secondary}>{contact.state.replace(/_/g, " ")}</span>
            </>
          ) : (
            <div className={styles.inlinePrompt}>
              <span className={styles.mutedText}>No email recorded</span>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => onOpen(row.guardianId, "contact")}>Add email</button>
            </div>
          )}
        </td>
        <td className={styles.statusCell}>
          <StatusBadge tone={STATUS_TONE[row.accessState]}>{STATUS_LABEL[row.accessState]}</StatusBadge>
          <AccessDetail row={row} />
        </td>
        <td className={styles.actionCell}>
          <div className={styles.rowActions}>
            {row.accessState === "invited" ? (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(row.guardianId, "resend")}>Resend</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => onOpen(row.guardianId, "revoke")}>Revoke</button>
              </>
            ) : canSend ? (
              <button type="button" className="btn btn-accent btn-sm" onClick={() => onOpen(row.guardianId, "activate")}>Send activation</button>
            ) : null}
          </div>
        </td>
      </tr>
      {action !== null ? (
        <tr>
          <td colSpan={5} className={styles.formCell}>
            <InlineActionForm
              kind={action}
              id={row.guardianId}
              email={email}
              reason={reason}
              error={fieldError}
              busy={busy}
              onEmail={onEmail}
              onReason={onReason}
              onCancel={onCancel}
              onSubmit={onSubmit}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function AccessDetail({ row }: { row: GuardianAdminRow }) {
  if (row.accessState === "suspended") return <span className={styles.secondary}>Account suspended</span>;
  if (row.accessState === "active") {
    const activeAt = row.claim?.claimedAt ?? row.account?.lastSignInAt;
    return activeAt ? <span className={styles.secondary}>Active since {formatKolkata(activeAt, { format: "short" })}</span> : null;
  }
  if (row.accessState === "delivery_failed") return <span className={styles.secondary}>Delivery failed</span>;
  if (row.claim?.dispatchedAt && row.claim.expiresAt) {
    return <span className={styles.secondary}>Sent <RelativeTime iso={row.claim.dispatchedAt} /> · expires {formatKolkata(row.claim.expiresAt, { format: "short" })}</span>;
  }
  return null;
}

function InlineActionForm({
  kind,
  id,
  email,
  reason,
  error,
  busy,
  onEmail,
  onReason,
  onCancel,
  onSubmit,
}: {
  kind: NonNullable<InlineAction>["kind"];
  id: string;
  email: string;
  reason: string;
  error: string | null;
  busy: boolean;
  onEmail: (value: string) => void;
  onReason: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const label = kind === "contact" ? "Save email" : kind === "activate" ? "Send activation" : kind === "resend" ? "Resend activation" : "Revoke activation";
  return (
    <div className={styles.inlineForm}>
      <p className={styles.formTitle}>{label}</p>
      <div className={styles.formGrid}>
        {kind === "contact" ? (
          <div className="field">
            <label htmlFor={`guardian-email-${id}`}>Email</label>
            <input id={`guardian-email-${id}`} className="input" type="email" value={email} onChange={(event) => onEmail(event.target.value)} />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={`guardian-reason-${kind}-${id}`}>Reason</label>
          <input id={`guardian-reason-${kind}-${id}`} className="input" value={reason} onChange={(event) => onReason(event.target.value)} aria-invalid={error !== null} aria-describedby={error ? `guardian-error-${kind}-${id}` : undefined} />
          {error ? <p id={`guardian-error-${kind}-${id}`} className="field-error">{error}</p> : null}
        </div>
      </div>
      <div className={styles.formActions}>
        <button type="button" className={`btn ${kind === "revoke" ? "btn-danger" : "btn-primary"} btn-sm`} onClick={onSubmit} disabled={busy}>{busy ? "Saving…" : label}</button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
