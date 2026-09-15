"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";

import Button from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { usersService } from "@/modules/services/users";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import {
  applicationReviewer,
  careersService,
  type JobApplicationRecord,
  type JobApplicationStatus,
} from "@/modules/services/careers";

import styles from "./JobReview.module.css";

const STATUS_TONE: Record<JobApplicationStatus, StatusTone> = {
  Submitted: "neutral",
  "Eligibility review": "watch",
  Shortlisted: "watch",
  Interview: "watch",
  Offered: "good",
  "Not selected": "neutral",
  Withdrawn: "neutral",
};

/** Terminal statuses: the whole recorded timeline is shown as done. */
const TERMINAL_STATUSES: ReadonlySet<JobApplicationStatus> = new Set(["Offered", "Not selected", "Withdrawn"]);

/** Minimal fictional qualification detail, keyed by application ref. */
const QUALIFICATION_LINES: Record<string, { qualification: string; experience: string }> = {
  "JOB-2026-0112": { qualification: "B.Sc. Mathematics · B.Ed.", experience: "4 years · classes 8 to 10" },
  "JOB-2026-0113": { qualification: "B.Sc. Mathematics · B.Ed.", experience: "2 years · school and tuition" },
  "JOB-2026-0114": { qualification: "M.A. English · B.Ed.", experience: "3 years · middle section" },
  "JOB-2026-0115": { qualification: "M.A. English · B.Ed.", experience: "1 year · student teaching" },
  "JOB-2026-0108": { qualification: "B.Sc. Physics", experience: "5 years · school laboratory" },
};

const DOCUMENTS = ["CV", "Certificates", "Identity proof"] as const;

type DocumentKey = (typeof DOCUMENTS)[number];
type DemoFileState = "demo-preview" | "missing" | "access-denied";

type DocumentMetadata = {
  format: string;
  size: string;
  updated: string;
  description: string;
  initialState: DemoFileState;
};

const DOCUMENT_METADATA: Record<DocumentKey, DocumentMetadata> = {
  CV: {
    format: "PDF-like metadata preview",
    size: "Not provided",
    updated: "Submitted with demo application",
    description: "A fictional CV preview for the demo application.",
    initialState: "demo-preview",
  },
  Certificates: {
    format: "PDF-like metadata preview",
    size: "Not provided",
    updated: "Submitted with demo application",
    description: "A fictional qualification-certificate record with a missing attachment state for recovery review.",
    initialState: "missing",
  },
  "Identity proof": {
    format: "PDF-like metadata preview",
    size: "Not provided",
    updated: "Submitted with demo application",
    description: "A fictional identity-proof record. No identity image or document is rendered.",
    initialState: "demo-preview",
  },
};

const SCORE_LABELS = ["Qualifications & certifications", "Relevant experience"] as const;

type TimelineEvent = {
  id: string;
  label: string;
  state: "done" | "current";
  meta?: string;
  note?: string;
};

const STATE_CLASS = {
  done: styles.itemDone,
  current: styles.itemCurrent,
} as const;

/* ------------------------------------------------------------------ */
/* Decision actions                                                    */
/* ------------------------------------------------------------------ */

type DecisionKind = "shortlist" | "interview" | "offer" | "not-selected";

type DecisionMeta = {
  label: string;
  result: JobApplicationStatus;
  noteRequired: boolean;
  noteLabel: string;
  noteHelp: string;
  confirmTitle: string;
  confirmText: string;
};

const DECISIONS: Record<DecisionKind, DecisionMeta> = {
  shortlist: {
    label: "Shortlist",
    result: "Shortlisted",
    noteRequired: false,
    noteLabel: "Note (optional)",
    noteHelp: "Optional · recorded in the timeline and included in the applicant's status email.",
    confirmTitle: "Shortlist this candidate?",
    confirmText: "The applicant's status becomes Shortlisted and a timeline event is recorded.",
  },
  interview: {
    label: "Request interview",
    result: "Interview",
    noteRequired: false,
    noteLabel: "Note (optional)",
    noteHelp: "Optional · recorded in the timeline and included in the applicant's interview email.",
    confirmTitle: "Request an interview?",
    confirmText: "The applicant's status becomes Interview and a demo slot three days from now is attached.",
  },
  offer: {
    label: "Offer position",
    result: "Offered",
    noteRequired: true,
    noteLabel: "Reason (required)",
    noteHelp: "Record why this candidate is being offered the position.",
    confirmTitle: "Offer this position?",
    confirmText: "The applicant's status becomes Offered. The reason is recorded in the timeline.",
  },
  "not-selected": {
    label: "Not selected",
    result: "Not selected",
    noteRequired: true,
    noteLabel: "Reason (required)",
    noteHelp: "Record why the candidate is not being selected.",
    confirmTitle: "Record as not selected?",
    confirmText: "The applicant's status becomes Not selected and the application closes.",
  },
};

