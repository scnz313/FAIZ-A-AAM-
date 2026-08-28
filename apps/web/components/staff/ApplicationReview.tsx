"use client";

import { useEffect, useRef, useState } from "react";

import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { formatKolkata } from "@/modules/iot/domain";
import type { ApplicationStatus } from "@/modules/admissions/demo";
import { admissionsService, type ApplicationRecord } from "@/modules/services/admissions";
import { canRole } from "@/modules/services/staff-authorization";

import styles from "./ApplicationReview.module.css";

const STATUS_TONE: Record<ApplicationStatus, StatusTone> = {
  Draft: "neutral",
  Submitted: "neutral",
  "Under review": "watch",
  "Changes requested": "alert",
  Assessment: "watch",
  Offered: "good",
  Waitlisted: "watch",
  Declined: "neutral",
  Enrolled: "good",
};

type DemoFileState = "demo-preview" | "missing" | "access-denied";

type ApplicationDocument = {
  label: string;
  state: string;
  fileName: string;
  format: string;
  size: string;
  updated: string;
  description: string;
  initialState: DemoFileState;
};

const DOCUMENTS: ReadonlyArray<ApplicationDocument> = [
  {
    label: "Birth certificate",
    state: "Received",
    fileName: "birth-certificate.demo.pdf",
    format: "PDF-like metadata preview",
    size: "Not provided",
    updated: "Submitted with demo application",
    description: "A fictional birth-certificate preview for the demo application.",
    initialState: "demo-preview",
  },
  {
    label: "Student photograph",
    state: "Received",
    fileName: "student-photograph.demo.jpg",
    format: "Image metadata preview",
    size: "Not provided",
    updated: "Submitted with demo application",
    description: "A fictional student-photograph record. No image is rendered or served.",
    initialState: "demo-preview",
  },
  {
    label: "Previous school report card",
    state: "Re-uploaded",
    fileName: "previous-school-report.demo.pdf",
    format: "PDF-like metadata preview",
    size: "Not provided",
    updated: "Re-upload requested in demo record",
    description: "A fictional report-card record with a missing attachment state for recovery review.",
    initialState: "missing",
  },
  {
    label: "Address proof",
    state: "Received",
    fileName: "address-proof.demo.pdf",
    format: "PDF-like metadata preview",
    size: "Not provided",
    updated: "Submitted with demo application",
    description: "A fictional address-proof preview for the demo application.",
    initialState: "demo-preview",
  },
];

type DecisionAction = "assessment" | "change" | "offer" | "waitlist" | "decline";

type ActionMeta = {
  label: string;
  description: string;
  requiresReason: boolean;
  tone: "primary" | "saffron" | "danger";
};

const ACTION_DETAILS: Record<DecisionAction, ActionMeta> = {
  assessment: {
    label: "Move to assessment",
    description: "Send the application to the assessment panel.",
    requiresReason: false,
    tone: "primary",
  },
  change: {
    label: "Request change",
    description: "Ask the applicant to correct or re-upload information.",
    requiresReason: true,
    tone: "primary",
  },
  offer: {
    label: "Offer seat",
    description: "Offer a seat for the requested grade and session.",
    requiresReason: true,
    tone: "saffron",
  },
  waitlist: {
    label: "Waitlist",
    description: "Place the applicant on the waitlist.",
    requiresReason: true,
    tone: "primary",
  },
  decline: {
    label: "Decline",
    description: "Decline the application.",
    requiresReason: true,
    tone: "danger",
  },
};

/** Actions offered per status — invalid transitions are never presented. */
const AVAILABLE_ACTIONS: Record<ApplicationStatus, DecisionAction[]> = {
  Draft: [],
  Submitted: ["assessment", "change", "waitlist", "decline"],
  "Under review": ["assessment", "change", "waitlist", "decline"],
  "Changes requested": ["assessment", "decline"],
  Assessment: ["offer", "waitlist", "decline"],
  Offered: [],
  Waitlisted: ["decline"],
  Declined: [],
  Enrolled: [],
};

const TARGET_STATUS: Record<DecisionAction, ApplicationStatus> = {
  assessment: "Assessment",
  change: "Changes requested",
  offer: "Offered",
  waitlist: "Waitlisted",
  decline: "Declined",
};

/** Notes shown when the current status leaves no further staff action. */
const NO_ACTION_NOTE: Partial<Record<ApplicationStatus, string>> = {
  Offered: "A seat offer is outstanding — the applicant's response is awaited.",
  Declined: "This application is closed.",
  Enrolled: "This applicant is enrolled.",
};

const REASON_MIN_LENGTH = 10;

const ASSESSMENT_DEFAULT_NOTE = "Moved to the assessment panel.";

