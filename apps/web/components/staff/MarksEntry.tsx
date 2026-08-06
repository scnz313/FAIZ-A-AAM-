"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { formatKolkata } from "@/modules/iot/domain";
import { assignmentsCoverClass, canRole } from "@/modules/services/staff-authorization";
import { staffContextService } from "@/modules/services/staff-context";
import { academicsService, ENTRY_BATCH_STATUS_META, gradeForPercentage } from "@/modules/services/academics";
import type { AcademicError, BatchVersion, EntryBatch, MarksRow } from "@/modules/services/academics";

import styles from "./MarksEntry.module.css";

const DEFAULT_ACTOR = "M. Wani (exam office)";

function cloneRows(rows: readonly MarksRow[]): MarksRow[] {
  return rows.map((row) => ({ ...row }));
}

/** Client-side row check; the adapter enforces the same rules server-side. */
function rowProblem(row: MarksRow): string | null {
  if (row.obtained === null) return null;
  if (!Number.isFinite(row.obtained)) return "Enter a number for the marks.";
  if (row.obtained < 0) return "Marks cannot be negative.";
  if (row.obtained > row.max) return `Marks exceed the maximum of ${row.max}.`;
  return null;
}

/** One active assignment in the shape the batch-scope check needs. */
export type AssignmentScope = {
  gradeSection: { gradeLabel: string; sectionLabel: string } | null;
  subjectName: string;
};

/**
 * Teacher scope (I4 + subject): an active assignment covers a batch only
 * when its grade section matches the batch class AND its subject matches
 * the batch subject. Exported so the batch queue applies the same entry
 * scope as the marks-entry workspace.
 */
export function assignmentsCoverBatch(
  assignments: ReadonlyArray<AssignmentScope>,
  className: string,
  subject: string,
): boolean {
  const target = subject.trim().toLowerCase();
  return assignments.some(
    (assignment) =>
      assignment.subjectName.trim().toLowerCase() === target &&
      assignmentsCoverClass([{ gradeSection: assignment.gradeSection }], className),
  );
}

/**
 * Resolve a teacher's active assignments into the class+subject shape the
 * scope check needs. Both lists derive from the same active-assignment
 * ordering in the staff-context service; grade labels come from the service,
 * never from a fixture import.
 */
export async function teacherAssignmentScope(accountId: string): Promise<AssignmentScope[]> {
  const [assignments, sections] = await Promise.all([
    staffContextService.getActiveAssignments(accountId),
    staffContextService.getActiveAssignmentSections(accountId),
  ]);
  return assignments.map((assignment, index) => ({
    gradeSection: sections[index] ?? null,
    subjectName: assignment.subjectName,
  }));
}

type MarksEntryProps = {
  batchRef: string;
  initialBatch: EntryBatch;
};

/**
 * The working marks-entry workspace: editable sheet, inline validation,
 * draft save, submit for moderation, returned-with-reason, approve,
 * publish confirmation (with a portal link), and correction v2. All state
 * transitions go through `academicsService`; the workspace re-reads the
 * batch on mount so the session state is always the source of truth.
 */