/** Which decisions are valid from each status; everything else is disabled. */
const ACTIONS_BY_STATUS: Record<JobApplicationStatus, readonly DecisionKind[]> = {
  Submitted: ["shortlist", "not-selected"],
  "Eligibility review": ["shortlist", "not-selected"],
  Shortlisted: ["interview", "not-selected"],
  Interview: ["offer", "not-selected"],
  Offered: [],
  "Not selected": [],
  Withdrawn: [],
};

const MIN_REASON_LENGTH = 10;

const FILE_STATES: ReadonlyArray<{ value: DemoFileState; label: string }> = [
  { value: "demo-preview", label: "Demo preview · metadata only" },
  { value: "missing", label: "Missing file" },
  { value: "access-denied", label: "Access denied" },
];

const STATE_COPY: Record<DemoFileState, { title: string; description: string }> = {
  "demo-preview": {
    title: "Demo preview only",
    description: "This sheet shows fictional metadata. No private file is served by the frontend demo.",
  },
  missing: {
    title: "File not available",
    description: "The record has metadata, but no file is attached to this demo record yet. Ask the candidate to re-upload it.",
  },
  "access-denied": {
    title: "Access denied",
    description: "This simulates a server authorization response. Ask an administrator to confirm reviewer scope. No private file was requested or exposed.",
  },
};

const DOWNLOAD_COPY: Record<DemoFileState, string> = {
  "demo-preview": "Demo file not provided · this preview contains metadata only, so no download started.",
  missing: "Demo file not provided · this record has no attached file. Ask the candidate to re-upload it.",
  "access-denied": "Demo download blocked · access denied. No private file was requested or exposed.",
};

type PreviewDocument = DocumentMetadata & {
  title: string;
  fileName: string;
};

