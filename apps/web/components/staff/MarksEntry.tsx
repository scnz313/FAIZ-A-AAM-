"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { formatKolkata } from "@/modules/iot/domain";
import { assignmentsCoverClass } from "@/modules/services/staff-authorization";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { academicsService, ENTRY_BATCH_STATUS_META, gradeForPercentage } from "@/modules/services/academics";
import type { AcademicError, BatchVersion, EntryBatch, MarksRow } from "@/modules/services/academics";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./MarksEntry.module.css";

const DEFAULT_ACTOR = "M. Wani (exam office)";

/** Minimum reason length for return/correction/withdrawal decisions. */
const REASON_MIN_LENGTH = 10;

/**
 * Local draft-save state for the autosave indicator. The service offers no
 * draft timestamp, so the indicator reports Saved/Unsaved only from local
 * save results — never fabricated times.
 */
type DraftSaveState = "idle" | "saving" | "saved" | "unsaved" | "error";

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

/** Readable fallback for a version row whose note is empty (e.g. an approval
 *  recorded without a moderation note). */
function versionStateLabel(state?: string): string {
  if (state === undefined || !(state in ENTRY_BATCH_STATUS_META)) return "";
  return ENTRY_BATCH_STATUS_META[state as keyof typeof ENTRY_BATCH_STATUS_META].label;
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

type MarksEntryProps = {
  batchRef: string;
  initialBatch: EntryBatch;
};

/**
 * The working marks-entry workspace: editable sheet, inline validation,
 * draft save, submit for moderation, returned-with-reason, approve,
 * publish confirmation (with a portal link), and correction v2. All state
 * transitions go through `academicsService`; demo mode re-reads the batch on
 * mount so the session state is always the source of truth.
 */
export function MarksEntry({ batchRef, initialBatch }: MarksEntryProps) {
  const supabaseMode = clientAdapterMode() === "supabase";
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
  const [returnReasonError, setReturnReasonError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionReasonError, setCorrectionReasonError] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [withdrawalReasonError, setWithdrawalReasonError] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<DraftSaveState>("idle");
  const summaryRef = useRef<HTMLDivElement>(null);
  const { summary } = useStaffContext();
  /* Phase-1 split: moderation actions (approve/return) belong to exam
     reviewers (results.approve); publish and correction belong to result
     publishers (results.publish). Entry controls keep the teacher
     results.enter scope below. The entry officer may also raise a correction
     request, which an independent reviewer approves before an editable
     version opens. */
  const canEnter = canAnyRole(summary?.roles ?? [], "results.enter");
  const canApprove = canAnyRole(summary?.roles ?? [], "results.approve");
  const canPublish = canAnyRole(summary?.roles ?? [], "results.publish");
  const canRequestCorrection = canEnter || canPublish;
  const profileCode = summary?.profileCode ?? null;

  useEffect(() => {
    let cancelled = false;
    const batchRequest = supabaseMode ? Promise.resolve(initialBatch) : academicsService.getBatch(batchRef);
    void Promise.all([batchRequest, academicsService.listVersions(batchRef)])
      .then(([nextBatch, nextVersions]) => {
        if (cancelled) return;
        if (nextBatch) {
          setBatch(nextBatch);
          setRows(cloneRows(nextBatch.rows));
        }
        setVersions(nextVersions);
      })
      .catch(() => {
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [batchRef, initialBatch, supabaseMode]);

  function applyBatch(next: EntryBatch) {
    setBatch(next);
    setRows(cloneRows(next.rows));
    setFieldErrors({});
    setSubmitErrors([]);
    /* Rows now match the persisted batch, so no local edits are pending. */
    setDraftState("idle");
    void academicsService.listVersions(batchRef).then(setVersions).catch(() => {});
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
    setDraftState("unsaved");
  }

  function setRemark(index: number, raw: string) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, remark: raw } : row)));
    setDraftState("unsaved");
  }

  async function saveDraft() {
    setBusy("save");
    setDraftState("saving");
    const result = await academicsService.saveEntryDraft(batchRef, rows);
    setBusy(null);
    if (!result.ok) {
      setDraftState("error");
      setSubmitErrors(result.errors);
      focusSummary();
      return;
    }
    applyBatch(result.value);
    setDraftState("saved");
    setLive(`Draft saved${supabaseMode ? "" : " (demo)"} · ${result.value.ref}`);
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
    setLive(`${result.value.ref} submitted for moderation${supabaseMode ? "" : " (demo)"}`);
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
    setLive(`${result.value.ref} approved${supabaseMode ? "" : " (demo)"}`);
  }

  async function confirmReturn() {
    if (returnReason.trim().length < REASON_MIN_LENGTH) {
      setReturnReasonError(`A reason of at least ${REASON_MIN_LENGTH} characters is required · it is recorded on the batch.`);
      return;
    }
    setReturnReasonError(null);
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
    setLive(`${result.value.ref} returned to entry with a reason${supabaseMode ? "" : " (demo)"}`);
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
    setLive(`Published as ${result.value.ref}${supabaseMode ? "" : " (demo)"}`);
  }

  async function confirmCorrection() {
    if (correctionReason.trim().length < REASON_MIN_LENGTH) {
      setCorrectionReasonError(`A reason of at least ${REASON_MIN_LENGTH} characters is required · it is recorded in the version history.`);
      return;
    }
    setCorrectionReasonError(null);
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
    setLive(
      supabaseMode
        ? "Correction requested · an independent exam reviewer must approve it before the new editable version opens."
        : `Correction v${result.value.version} started (demo)`,
    );
  }

  async function confirmWithdraw() {
    if (withdrawalReason.trim().length < REASON_MIN_LENGTH) {
      setWithdrawalReasonError(`A reason of at least ${REASON_MIN_LENGTH} characters is required · it is recorded with the withdrawal.`);
      return;
    }
    setWithdrawalReasonError(null);
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
    setLive(`${result.value.ref} withdrawn · the live portal publication was removed${supabaseMode ? "" : " (demo)"}`);
  }

  if (!batch) {
    return <p className={styles.loading}>Loading marks entry workspace…</p>;
  }

  const meta = ENTRY_BATCH_STATUS_META[batch.status];
  const editable = batch.status === "draft" || batch.status === "returned";
  const awaitingModeration = batch.status === "submitted" || batch.status === "moderation";
  const enteredCount = rows.filter((row) => row.obtained !== null).length;
  /* Live sheets are a student × assessment matrix (one row per roster
     candidate and component); demo sheets are one row per subject. */
  const studentMatrix = rows.some((row) => (row.studentName ?? "").trim() !== "");
  const hasActions =
    editable
    || (awaitingModeration && canApprove)
    || (batch.status === "approved" && canPublish)
    || (batch.status === "published" && (canRequestCorrection || canPublish));
  const noActionNote =
    batch.status === "submitted" || batch.status === "moderation"
      ? "Awaiting an exam reviewer's moderation decision. No action is required from this workspace."
      : batch.status === "approved"
        ? "Awaiting a result publisher. No action is required from this workspace."
        : batch.status === "published"
          ? "Published. A correction request can be raised by the result entry officer or a result publisher."
          : batch.status === "withdrawn"
            ? "This sheet is withdrawn; no action is available in this workspace."
            : "No action is available for this sheet with your role.";

  return (
    <div className={styles.workspace}>
      <header className={`workspace-header ${styles.header}`}>
        <p className={styles.backLink}>
          <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, `/results/${batch.ref}`)}>
            ← {batch.exam} · {batch.className}
          </Link>
        </p>
        <p className="eyebrow">Staff · Results · Marks entry</p>
        <h1 className="workspace-title">Marks entry</h1>
        <p className={`workspace-intro ${styles.meta}`}>
          <span className="num">{batch.ref}</span> · {batch.exam} · {batch.className} · {enteredCount}/
          {rows.length} marks entered · v{batch.version}
        </p>
        <div className={styles.badgeRow}>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
          {!supabaseMode ? <span className="demo-badge">Demo data</span> : null}
        </div>
      </header>

      {batch.status === "returned" && batch.returnedReason ? (
        <div className={styles.returnedPanel}>
          <p className="section-label">Returned by moderation</p>
          <p className={styles.returnedReason}>“{batch.returnedReason}”</p>
          <p className={styles.returnedHint}>Re-edit the sheet and submit again; the reason stays on record.</p>
        </div>
      ) : null}

      {batch.status === "published" && batch.pendingCorrectionReason ? (
        <div className={styles.returnedPanel}>
          <p className="section-label">Correction pending review</p>
          <p className={styles.returnedReason}>“{batch.pendingCorrectionReason}”</p>
          <p className={styles.returnedHint}>
            An independent exam reviewer approves the request. The published report stays on the portal until the
            corrected version is reviewed and published.
          </p>
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
                <th scope="col">{studentMatrix ? "Student" : "Subject"}</th>
                <th scope="col">Max</th>
                <th scope="col">Obtained</th>
                <th scope="col">Grade</th>
                <th scope="col">Teacher remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.rosterId !== undefined ? `${row.rosterId}-${row.componentId ?? ""}` : `${row.subject}-${index}`} className={fieldErrors[index] ? styles.invalidRow : undefined}>
                  <td>
                    {studentMatrix ? (
                      <>
                        <strong>{row.studentName ?? "Student"}</strong>
                        {row.componentName !== undefined ? (
                          <span className={styles.rowSub}>{row.componentName}</span>
                        ) : null}
                      </>
                    ) : (
                      <strong>{row.subject}</strong>
                    )}
                  </td>
                  <td className="num">{row.max}</td>
                  <td className={fieldErrors[index] ? "field--invalid" : undefined}>
                    {editable ? (
                      <div className={styles.inputCell}>
                        <label className="sr-only" htmlFor={`obtained-${index}`}>
                          Obtained marks · {row.subject}
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
                        Teacher remark · {row.subject}
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
        {editable ? (
          <p className={styles.draftStatus} role="status">
            {busy === "save"
              ? "Saving…"
              : draftState === "saved"
                ? "Saved. Reload restores this draft."
                : draftState === "unsaved"
                  ? "Unsaved changes."
                  : draftState === "error"
                    ? "Save failed · review the errors above."
                    : enteredCount > 0
                      ? `Draft in progress · ${enteredCount}/${rows.length} entered. Reload restores your last saved draft.`
                      : "No marks entered yet. Reload restores your last saved draft."}
          </p>
        ) : null}
        {hasActions ? (
          <div className={styles.actions}>
            {editable ? (
              <>
                <Button variant="quiet" onClick={saveDraft} disabled={busy !== null}>
                  {busy === "save" ? "Saving draft…" : "Save draft"}
                </Button>
                <Button variant="primary" onClick={submitForModeration} disabled={busy !== null}>
                  {busy === "submit" ? "Submitting…" : "Submit for moderation"}
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
            {batch.status === "published" && canRequestCorrection ? (
              <Button variant="quiet" onClick={() => setCorrectOpen(true)} disabled={busy !== null}>
                Request correction
              </Button>
            ) : null}
            {batch.status === "published" && canPublish ? (
              <Button variant="quiet" onClick={() => setWithdrawOpen(true)} disabled={busy !== null}>
                Withdraw publication
              </Button>
            ) : null}
          </div>
        ) : (
          <p className={`small muted ${styles.noActionNote}`}>{noActionNote}</p>
        )}

        {returnOpen ? (
          <div
            className={styles.confirmPanel}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setReturnOpen(false);
                setReturnReasonError(null);
              }
            }}
          >
            <label className={styles.confirmLabel} htmlFor="return-reason">
              Reason for returning to entry (required)
            </label>
            <textarea
              id="return-reason"
              className={`textarea ${returnReasonError ? "field--invalid" : ""}`}
              value={returnReason}
              onChange={(event) => {
                setReturnReason(event.target.value);
                if (returnReasonError) setReturnReasonError(null);
              }}
              aria-required="true"
              aria-invalid={returnReasonError ? true : undefined}
              aria-describedby={returnReasonError ? "return-reason-error" : undefined}
            />
            {returnReasonError ? (
              <p id="return-reason-error" className="field-error" role="alert">
                {returnReasonError}
              </p>
            ) : null}
            <div className={styles.confirmActions}>
              <Button variant="primary" onClick={confirmReturn} disabled={busy !== null}>
                Return to entry
              </Button>
              <Button variant="quiet" onClick={() => { setReturnOpen(false); setReturnReasonError(null); }} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {publishOpen ? (
          <div
            className={styles.confirmPanel}
            onKeyDown={(event) => {
              if (event.key === "Escape") setPublishOpen(false);
            }}
          >
            <p className={styles.confirmText}>
              <strong>
                Publish v{batch.version} to {batch.className}?
              </strong>{" "}
              A new publication reference is created
              {supabaseMode
                ? "; each student's report release is assembled separately before families can view it."
                : " and the portal report updates immediately (demo)."}
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
          <div
            className={styles.confirmPanel}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setCorrectOpen(false);
                setCorrectionReasonError(null);
              }
            }}
          >
            <label className={styles.confirmLabel} htmlFor="correction-reason">
              Reason for correction (required)
            </label>
            <textarea
              id="correction-reason"
              className={`textarea ${correctionReasonError ? "field--invalid" : ""}`}
              value={correctionReason}
              onChange={(event) => {
                setCorrectionReason(event.target.value);
                if (correctionReasonError) setCorrectionReasonError(null);
              }}
              aria-required="true"
              aria-invalid={correctionReasonError ? true : undefined}
              aria-describedby={correctionReasonError ? "correction-reason-error" : undefined}
            />
            {correctionReasonError ? (
              <p id="correction-reason-error" className="field-error" role="alert">
                {correctionReasonError}
              </p>
            ) : null}
            <p className={styles.confirmHelp}>
              An independent exam reviewer approves the request, which opens a new editable version. The published
              report stays on record.
            </p>
            <div className={styles.confirmActions}>
              <Button variant="primary" onClick={confirmCorrection} disabled={busy !== null}>
                Request correction
              </Button>
              <Button variant="quiet" onClick={() => { setCorrectOpen(false); setCorrectionReasonError(null); }} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {withdrawOpen ? (
          <div
            className={styles.confirmPanel}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setWithdrawOpen(false);
                setWithdrawalReasonError(null);
              }
            }}
          >
            <p className={styles.confirmText}>
              <strong>
                Withdraw v{batch.version} from {batch.className}?
              </strong>{" "}
              The live portal report is removed and the term shows not-published; the published record stays on file
              {!supabaseMode ? " (demo)" : ""}.
            </p>
            <label className={styles.confirmLabel} htmlFor="withdraw-reason">
              Reason for withdrawal (required)
            </label>
            <textarea
              id="withdraw-reason"
              className={`textarea ${withdrawalReasonError ? "field--invalid" : ""}`}
              value={withdrawalReason}
              onChange={(event) => {
                setWithdrawalReason(event.target.value);
                if (withdrawalReasonError) setWithdrawalReasonError(null);
              }}
              aria-required="true"
              aria-invalid={withdrawalReasonError ? true : undefined}
              aria-describedby={withdrawalReasonError ? "withdraw-reason-error" : undefined}
            />
            {withdrawalReasonError ? (
              <p id="withdraw-reason-error" className="field-error" role="alert">
                {withdrawalReasonError}
              </p>
            ) : null}
            <p className={styles.confirmHelp}>
              The reason is recorded in the version history and on the retained publication record.
            </p>
            <div className={styles.confirmActions}>
              <Button variant="danger" onClick={confirmWithdraw} disabled={busy !== null}>
                Withdraw v{batch.version}
              </Button>
              <Button variant="quiet" onClick={() => { setWithdrawOpen(false); setWithdrawalReasonError(null); }} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {publishedRef ? (
          <p className={styles.publishSuccess}>
            <strong>
              Published as <span className="num">{publishedRef}</span>
              {!supabaseMode ? " (demo)" : ""}.
            </strong>{" "}
            <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, `/results/${batch.ref}`)}>
              View the publication record →
            </Link>
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
                  <span className={styles.versionNote}>{version.note || versionStateLabel(version.state)}</span>
                  {version.atIso || version.by ? (
                    <small>{[version.atIso ? formatKolkata(version.atIso, { format: "full" }) : "", version.by ?? ""].filter(Boolean).join(" · ")}</small>
                  ) : null}
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