/**
 * Phase-1 maker/checker gating: review actions (move to assessment, request
 * changes) belong to admissions.review; decision actions (offer, waitlist,
 * decline) belong to admissions.approve. Hidden controls stay hidden — the
 * service enforces the grant regardless of what the UI shows.
 */
function actionNeeds(action: DecisionAction, canReview: boolean, canApprove: boolean): boolean {
  if (action === "assessment" || action === "change") return canReview;
  return canApprove;
}

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
    description: "The record has metadata, but no file is attached to this demo record yet. Ask the applicant to re-upload it.",
  },
  "access-denied": {
    title: "Access denied",
    description: "This simulates a server authorization response. Ask an administrator to confirm reviewer scope. No private file was requested or exposed.",
  },
};

const DOWNLOAD_COPY: Record<DemoFileState, string> = {
  "demo-preview": "Demo file not provided — this preview contains metadata only, so no download started.",
  missing: "Demo file not provided — this record has no attached file. Ask the applicant to re-upload it.",
  "access-denied": "Demo download blocked — access denied. No private file was requested or exposed.",
};

type PreviewDocument = Omit<ApplicationDocument, "label" | "state" | "initialState"> & {
  title: string;
  initialState: DemoFileState;
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
      aria-labelledby="admission-document-preview-title"
      aria-describedby="admission-document-preview-live-state"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
    >
      <div className={styles.previewContent}>
        <div className={styles.previewHeader}>
          <div>
            <p className="section-label">Application document · demo</p>
            <h2 id="admission-document-preview-title" className={styles.previewTitle}>
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
          <label htmlFor="admission-document-preview-selector">Demo file state</label>
          <select
            id="admission-document-preview-selector"
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
          id="admission-document-preview-live-state"
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

/**
 * Staff review workspace for one admission application. The record comes
 * from the admissions service — the server renders the initial record, the
 * component refreshes it from the demo session on mount and after every
 * decision. Consequential decisions require a written reason and an inline
 * confirmation, and every recorded decision appends a timeline event that
 * the queue and applicant views read back through the same service.
 */
export function ApplicationReview({
  applicationRef,
  initial,
}: {
  applicationRef: string;
  initial: ApplicationRecord | null;
}) {
  const [record, setRecord] = useState<ApplicationRecord | null>(initial);
  const [loading, setLoading] = useState(initial === null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [action, setAction] = useState<DecisionAction | null>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewDocument | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);

  const { summary } = useStaffContext();
  const actorAccountId = summary?.accountId;
  const canReview = canRole(summary?.role ?? "", "admissions.review");
  const canApprove = canRole(summary?.role ?? "", "admissions.approve");

  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const actionErrorRef = useRef<HTMLParagraphElement>(null);
  const decisionHeadingRef = useRef<HTMLHeadingElement>(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    admissionsService
      .getApplication(applicationRef)
      .then((application) => {
        setRecord(application);
        setLoading(false);
      })
      .catch(() => {
        setLoadError("We could not load this application right now. Please try again.");
        setLoading(false);
      });
  };

  /* Refresh from the demo session on mount so a decision made elsewhere in
     the session (or a just-submitted application) shows here too. The first
     render always matches the SSR initial record. */
  useEffect(() => {
    let cancelled = false;
    admissionsService
      .getApplication(applicationRef)
      .then((application) => {
        if (!cancelled) setRecord(application);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationRef]);

  /* Move focus with each panel state so keyboard users always know where
     the decision flow stands. */
  useEffect(() => {
    if (action && ACTION_DETAILS[action].requiresReason && !confirming) {
      reasonRef.current?.focus();
    }
  }, [action, confirming]);

  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
    }
  }, [confirming]);

  function openDocument(file: PreviewDocument, trigger: HTMLButtonElement) {
    previewTriggerRef.current = trigger;
    setPreview(file);
  }

  function selectAction(key: DecisionAction) {
    setAction(key);
    setConfirming(false);
    setValidationError(null);
    setActionError(null);
  }

  function continueToConfirm() {
    if (!action || processing) return;
    const meta = ACTION_DETAILS[action];
    if (meta.requiresReason && reason.trim().length < REASON_MIN_LENGTH) {
      setValidationError(`Please add a reason of at least ${REASON_MIN_LENGTH} characters — it is recorded with the decision.`);
      reasonRef.current?.focus();
      return;
    }
    setValidationError(null);
    setActionError(null);
    setConfirming(true);
    requestAnimationFrame(() => confirmRef.current?.focus());
  }

  function cancelConfirm() {
    setConfirming(false);
    setActionError(null);
    setValidationError(null);
  }

  async function recordDecision() {
    if (!record || !action || processing) return;
    setProcessing(true);
    setActionError(null);
    try {
      const note = reason.trim();
      if (action === "assessment") {
        await admissionsService.staffMoveToAssessment(applicationRef, note || undefined, actorAccountId);
      } else if (action === "change") {
        await admissionsService.requestChange(applicationRef, note);
      } else if (action === "offer") {
        await admissionsService.staffOfferSeat(applicationRef, note, actorAccountId);
      } else if (action === "waitlist") {
        await admissionsService.staffWaitlist(applicationRef, note, actorAccountId);
      } else {
        await admissionsService.staffDecline(applicationRef, note, actorAccountId);
      }
      /* Re-read through the service so the panel shows exactly what the
         demo session now holds. */
      const updated = await admissionsService.getApplication(applicationRef);
      if (!updated) throw new Error("The record could not be reloaded after the decision.");
      setRecord(updated);
      setAnnouncement(`${ACTION_DETAILS[action].label} recorded — ${note || ASSESSMENT_DEFAULT_NOTE}`);
      setAction(null);
      setReason("");
      setConfirming(false);
      setValidationError(null);
      requestAnimationFrame(() => decisionHeadingRef.current?.focus());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The decision could not be recorded. Please try again.");
      requestAnimationFrame(() => actionErrorRef.current?.focus());
    } finally {
      setProcessing(false);
    }
  }

  if (!record) {
    return (
      <div className={styles.review}>
        {loading ? (
          <p className={styles.note} role="status">
            Loading application {applicationRef} from the demo session…
          </p>
        ) : loadError ? (
          <div className="panel">
            <p className={styles.note} role="alert">
              {loadError}
            </p>
            <div className={styles.actions}>
              <button type="button" className="button button--primary" onClick={load}>
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div className="panel">
            <h2 className="section-label">Application not found</h2>
            <p className={styles.note}>No application carries the reference {applicationRef}. It may have been removed, or the link is incorrect.</p>
            <div className={styles.actions}>
              <a className="button button--quiet" href="/staff/admissions">
                Back to all applications →
              </a>
            </div>
          </div>
        )}
      </div>
    );
  }

  const statusActions = AVAILABLE_ACTIONS[record.status];
  /* Role gating: only actions the ACTIVE workspace may perform are offered;
     denied controls are hidden, with an honest note that the service
     enforces the decision. */
  const permitted = statusActions.filter((key) => actionNeeds(key, canReview, canApprove));
  /* Only note the split when at least one action remains visible; a fully
     hidden decision panel already carries its own honest note. */
  const hiddenByRole = permitted.length > 0 && permitted.length < statusActions.length;
  const noActionNote =
    permitted.length === 0
      ? statusActions.length > 0
        ? "This workspace cannot record decisions on this application — the service enforces the admissions grant."
        : (NO_ACTION_NOTE[record.status] ?? "No further actions are available for this status.")
      : null;
  const actionMeta = action ? ACTION_DETAILS[action] : null;

  return (
    <div className={styles.review}>
      <div className={styles.columns}>
        <div className={styles.left}>
          <section className="panel" aria-labelledby="application-heading">
            <h2 id="application-heading" className="section-label">
              Application
            </h2>
            <dl className={styles.details}>
              <div>
                <dt>Student</dt>
                <dd>{record.studentName}</dd>
              </div>
              <div>
                <dt>Parent / guardian</dt>
                <dd>{record.parentName}</dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd className="num">{record.contact}</dd>
              </div>
              <div>
                <dt>Grade requested</dt>
                <dd>{record.grade}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{record.session}</dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="documents-heading">
            <h2 id="documents-heading" className="section-label">
              Documents
            </h2>
            <ul className={styles.documents}>
              {DOCUMENTS.map((document) => (
                <li key={document.label} className={styles.documentRow}>
                  <span>
                    {document.label} <span className={styles.documentState}>· {document.state}</span>
                  </span>
                  <button
                    type="button"
                    className={`button button--small button--quiet ${styles.documentButton}`}
                    onClick={(event) =>
                      openDocument(
                        {
                          title: document.label,
                          fileName: document.fileName,
                          format: document.format,
                          size: document.size,
                          updated: document.updated,
                          description: document.description,
                          initialState: document.initialState,
                        },
                        event.currentTarget,
                      )
                    }
                  >
                    Preview (demo)
                  </button>
                </li>
              ))}
            </ul>
            <p id="demo-doc-note" className={styles.note}>
              Demo uploads — preview shows metadata only. Missing and access-denied states are selectable for recovery review; no private file is opened.
            </p>
          </section>
        </div>

        <div className={styles.right}>
          <section className="panel" aria-labelledby="timeline-heading">
            <h2 id="timeline-heading" className="section-label">
              Status history
            </h2>
            <ol className={styles.timeline}>
              {record.timeline.map((event) => (
                <li key={`${event.status}-${event.atIso}`} className={styles.timelineRow}>
                  <span className={styles.timelineDot} aria-hidden="true" />
                  <div>
                    <p className={styles.timelineHead}>
                      <strong>{event.status}</strong>
                      <span className="num">{formatKolkata(event.atIso, { format: "short" })}</span>
                    </p>
                    <p className={styles.timelineNote}>
                      {event.note} <span className={styles.timelineActor}>— {event.actor}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel" aria-labelledby="decision-heading">
            <div className={styles.decisionHead}>
              <h2 id="decision-heading" tabIndex={-1} ref={decisionHeadingRef} className="section-label">
                Decision
              </h2>
              <StatusBadge tone={STATUS_TONE[record.status]}>{record.status}</StatusBadge>
            </div>

            {noActionNote ? (
              <p className={styles.note}>{noActionNote}</p>
            ) : confirming && actionMeta ? (
              <div className={styles.confirmBox}>
                <p className="section-label">Confirm decision</p>
                <dl className={styles.details}>
                  <div>
                    <dt>Action</dt>
                    <dd>{actionMeta.label}</dd>
                  </div>
                  <div>
                    <dt>Reason</dt>
                    <dd>{reason.trim() || ASSESSMENT_DEFAULT_NOTE}</dd>
                  </div>
                  <div>
                    <dt>Recorded by</dt>
                    <dd>Admissions office</dd>
                  </div>
                  <div>
                    <dt>Status after</dt>
                    <dd>{action ? TARGET_STATUS[action] : null}</dd>
                  </div>
                </dl>
                <p className={styles.note}>This decision is recorded in the demo session with a timestamp and reason, and shows on the status history.</p>
                {actionError ? (
                  <p className="field-error" role="alert" tabIndex={-1} ref={actionErrorRef}>
                    {actionError}
                  </p>
                ) : null}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={`button ${actionMeta.tone === "primary" ? "button--primary" : actionMeta.tone === "saffron" ? "button--saffron" : "button--danger"}`}
                    onClick={recordDecision}
                    disabled={processing}
                    ref={confirmRef}
                  >
                    {processing ? "Recording decision…" : `Confirm — ${actionMeta.label}`}
                  </button>
                  <button type="button" className="button button--quiet" onClick={cancelConfirm} disabled={processing}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="decision-action">Decision</label>
                  <select
                    id="decision-action"
                    className="select"
                    value={action ?? ""}
                    onChange={(event) => selectAction(event.target.value as DecisionAction)}
                    disabled={processing}
                  >
                    <option value="" disabled>
                      Choose an action…
                    </option>
                    {permitted.map((key) => (
                      <option key={key} value={key}>
                        {ACTION_DETAILS[key].label}
                      </option>
                    ))}
                  </select>
                  {actionMeta ? <p className="field-help">{actionMeta.description}</p> : null}
                </div>

                {actionMeta?.requiresReason ? (
                  <div className={`field ${styles.reasonField} ${validationError ? "field--invalid" : ""}`}>
                    <label htmlFor="decision-reason">
                      Reason for {actionMeta.label.toLowerCase()} (required)
                    </label>
                    <textarea
                      id="decision-reason"
                      className="textarea"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      disabled={processing}
                      ref={reasonRef}
                      aria-required="true"
                      aria-describedby={validationError ? "decision-reason-error" : "decision-reason-help"}
                    />
                    <p id="decision-reason-help" className="field-help">
                      Recorded with the decision on the applicant-safe timeline. Minimum {REASON_MIN_LENGTH} characters.
                    </p>
                    {validationError ? (
                      <p id="decision-reason-error" className="field-error" role="alert">
                        {validationError}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className={styles.actions}>
                  <button type="button" className="button button--primary" onClick={continueToConfirm} disabled={!action || processing}>
                    {actionMeta?.requiresReason ? "Review decision" : action ? "Continue" : "Choose an action"}
                  </button>
                </div>
              </>
            )}

            <p className={styles.decisionLine} aria-live="polite">
              {announcement ?? "Decisions are recorded with actor, timestamp, and reason."}
            </p>
            {hiddenByRole ? (
              <p className={styles.note}>
                Some decisions are hidden because the active workspace lacks the matching grant (review vs approve) —
                the service enforces the decision.
              </p>
            ) : null}
            <p className={styles.note}>UI demo — recorded in the demo session only. Internal notes are visible to staff only; applicants never see them.</p>
          </section>
        </div>
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