function DocumentPreviewDialog({
  file,
  trigger,
  onClose,
}: {
  file: PreviewDocument;
  trigger: HTMLButtonElement | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [fileState, setFileState] = useState<DemoFileState>(file.initialState);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  function closeDialog() {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    onClose();
    trigger?.focus();
  }

  function selectState(value: DemoFileState) {
    setFileState(value);
    setDownloadMessage(null);
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.previewDialog}
      aria-labelledby="job-document-preview-title"
      aria-describedby="job-document-preview-live-state"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
    >
      <div className={styles.previewContent}>
        <div className={styles.previewHeader}>
          <div>
            <p className="section-label">Career document · demo</p>
            <h2 id="job-document-preview-title" className={styles.previewTitle}>
              {file.title}
            </h2>
          </div>
          <button ref={closeRef} type="button" className={`button button--quiet ${styles.previewClose}`} onClick={closeDialog}>
            Close
          </button>
        </div>

        <dl className={styles.previewMeta}>
          <div>
            <dt>Demo file label</dt>
            <dd className="num">{file.fileName}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{file.format}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{file.size}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{file.updated}</dd>
          </div>
        </dl>

        <div className={styles.previewControl}>
          <label htmlFor="job-document-preview-selector">Demo file state</label>
          <select
            id="job-document-preview-selector"
            className="select"
            value={fileState}
            onChange={(event) => selectState(event.target.value as DemoFileState)}
          >
            {FILE_STATES.map((state) => (
              <option key={state.value} value={state.value}>
                {state.label}
              </option>
            ))}
          </select>
          <p className="field-help">State selector for review only · it does not call storage or authorization services.</p>
        </div>

        <section
          id="job-document-preview-live-state"
          className={styles.previewState}
          data-state={fileState}
          role={fileState === "demo-preview" ? "status" : "alert"}
          aria-live="polite"
        >
          <p className={styles.previewStateTitle}>{STATE_COPY[fileState].title}</p>
          <p>{STATE_COPY[fileState].description}</p>
          <div className={styles.previewSheet} aria-label="Fictional demo document preview">
            <span className={styles.previewWatermark}>FICTIONAL DEMO · NOT AN OFFICIAL DOCUMENT</span>
            <strong>{file.title}</strong>
            <span>{file.description}</span>
          </div>
        </section>

        {downloadMessage ? (
          <p className={styles.downloadMessage} role="alert" aria-live="assertive">
            {downloadMessage}
          </p>
        ) : null}

        <div className={styles.previewActions}>
          <button type="button" className="button button--primary" onClick={() => setDownloadMessage(DOWNLOAD_COPY[fileState])}>
            Download demo
          </button>
          <button type="button" className="button button--quiet" onClick={closeDialog}>
            Close preview
          </button>
        </div>
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Decision confirmation modal                                         */
/* ------------------------------------------------------------------ */

/**
 * Decision confirmation modal. Reuses the in-file dialog pattern from
 * DocumentPreviewDialog. Shows the exact object, the status transition, the
 * consequences, and the required note. Safe default focus is Close.
 */
function DecisionConfirmDialog({
  applicationRef,
  candidateName,
  vacancyTitle,
  actionLabel,
  currentStatus,
  targetStatus,
  consequences,
  note,
  demoMode,
  processing,
  error,
  trigger,
  onClose,
  onConfirm,
}: {
  applicationRef: string;
  candidateName: string;
  vacancyTitle: string;
  actionLabel: string;
  currentStatus: string;
  targetStatus: string;
  consequences: string;
  note: string;
  demoMode: boolean;
  processing: boolean;
  error: string | null;
  trigger: HTMLButtonElement | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  function closeDialog() {
    if (processing) return;
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    onClose();
    trigger?.focus();
  }

  function trapTab(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
    if (focusable.length === 0) return;
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.confirmDialog}
      aria-labelledby="job-decision-confirm-title"
      aria-describedby="job-decision-confirm-desc"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onKeyDown={trapTab}
    >
      <div className={styles.confirmContent}>
        <div className={styles.confirmHeader}>
          <div>
            <p className="section-label">Confirm decision</p>
            <h2 id="job-decision-confirm-title" className={styles.confirmTitle}>
              {actionLabel}?
            </h2>
          </div>
          <button ref={cancelRef} type="button" className="button button--quiet" onClick={closeDialog} disabled={processing}>
            Close
          </button>
        </div>
        <div id="job-decision-confirm-desc">
          <div className="facts-ledger">
            <div className="fl-row">
              <span className="k">Object</span>
              <span className="v num">{applicationRef}</span>
            </div>
            <div className="fl-row">
              <span className="k">Candidate</span>
              <span className="v">{candidateName}</span>
            </div>
            <div className="fl-row">
              <span className="k">Vacancy</span>
              <span className="v">{vacancyTitle}</span>
            </div>
            <div className="fl-row">
              <span className="k">Transition</span>
              <span className="v">{currentStatus} to {targetStatus}</span>
            </div>
            <div className="fl-row">
              <span className="k">Note</span>
              <span className="v">{note}</span>
            </div>
          </div>
          <div className="callout" style={{ marginTop: 14 }}>
            <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
              info
            </span>
            <span className="small">{consequences} Recorded{demoMode ? " in the demo session" : ""} with actor and timestamp. It is not undone here.</span>
          </div>
        </div>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.confirmActions}>
          <Button variant="primary" disabled={processing} onClick={onConfirm}>
            {processing ? "Recording..." : "Confirm"}
          </Button>
          <Button variant="quiet" disabled={processing} onClick={closeDialog}>
            Cancel
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline derivation                                                 */
/* ------------------------------------------------------------------ */

/** The recorded events: earlier stages done, the latest marked current until a terminal status. */
function timelineFor(record: JobApplicationRecord): TimelineEvent[] {
  return record.timeline.map((event, index) => {
    const last = index === record.timeline.length - 1;
    return {
      id: `${event.status}-${event.atIso}-${index}`,
      label: event.status,
      state: last && !TERMINAL_STATUSES.has(record.status) ? "current" : "done",
      meta: `${formatKolkata(event.atIso, { format: "full" })} · ${event.actor}`,
      note: event.note,
    };
  });
}

/**
 * Resolve a reviewer id to a display name for the loaded record. Account ids
 * are internal identifiers: when no directory name resolves, a raw id reads
 * "Assigned reviewer" instead of leaking the identifier into the interface.
 * Exported for the reviewer-label regression test.
 */
export function reviewerDisplayName(
  value: string | undefined,
  directory: ReadonlyArray<{ accountId: string; name: string }>,
): string | null {
  if (value === undefined || value.trim() === "") return null;
  const match = directory.find((candidate) => candidate.accountId === value);
  if (match !== undefined && match.name.trim() !== "") return match.name;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
    ? "Assigned reviewer"
    : value;
}

/**
 * Humanize a document requirement code or category for the staff panel
 * ("profile_photo" reads "Profile photo"). Exported for the regression test.
 */
export function documentLabel(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  if (words === "") return "Document";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Merge the immutable snapshot's document map with linked attachment rows
 * (`job_documents`, e.g. the public intake's profile photo). RLS already
 * withheld any file the staff may not read, so an absent photo never renders
 * as an empty attachment. Exported for the regression test.
 */
export function mergeAttachedDocuments(
  snapshot: Record<string, unknown> | undefined,
  linked: ReadonlyArray<{ requirementCode: string | null; reference: string; filename: string; category: string }>,
): Array<{ label: string; reference: string; filename?: string }> {
  const merged: Array<{ label: string; reference: string; filename?: string }> = [];
  const raw = snapshot?.documents;
  if (raw !== null && raw !== undefined && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [label, reference] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof reference === "string" && reference.trim() !== "") merged.push({ label, reference });
    }
  }
  const seen = new Set(merged.map((document) => document.reference));
  for (const document of linked) {
    if (seen.has(document.reference)) continue;
    seen.add(document.reference);
    merged.push({
      label: documentLabel(document.requirementCode ?? document.category),
      reference: document.reference,
      filename: document.filename,
    });
  }
  return merged;
}

/**
 * Display rows for the contact identity recorded on the application. The
 * public intake writes email/phone onto the application row; account-bound
 * records keep them on the applicant's account, so absent values are omitted
 * rather than rendered as an invented placeholder. Exported for the
 * regression test.
 */
export function contactDetailRows(record: {
  contactEmail?: string;
  contactPhone?: string;
}): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (record.contactEmail !== undefined && record.contactEmail.trim() !== "") {
    rows.push({ label: "Email", value: record.contactEmail });
  }
  if (record.contactPhone !== undefined && record.contactPhone.trim() !== "") {
    rows.push({ label: "Phone", value: record.contactPhone });
  }
  return rows;
}

/**
 * Staff review of a single job application: application and document panels
 * on the left; the ruled status timeline, reviewer scorecard, and reasoned
 * decision actions on the right. The server page SSR-renders the `initial`
 * record; demo mode refreshes it from the careers service on mount, and every
 * decision refreshes it in either mode, so the status, timeline, and badge
 * always match the persisted record — never a local echo.
 */
export function JobReview({
  applicationRef,
  initial,
  vacancyTitle,
}: {
  applicationRef: string;
  initial: JobApplicationRecord;
  vacancyTitle: string;
}) {
  const supabaseMode = clientAdapterMode() === "supabase";
  const [record, setRecord] = useState<JobApplicationRecord>(initial);
  const [refreshing, setRefreshing] = useState(!supabaseMode);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [draft, setDraft] = useState<DecisionKind | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewDocument | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [scoreInput, setScoreInput] = useState("5");
  const [scoreNotes, setScoreNotes] = useState("");
  const [savingScore, setSavingScore] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const [reviewers, setReviewers] = useState<Array<{ accountId: string; name: string }>>([]);
  const [reviewerChoice, setReviewerChoice] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  async function handleAssignReviewer() {
    if (assigning || reviewerChoice === "") return;
    setAssigning(true);
    setAssignError(null);
    try {
      const updated = await careersService.assignReviewer(applicationRef, reviewerChoice);
      setRecord(updated);
      setAnnouncement("Reviewer assigned · the scorecard and shortlist can now be recorded.");
    } catch (error) {
      setAssignError(error instanceof Error ? error.message : "The reviewer could not be assigned.");
    } finally {
      setAssigning(false);
    }
  }

  async function handleSaveScorecard() {
    if (savingScore) return;
    const numeric = Number(scoreInput);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) {
      setScoreError("Score must be a whole number from 1 to 5.");
      return;
    }
    setSavingScore(true);
    setScoreError(null);
    try {
      const updated = await careersService.saveScorecard(applicationRef, numeric, scoreNotes);
      setRecord(updated);
      setScoreNotes("");
      setAnnouncement(`Scorecard saved · ${numeric} / 5.`);
    } catch (error) {
      setScoreError(error instanceof Error ? error.message : "The scorecard could not be saved.");
    } finally {
      setSavingScore(false);
    }
  }

  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const decisionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement | null>(null);
  const lastRef = useRef(initial.ref);

  const load = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const latest = await careersService.getApplication(applicationRef);
      if (latest) setRecord(latest);
      else setRefreshError(`Application ${applicationRef} is not in the demo records.`);
    } catch {
      setRefreshError("We could not load this application right now. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }, [applicationRef]);

  useEffect(() => {
    if (supabaseMode) {
      setRecord(initial);
      setRefreshing(false);
      setRefreshError(null);
      return;
    }
    void load();
  }, [initial, load, supabaseMode]);

  /* A client-side navigation to another application must not keep the old
     record between the prop change and the refreshed fetch. */
  useEffect(() => {
    if (lastRef.current !== initial.ref) {
      lastRef.current = initial.ref;
      setRecord(initial);
    }
  }, [initial]);

  useEffect(() => {
    if (draft && !confirming) noteRef.current?.focus();
  }, [draft, confirming]);

  function openDocument(file: PreviewDocument, trigger: HTMLButtonElement) {
    previewTriggerRef.current = trigger;
    setPreview(file);
  }

  function openDecision(kind: DecisionKind) {
    setDraft(kind);
    setNote("");
    setNoteError(null);
    setActionError(null);
    setConfirming(false);
    setAnnouncement(null);
  }

  function cancelDecision() {
    setDraft(null);
    setNote("");
    setNoteError(null);
    setActionError(null);
    setConfirming(false);
    setTimeout(() => actionsRef.current?.focus(), 0);
  }

  function cancelConfirmOnly() {
    setConfirming(false);
    setActionError(null);
    requestAnimationFrame(() => {
      if (confirmTriggerRef.current && document.contains(confirmTriggerRef.current)) confirmTriggerRef.current.focus();
      else noteRef.current?.focus();
    });
  }

  function handleContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const meta = DECISIONS[draft];
    if (meta.noteRequired && note.trim().length < MIN_REASON_LENGTH) {
      setNoteError(`Add a reason of at least ${MIN_REASON_LENGTH} characters. The note is recorded with the decision.`);
      noteRef.current?.focus();
      return;
    }
    setNoteError(null);
    const active = document.activeElement;
    confirmTriggerRef.current = active instanceof HTMLButtonElement ? active : null;
    setConfirming(true);
  }

  async function handleDecision(kind: DecisionKind) {
    if (processing) return;
    setProcessing(true);
    setActionError(null);
    try {
      const reason = note.trim() || undefined;
      const updated =
        kind === "shortlist"
          ? await careersService.staffShortlist(applicationRef, reason)
          : kind === "interview"
            ? await careersService.staffRequestInterview(applicationRef, reason)
            : kind === "offer"
              ? await careersService.staffOffer(applicationRef, reason ?? "")
              : await careersService.staffNotSelected(applicationRef, reason ?? "");
      /* Re-fetch so the view reflects the persisted record, not a local echo. */
      const latest = await careersService.getApplication(applicationRef);
      setRecord(latest ?? updated);
      setDraft(null);
      setConfirming(false);
      setNote("");
      setAnnouncement(`Decision recorded · ${updated.name} is now ${updated.status}.`);
      decisionHeadingRef.current?.focus();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The decision could not be recorded. Please try again.");
    } finally {
      setProcessing(false);
    }
  }

  const snapshot = record.submittedSnapshot ?? {};
  const qualificationLine = supabaseMode
    ? {
        qualification:
          typeof snapshot.qualification === "string" && snapshot.qualification.trim() !== ""
            ? snapshot.qualification
            : "As listed in the vacancy",
        experience:
          typeof snapshot.experience === "string" && snapshot.experience.trim() !== ""
            ? snapshot.experience
            : typeof snapshot.currentRole === "string" && snapshot.currentRole.trim() !== ""
              ? snapshot.currentRole
              : "Not recorded",
      }
    : QUALIFICATION_LINES[applicationRef] ?? {
        qualification: "As listed in the vacancy",
        experience: "Not recorded",
      };
  const fileSlug = record.name.trim().toLowerCase().replace(/\s+/g, "-");
  const files: Record<DocumentKey, string> = {
    CV: `${fileSlug}-cv.demo.pdf`,
    Certificates: `${fileSlug}-certificates.demo.pdf`,
    "Identity proof": `${fileSlug}-identity.demo.pdf`,
  };

  const interviewScore = record.status === "Interview" || record.status === "Offered" ? "4 / 5" : "—";
  const timeline = timelineFor(record);
  const attachedDocuments = useMemo(
    () => mergeAttachedDocuments(record.submittedSnapshot, record.attachedDocuments ?? []),
    [record.submittedSnapshot, record.attachedDocuments],
  );
  const { summary } = useStaffContext();
  const profileCode = summary?.profileCode ?? null;
  const canReview = canAnyRole(summary?.roles ?? [], "careers.review");
  const canApprove = canAnyRole(summary?.roles ?? [], "careers.approve");
  const canDecide = canReview || canApprove;
  const assignedReviewer = supabaseMode
    ? reviewerDisplayName(record.reviewerAccountId, reviewers)
    : applicationReviewer(record);
  const reviewer = assignedReviewer;
  /* Decision kinds are capability-gated: the reviewer records
     shortlist/interview; the approver records offer/not-selected, and only
     after a separate reviewer decision has advanced the status. */
  const availableActions = ACTIONS_BY_STATUS[record.status].filter((kind) => {
    if (kind === "shortlist" || kind === "interview") return canReview;
    return canApprove && (record.status === "Shortlisted" || record.status === "Interview");
  });
  const withdrawn = record.status === "Withdrawn";

  /* Load the eligible HR reviewer directory for the approver's assignment
     control. A failed or unauthorized read keeps the control honest with the
     empty state below. */
  useEffect(() => {
    if (!canApprove) return;
    let cancelled = false;
    usersService
      .listUsers()
      .then((rows) => {
        if (cancelled) return;
        setReviewers(
          rows
            .filter((row) => row.accountId !== "" && row.status === "Active" && row.grants.some((grant) => grant.role === "hr_reviewer"))
            .map((row) => ({ accountId: row.accountId, name: row.name })),
        );
      })
      .catch(() => {
        if (!cancelled) setReviewers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canApprove]);

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className={styles.backLink}>
          <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/careers")}>
            ← Careers
          </Link>
        </p>
        <p className="eyebrow">Staff · Careers</p>
        <h1 className="workspace-title">{record.name}</h1>
        <p className={styles.meta}>
          <span className="num">{record.ref}</span> · {vacancyTitle}
        </p>
        <div className={styles.badgeRow}>
          <StatusBadge tone={STATUS_TONE[record.status]}>{record.status}</StatusBadge>
          {!supabaseMode ? <span className="demo-badge">Demo data</span> : null}
        </div>
        <p className={styles.reviewer}>
          {reviewer ? `Reviewer ${reviewer}` : "No reviewer assigned yet"}
        </p>
        {refreshing ? (
          <p className={styles.refreshLine} aria-live="polite">
            Refreshing application record…
          </p>
        ) : null}
        {refreshError ? (
          <div className={styles.refreshErrorRow}>
            <p className={styles.refreshLine} role="alert">
              {refreshError}
            </p>
            <Button variant="quiet" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}
      </header>

      <div className={styles.grid}>
        <div className={styles.column}>
          <section className={`panel ${styles.panel}`} aria-labelledby="application-heading">
            <h2 id="application-heading" className="section-label">
              Application
            </h2>
            <dl className={styles.detailList}>
              <div className={styles.detailRow}>
                <dt>Name</dt>
                <dd>{record.name}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Reference</dt>
                <dd className="num">{record.ref}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Vacancy</dt>
                <dd>{vacancyTitle}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Submitted</dt>
                <dd className="num">{formatKolkata(record.submittedAtIso, { format: "day" })}</dd>
              </div>
              {contactDetailRows(record).map((row) => (
                <div className={styles.detailRow} key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
              {record.interview ? (
                <div className={styles.detailRow}>
                  <dt>Interview slot</dt>
                  <dd className="num">{formatKolkata(record.interview.atIso, { format: "full" })}</dd>
                </div>
              ) : null}
              <div className={styles.detailRow}>
                <dt>Qualifications</dt>
                <dd>{qualificationLine.qualification}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Experience</dt>
                <dd>{qualificationLine.experience}</dd>
              </div>
            </dl>
          </section>

          <section className={`panel ${styles.panel}`} aria-labelledby="interview-panel-heading">
            <div className="pn-head">
              <div>
                <h2 id="interview-panel-heading">Interview and panel</h2>
                <p className="sub">Schedule and reviewer from the loaded record</p>
              </div>
            </div>
            <div className="pn-body">
              <div className="facts-ledger" aria-label="Interview and panel">
                <div className="fl-row">
                  <span className="k">Panel member</span>
                  <span className="v">{reviewer ?? "No reviewer assigned yet"}</span>
                </div>
                <div className="fl-row">
                  <span className="k">Interview schedule</span>
                  <span className="v num">{record.interview ? formatKolkata(record.interview.atIso, { format: "full" }) : "Not scheduled"}</span>
                </div>
                <div className="fl-row">
                  <span className="k">Panel note</span>
                  <span className="v">{record.interview?.note ?? "No panel note recorded"}</span>
                </div>
              </div>
              <div className="callout" style={{ marginTop: 14 }}>
                <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
                  info
                </span>
                <span className="small">Requesting an interview from the decision below attaches the slot through the existing service. Outcome is omitted because the record carries no outcome field. The timeline records the result.</span>
              </div>
              {canApprove && !withdrawn ? (
                <div className={styles.assignRow} style={{ marginTop: 14 }}>
                  <label htmlFor="job-reviewer">Assign reviewer</label>
                  <select
                    id="job-reviewer"
                    className="select"
                    value={reviewerChoice}
                    onChange={(event) => { setReviewerChoice(event.target.value); setAssignError(null); }}
                    disabled={assigning}
                  >
                    <option value="">Choose an HR reviewer…</option>
                    {reviewers.map((candidate) => (
                      <option key={candidate.accountId} value={candidate.accountId}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                  <Button variant="quiet" disabled={assigning || reviewerChoice === ""} onClick={() => void handleAssignReviewer()}>
                    {assigning ? "Assigning…" : "Assign reviewer"}
                  </Button>
                  {assignError ? <p className="field-error" role="alert">{assignError}</p> : null}
                  {reviewers.length === 0 ? (
                    <p className="field-help">No active staff account currently holds the HR reviewer role.</p>
                  ) : (
                    <p className="field-help">The assigned reviewer scores the application and records the shortlist before the final decision.</p>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          <section className={`panel ${styles.panel}`} aria-labelledby="documents-heading">
            <h2 id="documents-heading" className="section-label">
              Documents
            </h2>
            {supabaseMode ? (
              attachedDocuments.length === 0 ? (
                <p className={styles.panelNote}>No documents are attached to this application.</p>
              ) : (
                <dl className={styles.detailList}>
                  {attachedDocuments.map((document) => (
                    <div className={`${styles.detailRow} ${styles.documentRow}`} key={`${document.label}-${document.reference}`}>
                      <dt>{document.label}</dt>
                      <dd>
                        <span className={styles.fileName}>{document.filename ?? document.reference}</span>
                        <a
                          className={`button button--small button--quiet ${styles.documentButton}`}
                          href={`/api/documents/${encodeURIComponent(document.reference)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open file
                        </a>
                      </dd>
                    </div>
                  ))}
                </dl>
              )
            ) : (
              <dl className={styles.detailList}>
                {DOCUMENTS.map((label) => (
                  <div className={`${styles.detailRow} ${styles.documentRow}`} key={label}>
                    <dt>{label}</dt>
                    <dd>
                      <span className={styles.fileName}>{files[label]}</span>
                      <button
                        type="button"
                        className={`button button--quiet ${styles.documentButton}`}
                        onClick={(event) =>
                          openDocument(
                            {
                              title: label,
                              fileName: files[label],
                              ...DOCUMENT_METADATA[label],
                            },
                            event.currentTarget,
                          )
                        }
                      >
                        Preview (demo)
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>

        <div className={styles.column}>
          <section className={`panel ${styles.panel}`} aria-labelledby="timeline-heading">
            <h2 id="timeline-heading" className="section-label">
              Timeline
            </h2>
            <ol className={styles.timeline}>
              {timeline.map((event) => (
                <li key={event.id} className={`${styles.timelineItem} ${STATE_CLASS[event.state]}`}>
                  <span className={styles.marker} aria-hidden="true" />
                  <div>
                    <p className={styles.timelineLabel}>{event.label}</p>
                    {event.meta ? <p className={styles.timelineMeta}>{event.meta}</p> : null}
                    {event.note ? <p className={styles.timelineNote}>{event.note}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {canReview ? (
            <section className={`panel ${styles.panel}`} aria-labelledby="scorecard-heading">
              <div className={styles.scorecardHead}>
                <h2 id="scorecard-heading" className="section-label">
                  Scorecard
                </h2>
                {!supabaseMode ? <span className="demo-badge">Demo scorecard</span> : null}
              </div>
              {supabaseMode ? (
                record.scorecards !== undefined && record.scorecards.length > 0 ? (
                  record.scorecards.map((card, index) => (
                    <div className={styles.scoreRow} key={`${card.atIso}-${index}`}>
                      <span className={styles.scoreLabel}>
                        Scorecard {index + 1}
                        {card.notes ? <small className={styles.cellNote}>{card.notes}</small> : null}
                      </span>
                      <span className={`num ${styles.scoreValue}`}>{card.score} / 5</span>
                    </div>
                  ))
                ) : (
                  <p className={styles.panelNote}>No scorecard recorded yet. Save a score to start the review evidence.</p>
                )
              ) : (
                <>
                  <div className={styles.scoreRow}>
                    <span className={styles.scoreLabel}>{SCORE_LABELS[0]}</span>
                    <span className={`num ${styles.scoreValue}`}>4 / 5</span>
                  </div>
                  <div className={styles.scoreRow}>
                    <span className={styles.scoreLabel}>{SCORE_LABELS[1]}</span>
                    <span className={`num ${styles.scoreValue}`}>3 / 5</span>
                  </div>
                  <div className={styles.scoreRow}>
                    <span className={styles.scoreLabel}>Interview / demonstration</span>
                    <span className={`num ${styles.scoreValue}`}>{interviewScore}</span>
                  </div>
                </>
              )}
              <p className={styles.panelNote}>Scorecards are visible to reviewers only · the service enforces the grant.</p>
              <div className={styles.scorecardForm}>
                <div className={styles.scoreField}>
                  <label htmlFor="job-score">Score (1–5)</label>
                  <select
                    id="job-score"
                    className="select"
                    value={scoreInput}
                    onChange={(event) => { setScoreInput(event.target.value); setScoreError(null); }}
                    disabled={savingScore}
                  >
                    {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
                <div className={styles.scoreField}>
                  <label htmlFor="job-score-notes">Notes (optional)</label>
                  <textarea
                    id="job-score-notes"
                    className="textarea"
                    rows={2}
                    value={scoreNotes}
                    onChange={(event) => setScoreNotes(event.target.value)}
                    disabled={savingScore}
                  />
                </div>
                {scoreError ? <p className="field-error" role="alert">{scoreError}</p> : null}
                <Button variant="quiet" disabled={savingScore} onClick={() => void handleSaveScorecard()}>
                  {savingScore ? "Saving…" : "Save score"}
                </Button>
              </div>
            </section>
          ) : (
            <section className={`panel ${styles.panel}`} aria-labelledby="scorecard-heading">
              <h2 id="scorecard-heading" className="section-label">
                Scorecard
              </h2>
              <p className={styles.readOnlyNote}>
                Scorecard review requires the HR reviewer workspace · the service enforces the grant.
              </p>
            </section>
          )}

          <section className={`panel ${styles.panel}`} aria-labelledby="decision-heading">
            <h2 id="decision-heading" className="section-label" ref={decisionHeadingRef} tabIndex={-1}>
              Decision
            </h2>
            {withdrawn ? (
              <p className={styles.readOnlyNote}>
                This application was withdrawn by the applicant · no further decisions can be recorded.
              </p>
            ) : (
              <>
                {draft ? (
                  <div className={styles.decisionBox}>
                      <form className={styles.decisionForm} onSubmit={handleContinue} noValidate>
                        <div className={`field ${noteError ? "field--invalid" : ""}`}>
                          <label htmlFor="decision-note">{DECISIONS[draft].noteLabel}</label>
                          <textarea
                            id="decision-note"
                            ref={noteRef}
                            className="textarea"
                            rows={3}
                            value={note}
                            disabled={processing}
                            aria-required={DECISIONS[draft].noteRequired || undefined}
                            onChange={(event) => {
                              setNote(event.target.value);
                              if (noteError) setNoteError(null);
                            }}
                            aria-describedby={noteError ? "decision-note-error" : "decision-note-help"}
                            aria-invalid={noteError ? true : undefined}
                          />
                          {noteError ? (
                            <p className="field-error" id="decision-note-error">
                              {noteError}
                            </p>
                          ) : (
                            <p className="field-help" id="decision-note-help">
                              {DECISIONS[draft].noteHelp}
                            </p>
                          )}
                        </div>
                        <div className={styles.actions}>
                          <Button variant="primary" type="submit">
                            Continue
                          </Button>
                          <Button variant="quiet" onClick={cancelDecision}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    {confirming ? (
                      <DecisionConfirmDialog
                        applicationRef={record.ref}
                        candidateName={record.name}
                        vacancyTitle={vacancyTitle}
                        actionLabel={DECISIONS[draft].label}
                        currentStatus={record.status}
                        targetStatus={DECISIONS[draft].result}
                        consequences={DECISIONS[draft].confirmText}
                        note={note.trim() || "Standard note recorded by the service"}
                        demoMode={!supabaseMode}
                        processing={processing}
                        error={actionError}
                        trigger={confirmTriggerRef.current}
                        onClose={cancelConfirmOnly}
                        onConfirm={() => void handleDecision(draft)}
                      />
                    ) : null}
                  </div>
                ) : canDecide ? (
                  <>
                    <div className={styles.actions} ref={actionsRef} tabIndex={-1}>
                      {(Object.keys(DECISIONS) as DecisionKind[])
                        .filter((kind) => (kind === "shortlist" || kind === "interview" ? canReview : canApprove))
                        .map((kind) => {
                          const meta = DECISIONS[kind];
                          const allowed = availableActions.includes(kind);
                          const variant =
                            kind === "not-selected" ? "danger" : kind === "offer" || kind === "shortlist" ? "primary" : "quiet";
                          return (
                            <Button
                              key={kind}
                              variant={variant}
                              disabled={!allowed}
                              onClick={() => openDecision(kind)}
                            >
                              {meta.label}
                            </Button>
                          );
                        })}
                    </div>
                    {availableActions.length === 0 ? (
                      <p className={styles.readOnlyNote}>
                        {TERMINAL_STATUSES.has(record.status)
                          ? `This application is closed (${record.status.toLowerCase()}) · no further decisions can be recorded.`
                          : canReview
                            ? "No reviewer decision is available at this stage."
                            : "A separate HR reviewer decision is required before the final outcome can be recorded."}
                      </p>
                    ) : (
                      <p className={styles.panelNote}>
                        Actions that are not valid for the current status are disabled.
                      </p>
                    )}
                    <p className={styles.liveLine} aria-live="polite">
                      {announcement ?? ""}
                    </p>
                    <p className={styles.note}>Applicant status messages never expose internal notes.</p>
                  </>
                ) : (
                  <>
                    <p className={styles.readOnlyNote}>
                      Advance, reject, and offer decisions require the HR approver workspace · the service enforces
                      the grant.
                    </p>
                    <p className={styles.liveLine} aria-live="polite">
                      {announcement ?? ""}
                    </p>
                    <p className={styles.note}>Applicant status messages never expose internal notes.</p>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <div className={styles.ruleNote}>
        {!supabaseMode ? <p>{CONTENT_DEMO_NOTE}</p> : null}
      </div>

      {preview ? (
        <DocumentPreviewDialog
          key={preview.title}
          file={preview}
          trigger={previewTriggerRef.current}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