export function MarksEntry({ batchRef, initialBatch }: MarksEntryProps) {
  const [batch, setBatch] = useState<EntryBatch | null>(initialBatch);
  const [rows, setRows] = useState<MarksRow[]>(() => cloneRows(initialBatch.rows));
  const [versions, setVersions] = useState<BatchVersion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
  const [submitErrors, setSubmitErrors] = useState<AcademicError[]>([]);
  const [publishedRef, setPublishedRef] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const summaryRef = useRef<HTMLDivElement>(null);
  const { summary } = useStaffContext();
  /* Phase-1 split: moderation actions (approve/return) belong to exam
     reviewers (results.approve); publish and correction belong to result
     publishers (results.publish). Entry controls keep the teacher
     results.enter scope below. */
  const canApprove = canRole(summary?.role ?? "", "results.approve");
  const canPublish = canRole(summary?.role ?? "", "results.publish");
  /* Teacher assignment scope: a teacher may only enter marks for batches in
     their assigned classes AND subjects (I4). Null while the scope is being
     resolved. */
  const [assignmentOk, setAssignmentOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (summary === null || summary.role !== "teacher") {
      setAssignmentOk(true);
      return;
    }
    let cancelled = false;
    void teacherAssignmentScope(summary.accountId).then((scope) => {
      if (cancelled) return;
      setAssignmentOk(assignmentsCoverBatch(scope, initialBatch.className, initialBatch.subject));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- summary is intentionally sampled once per identity/workspace change
  }, [summary?.accountId, summary?.role, initialBatch.className, initialBatch.subject]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([academicsService.getBatch(batchRef), academicsService.listVersions(batchRef)]).then(
      ([nextBatch, nextVersions]) => {
        if (cancelled) return;
        if (nextBatch) {
          setBatch(nextBatch);
          setRows(cloneRows(nextBatch.rows));
        }
        setVersions(nextVersions);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [batchRef]);

  function applyBatch(next: EntryBatch) {
    setBatch(next);
    setRows(cloneRows(next.rows));
    setFieldErrors({});
    setSubmitErrors([]);
    void academicsService.listVersions(batchRef).then(setVersions);
  }

  function focusSummary() {
    summaryRef.current?.focus();
  }

  function setObtained(index: number, raw: string) {
    const value = raw.trim() === "" ? null : Number(raw);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, obtained: value } : row)));
    setFieldErrors((current) => {
      const problem = value === null ? "" : (rowProblem({ ...rows[index]!, obtained: value }) ?? "");
      return { ...current, [index]: problem };
    });
    setSubmitErrors([]);
  }

  function setRemark(index: number, raw: string) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, remark: raw } : row)));
  }

  async function saveDraft() {
    setBusy("save");
    const result = await academicsService.saveEntryDraft(batchRef, rows);
    setBusy(null);
    if (!result.ok) {
      setSubmitErrors(result.errors);
      focusSummary();
      return;
    }
    applyBatch(result.value);
    setLive(`Draft saved (demo) — ${result.value.ref}`);
  }

  async function submitForModeration() {
    const localErrors: AcademicError[] = [];
    for (const row of rows) {
      if (row.obtained === null) {
        localErrors.push({ subject: row.subject, message: "Marks not entered." });
      } else {
        const problem = rowProblem(row);
        if (problem) localErrors.push({ subject: row.subject, message: problem });
      }
    }
    if (localErrors.length > 0) {
      setSubmitErrors(localErrors);
      focusSummary();
      return;
    }
    setBusy("submit");
    const result = await academicsService.submitForModeration(batchRef, rows);
    setBusy(null);
    if (!result.ok) {
      setSubmitErrors(result.errors);
      focusSummary();
      return;
    }
    applyBatch(result.value);
    setLive(`${result.value.ref} submitted for moderation (demo)`);
  }

  async function approve() {
    setBusy("approve");
    const result = await academicsService.approve(batchRef);
    setBusy(null);
    if (!result.ok) {
      setSubmitErrors(result.errors);
      return;
    }
    applyBatch(result.value);
    setLive(`${result.value.ref} approved (demo)`);
  }

  async function confirmReturn() {
    setBusy("return");
    const result = await academicsService.returnWithReason(batchRef, returnReason);
    setBusy(null);
    if (!result.ok) {
      setSubmitErrors(result.errors);
      return;
    }
    applyBatch(result.value);
    setReturnOpen(false);
    setReturnReason("");
    setLive(`${result.value.ref} returned to entry with a reason (demo)`);
  }

  async function confirmPublish() {
    setBusy("publish");
    const result = await academicsService.publish(batchRef, DEFAULT_ACTOR);
    setBusy(null);
    if (!result.ok) {
      setSubmitErrors(result.errors);
      return;
    }
    const next = await academicsService.getBatch(batchRef);
    if (next) applyBatch(next);
    setPublishedRef(result.value.ref);
    setPublishOpen(false);
    setLive(`Published as ${result.value.ref} (demo)`);
  }

  async function confirmCorrection() {
    setBusy("correct");
    const result = await academicsService.startCorrection(batchRef, correctionReason, DEFAULT_ACTOR);
    setBusy(null);
    if (!result.ok) {
      setSubmitErrors(result.errors);
      return;
    }
    applyBatch(result.value);
    setCorrectOpen(false);
    setCorrectionReason("");
    setLive(`Correction v${result.value.version} started (demo)`);
  }

  async function confirmWithdraw() {
    setBusy("withdraw");
    const result = await academicsService.withdrawPublication(batchRef, withdrawalReason, DEFAULT_ACTOR);
    setBusy(null);
    if (!result.ok) {
      setSubmitErrors(result.errors);
      return;
    }
    applyBatch(result.value);
    setWithdrawOpen(false);
    setWithdrawalReason("");
    setLive(`${result.value.ref} withdrawn — the live portal publication was removed (demo)`);
  }

  if (!batch) {
    return <p className={styles.loading}>Loading marks entry workspace…</p>;
  }

  /* Teacher assignment scope (I4): the route guard admits teacher roles;
     here the batch's class must be covered by the teacher's assignments. */
  if (assignmentOk === false) {
    return (
      <div className={styles.workspace} role="alert">
        <header className={`workspace-header ${styles.header}`}>
          <p className="eyebrow">Staff · Results · Marks entry</p>
          <h1 className="workspace-title">Outside your assignments</h1>
          <p className={`workspace-intro ${styles.meta}`}>
            <span className="num">{batch.ref}</span> · {batch.exam} · {batch.className}
          </p>
        </header>
        <div className={styles.returnedPanel}>
          <p className={styles.returnedReason}>
            This batch is not in your assigned classes or subjects — marks entry is scoped to the classes and subjects
            on your teaching assignment. If this is wrong, the school office must update the assignment.
          </p>
          <p className={styles.returnedHint}>
            <a className="link-arrow" href="/staff/results">
              Back to the batch queue →
            </a>
          </p>
        </div>
      </div>
    );
  }

  const meta = ENTRY_BATCH_STATUS_META[batch.status];
  const editable = batch.status === "draft" || batch.status === "returned";
  const awaitingModeration = batch.status === "submitted" || batch.status === "moderation";
  const enteredCount = rows.filter((row) => row.obtained !== null).length;
  const nextVersion = batch.version + 1;

  return (
    <div className={styles.workspace}>
      <header className={`workspace-header ${styles.header}`}>
        <p className={styles.backLink}>
          <a className="link-arrow" href={`/staff/results/${batch.ref}`}>
            ← {batch.exam} · {batch.className}
          </a>
        </p>
        <p className="eyebrow">Staff · Results · Marks entry</p>
        <h1 className="workspace-title">Marks entry</h1>
        <p className={`workspace-intro ${styles.meta}`}>
          <span className="num">{batch.ref}</span> · {batch.exam} · {batch.className} · {enteredCount}/
          {rows.length} subjects entered · v{batch.version}
        </p>
        <div className={styles.badgeRow}>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
          <span className="demo-badge">Demo data</span>
        </div>
      </header>

      {batch.status === "returned" && batch.returnedReason ? (
        <div className={styles.returnedPanel}>
          <p className="section-label">Returned by moderation</p>
          <p className={styles.returnedReason}>“{batch.returnedReason}”</p>
          <p className={styles.returnedHint}>Re-edit the sheet and submit again; the reason stays on record.</p>
        </div>
      ) : null}

      {batch.status === "withdrawn" && batch.note ? (
        <div className={styles.returnedPanel}>
          <p className="section-label">Withdrawn</p>
          <p className={styles.returnedReason}>“{batch.note}”</p>
          <p className={styles.returnedHint}>
            The live publication was removed and stays off the portal; the published record remains on file. A
            correction can release a new version.
          </p>
        </div>
      ) : null}

      {submitErrors.length > 0 ? (
        <div className={styles.errorSummary} role="alert" ref={summaryRef} tabIndex={-1}>
          <p className={styles.errorTitle}>Marks entry needs review before it can move forward.</p>
          <ul className={styles.errorList}>
            {submitErrors.map((error) => (
              <li key={`${error.subject ?? "batch"}-${error.message}`}>
                {error.subject ? `${error.subject}: ` : ""}
                {error.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section aria-labelledby="marks-sheet-heading">
        <p className="section-label" id="marks-sheet-heading">
          Marks sheet
        </p>
        <div className="table--scroll">
          <table className={`table ${styles.entryTable}`}>
            <caption className="sr-only">
              Marks entry sheet for {batch.exam} · {batch.className}
            </caption>
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col">Max</th>
                <th scope="col">Obtained</th>
                <th scope="col">Grade</th>
                <th scope="col">Teacher remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.subject} className={fieldErrors[index] ? styles.invalidRow : undefined}>
                  <td>
                    <strong>{row.subject}</strong>
                  </td>
                  <td className="num">{row.max}</td>
                  <td className={fieldErrors[index] ? "field--invalid" : undefined}>
                    {editable ? (
                      <div className={styles.inputCell}>
                        <label className="sr-only" htmlFor={`obtained-${index}`}>
                          Obtained marks — {row.subject}
                        </label>
                        <input
                          id={`obtained-${index}`}
                          className={`input ${styles.markInput}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={row.max}
                          step="0.5"
                          value={row.obtained ?? ""}
                          onChange={(event) => setObtained(index, event.target.value)}
                          aria-invalid={fieldErrors[index] ? true : undefined}
                          aria-describedby={fieldErrors[index] ? `mark-error-${index}` : undefined}
                        />
                        {row.obtained === null ? <span className={styles.notEntered}>Not entered</span> : null}
                      </div>
                    ) : (
                      <span className="num">{row.obtained ?? "—"}</span>
                    )}
                    {fieldErrors[index] ? (
                      <p id={`mark-error-${index}`} className="field-error">
                        {fieldErrors[index]}
                      </p>
                    ) : null}
                  </td>
                  <td>
                    {row.obtained === null ? (
                      <span className={styles.gradeEmpty}>—</span>
                    ) : (
                      <span className={styles.grade}>{gradeForPercentage((row.obtained / row.max) * 100)}</span>
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <label className="sr-only" htmlFor={`remark-${index}`}>
                        Teacher remark — {row.subject}
                      </label>
                    ) : null}
                    {editable ? (
                      <input
                        id={`remark-${index}`}
                        className={`input ${styles.remarkInput}`}
                        type="text"
                        maxLength={140}
                        value={row.remark ?? ""}
                        onChange={(event) => setRemark(index, event.target.value)}
                      />
                    ) : (
                      <span className={styles.remark}>{row.remark ?? "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="entry-actions-heading">
        <p className="section-label" id="entry-actions-heading">
          Actions
        </p>
        <div className={styles.actions}>
          {editable ? (
            <>
              <Button variant="quiet" onClick={saveDraft} disabled={busy !== null}>
                Save draft
              </Button>
              <Button variant="primary" onClick={submitForModeration} disabled={busy !== null}>
                Submit for moderation
              </Button>
            </>
          ) : null}
          {awaitingModeration && canApprove ? (
            <>
              <Button variant="primary" onClick={approve} disabled={busy !== null}>
                Approve
              </Button>
              <Button variant="quiet" onClick={() => setReturnOpen(true)} disabled={busy !== null}>
                Return with reason
              </Button>
            </>
          ) : null}
          {batch.status === "approved" && canPublish ? (
            <Button variant="saffron" onClick={() => setPublishOpen(true)} disabled={busy !== null}>
              Publish
            </Button>
          ) : null}
          {batch.status === "published" && canPublish ? (
            <Button variant="quiet" onClick={() => setCorrectOpen(true)} disabled={busy !== null}>
              Create correction (v{nextVersion})
            </Button>
          ) : null}
          {batch.status === "published" && canPublish ? (
            <Button variant="quiet" onClick={() => setWithdrawOpen(true)} disabled={busy !== null}>
              Withdraw publication
            </Button>
          ) : null}
        </div>

        {returnOpen ? (
          <div className={styles.confirmPanel}>
            <label className={styles.confirmLabel} htmlFor="return-reason">
              Reason for returning to entry
            </label>
            <textarea
              id="return-reason"
              className="textarea"
              value={returnReason}
              onChange={(event) => setReturnReason(event.target.value)}
            />
            <div className={styles.confirmActions}>
              <Button variant="primary" onClick={confirmReturn} disabled={busy !== null}>
                Return to entry
              </Button>
              <Button variant="quiet" onClick={() => setReturnOpen(false)} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {publishOpen ? (
          <div className={styles.confirmPanel}>
            <p className={styles.confirmText}>
              <strong>
                Publish v{batch.version} to {batch.className}?
              </strong>{" "}
              A new publication reference is created and the portal report updates immediately (demo).
            </p>
            <div className={styles.confirmActions}>
              <Button variant="saffron" onClick={confirmPublish} disabled={busy !== null}>
                Publish v{batch.version}
              </Button>
              <Button variant="quiet" onClick={() => setPublishOpen(false)} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {correctOpen ? (
          <div className={styles.confirmPanel}>
            <label className={styles.confirmLabel} htmlFor="correction-reason">
              Reason for correction v{nextVersion}
            </label>
            <textarea
              id="correction-reason"
              className="textarea"
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
            />
            <p className={styles.confirmHelp}>
              The correction opens a new editable version; the published report stays on record.
            </p>
            <div className={styles.confirmActions}>
              <Button variant="primary" onClick={confirmCorrection} disabled={busy !== null}>
                Start correction v{nextVersion}
              </Button>
              <Button variant="quiet" onClick={() => setCorrectOpen(false)} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {withdrawOpen ? (
          <div className={styles.confirmPanel}>
            <p className={styles.confirmText}>
              <strong>
                Withdraw v{batch.version} from {batch.className}?
              </strong>{" "}
              The live portal report is removed and the term shows not-published; the published record stays on file
              (demo).
            </p>
            <label className={styles.confirmLabel} htmlFor="withdraw-reason">
              Reason for withdrawal
            </label>
            <textarea
              id="withdraw-reason"
              className="textarea"
              value={withdrawalReason}
              onChange={(event) => setWithdrawalReason(event.target.value)}
            />
            <p className={styles.confirmHelp}>
              The reason is recorded in the version history and on the retained publication record.
            </p>
            <div className={styles.confirmActions}>
              <Button variant="danger" onClick={confirmWithdraw} disabled={busy !== null}>
                Withdraw v{batch.version}
              </Button>
              <Button variant="quiet" onClick={() => setWithdrawOpen(false)} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {publishedRef ? (
          <p className={styles.publishSuccess}>
            <strong>
              Published as <span className="num">{publishedRef}</span> (demo).
            </strong>{" "}
            <a className="link-arrow" href="/portal/results">
              View in portal →
            </a>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="entry-version-history-heading">
        <p className="section-label" id="entry-version-history-heading">
          Version history
        </p>
        {versions.length > 0 ? (
          <ol className={styles.versionList}>
            {versions.map((version) => (
              <li key={version.version} className={styles.versionRow}>
                <strong className={`num ${styles.versionNum}`}>v{version.version}</strong>
                <span className={styles.versionCopy}>
                  <span className={styles.versionNote}>{version.note}</span>
                  <small>
                    {formatKolkata(version.atIso, { format: "full" })} · {version.by}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.noVersions}>No corrections recorded.</p>
        )}
      </section>

      <p className={styles.live} aria-live="polite">
        {live}
      </p>
    </div>
  );
}
