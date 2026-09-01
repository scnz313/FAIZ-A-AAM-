"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

import Button from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { canAnyRole } from "@/modules/services/staff-profiles";
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
  "JOB-2026-0112": { qualification: "B.Sc. Mathematics · B.Ed.", experience: "4 years — classes 8 to 10" },
  "JOB-2026-0113": { qualification: "B.Sc. Mathematics · B.Ed.", experience: "2 years — school and tuition" },
  "JOB-2026-0114": { qualification: "M.A. English · B.Ed.", experience: "3 years — middle section" },
  "JOB-2026-0115": { qualification: "M.A. English · B.Ed.", experience: "1 year — student teaching" },
  "JOB-2026-0108": { qualification: "B.Sc. Physics", experience: "5 years — school laboratory" },
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
    noteHelp: "Reviewers see this note; applicants only see the stage.",
    confirmTitle: "Shortlist this candidate?",
    confirmText: "The applicant's status becomes Shortlisted and a timeline event is recorded.",
  },
  interview: {
    label: "Request interview",
    result: "Interview",
    noteRequired: false,
    noteLabel: "Note (optional)",
    noteHelp: "Reviewers see this note; applicants only see the stage.",
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
  { value: "demo-preview", label: "Demo preview — metadata only" },
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
  "demo-preview": "Demo file not provided — this preview contains metadata only, so no download started.",
  missing: "Demo file not provided — this record has no attached file. Ask the candidate to re-upload it.",
  "access-denied": "Demo download blocked — access denied. No private file was requested or exposed.",
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
          <p className="field-help">State selector for review only — it does not call storage or authorization services.</p>
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
      setAnnouncement(`Scorecard saved — ${numeric} / 5.`);
    } catch (error) {
      setScoreError(error instanceof Error ? error.message : "The scorecard could not be saved.");
    } finally {
      setSavingScore(false);
    }
  }

  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const decisionHeadingRef = useRef<HTMLHeadingElement | null>(null);
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

  useEffect(() => {
    if (confirming) summaryRef.current?.focus();
  }, [confirming]);

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
    /* Return focus to the action row once it is rendered again. */
    setTimeout(() => actionsRef.current?.focus(), 0);
  }

  function handleContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const meta = DECISIONS[draft];
    if (meta.noteRequired && note.trim().length < MIN_REASON_LENGTH) {
      setNoteError(`Add a reason of at least ${MIN_REASON_LENGTH} characters — the note is recorded with the decision.`);
      noteRef.current?.focus();
      return;
    }
    setNoteError(null);
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
      setAnnouncement(`Decision recorded — ${updated.name} is now ${updated.status}.`);
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
  const reviewer = supabaseMode ? (record.reviewerAccountId ?? null) : applicationReviewer(record);
  const availableActions = ACTIONS_BY_STATUS[record.status];
  const withdrawn = record.status === "Withdrawn";
  /* Phase-1 maker/checker split: reviewers score, approvers decide. The
     careers service records fixture actors, so the account id is not sent
     to it — the grants are enforced by this UI projection and, later, by
     the backend adapter. */
  const { summary } = useStaffContext();
  const profileCode = summary?.profileCode ?? null;
  const canReview = canAnyRole(summary?.roles ?? [], "careers.review");
  const canApprove = canAnyRole(summary?.roles ?? [], "careers.approve");

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

          <section className={`panel ${styles.panel}`} aria-labelledby="documents-heading">
            <h2 id="documents-heading" className="section-label">
              Documents
            </h2>
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
                        Score {index + 1}
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
              <p className={styles.panelNote}>Scorecards are visible to reviewers only — the service enforces the grant.</p>
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
                Scorecard review requires the HR reviewer workspace — the service enforces the grant.
              </p>
            </section>
          )}

          <section className={`panel ${styles.panel}`} aria-labelledby="decision-heading">
            <h2 id="decision-heading" className="section-label" ref={decisionHeadingRef} tabIndex={-1}>
              Decision
            </h2>
            {withdrawn ? (
              <p className={styles.readOnlyNote}>
                This application was withdrawn by the applicant — no further decisions can be recorded.
              </p>
            ) : (
              <>
                {draft ? (
                  <div className={styles.decisionBox}>
                    {confirming ? (
                      <div ref={summaryRef} tabIndex={-1} role="group" aria-label={`Confirm ${DECISIONS[draft].label}`}>
                        <p className={styles.decisionTitle}>{DECISIONS[draft].confirmTitle}</p>
                        <p className={styles.decisionText}>{DECISIONS[draft].confirmText}</p>
                        <dl className={styles.summaryList}>
                          <div className={styles.summaryRow}>
                            <dt>Decision</dt>
                            <dd>{DECISIONS[draft].result}</dd>
                          </div>
                          <div className={styles.summaryRow}>
                            <dt>Note</dt>
                            <dd>{note.trim() || "Standard note recorded by the service"}</dd>
                          </div>
                        </dl>
                        <div className={styles.actions}>
                          <Button variant="primary" disabled={processing} onClick={() => void handleDecision(draft)}>
                            {processing ? "Recording…" : "Confirm"}
                          </Button>
                          <Button variant="quiet" disabled={processing} onClick={cancelDecision}>
                            Cancel
                          </Button>
                        </div>
                        {actionError ? (
                          <div className={styles.actionErrorBlock}>
                            <p className="field-error" role="alert">
                              {actionError}
                            </p>
                            <Button variant="quiet" disabled={processing} onClick={() => void handleDecision(draft)}>
                              Try again
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
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
                    )}
                  </div>
                ) : canApprove ? (
                  <>
                    <div className={styles.actions} ref={actionsRef} tabIndex={-1}>
                      {(Object.keys(DECISIONS) as DecisionKind[]).map((kind) => {
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
                        This application is closed ({record.status.toLowerCase()}) — no further decisions can be
                        recorded.
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
                      Advance, reject, and offer decisions require the HR approver workspace — the service enforces
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
