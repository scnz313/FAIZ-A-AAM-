"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";

import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { formatKolkata } from "@/modules/iot/domain";
import type { ApplicationStatus } from "@/modules/admissions/demo";
import { admissionsService, type ApplicationEvent, type ApplicationRecord, type StaffReviewView } from "@/modules/services/admissions";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { clientAdapterMode } from "@/modules/services/adapter-client";

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
  Withdrawn: "neutral",
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

/** Scan state as a staff-readable label; unknown states are shown verbatim. */
function scanStateLabel(status: string): string {
  switch (status) {
    case "clean":
    case "ready":
      return "Ready";
    case "pending_scan":
      return "Pending scan";
    case "quarantined":
      return "Quarantined";
    case "failed":
      return "Failed";
    default:
      return status.replace(/_/g, " ");
  }
}

function documentRequirementLabel(code: string): string {
  return code.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Prefer the configured admission requirement label; fall back to the
 * code-derived label when the configuration is unavailable or the code is
 * unknown (for example a requirement archived after upload). */
function documentLabel(code: string, labels?: Record<string, string>): string {
  return labels?.[code] ?? documentRequirementLabel(code);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Fields compared between immutable submission snapshots. */
const VERSION_FIELD_LABELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "session", label: "Session" },
  { key: "grade", label: "Class" },
  { key: "studentName", label: "Student name" },
  { key: "dob", label: "Date of birth" },
  { key: "gender", label: "Gender" },
  { key: "placeOfBirth", label: "Place of birth" },
  { key: "guardianName", label: "Guardian name" },
  { key: "relation", label: "Relation" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "occupation", label: "Occupation" },
  { key: "houseStreet", label: "House / street" },
  { key: "villageTown", label: "Village / town" },
  { key: "district", label: "District" },
  { key: "pin", label: "PIN" },
  { key: "priorSchoolName", label: "Prior school" },
  { key: "lastClassAttended", label: "Last class attended" },
  { key: "leavingCertificate", label: "Leaving certificate" },
  { key: "conditions", label: "Support conditions" },
];

/** Resolve which uploaded document is the newest per requirement, so a
 *  reviewer can tell the current file from superseded earlier uploads.
 *  Exported for the document-history regression test. */
export function currentDocumentReferences(
  documents: ReadonlyArray<{ reference: string; requirementCode?: string | null; category: string; uploadedAtIso: string }>,
): Set<string> {
  const newest = new Map<string, { reference: string; uploadedAtIso: string }>();
  for (const document of documents) {
    const key = document.requirementCode ?? document.category;
    const previous = newest.get(key);
    if (previous === undefined || document.uploadedAtIso > previous.uploadedAtIso) {
      newest.set(key, { reference: document.reference, uploadedAtIso: document.uploadedAtIso });
    }
  }
  return new Set([...newest.values()].map((entry) => entry.reference));
}

/** Collision-free sibling key for the applicant-visible timeline. Two
 *  recorded events can share a status and timestamp (an offer extension and
 *  its invoice issue in the same second), so the index keeps them distinct.
 *  Exported for the duplicate-key regression test. */
export function timelineEventKey(event: Pick<ApplicationEvent, "status" | "atIso">, index: number): string {
  return `${event.status}-${event.atIso}-${index}`;
}

/** Collision-free sibling key for staff-only review notes. Reviews recorded
 *  together share an action and timestamp, so the index keeps them distinct.
 *  Exported for the duplicate-key regression test. */
export function staffReviewKey(review: Pick<StaffReviewView, "action" | "atIso">, index: number): string {
  return `${review.action}-${review.atIso}-${index}`;
}

function snapshotValue(snapshot: Record<string, unknown>, key: string): string {
  const value = snapshot[key];
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.length === 0 ? "None" : value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Resolve a review row's officer to a name. Account ids are internal and
 * must never be rendered, so an unresolved officer reads "Admissions office". */
function officerLabel(review: StaffReviewView, names: Record<string, string>): string {
  if (review.officerName) return review.officerName;
  const accountId = review.officerAccountId;
  if (accountId !== null) {
    const name = names[accountId];
    if (name !== undefined && name !== "") return name;
  }
  return "Admissions office";
}

type DecisionAction = "review" | "assessment" | "change" | "offer" | "waitlist" | "decline";type ActionMeta = {
  label: string;
  description: string;
  requiresReason: boolean;
  tone: "primary" | "saffron" | "danger";
};

const ACTION_DETAILS: Record<DecisionAction, ActionMeta> = {
  review: {
    label: "Start review",
    description: "Begin verification and review of the submitted application.",
    requiresReason: false,
    tone: "primary",
  },
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

/** Actions offered per status — invalid transitions are never presented.
 * The canonical flow is Submitted → Under review → Assessment → decision;
 * a fresh submission starts with review, not with a decision. */
const AVAILABLE_ACTIONS: Record<ApplicationStatus, DecisionAction[]> = {
  Draft: [],
  Submitted: ["review", "change"],
  "Under review": ["assessment", "change"],
  "Changes requested": ["review", "decline"],
  Assessment: ["offer", "waitlist", "decline"],
  Offered: [],
  Waitlisted: ["decline"],
  Declined: [],
  Enrolled: [],
  Withdrawn: [],
};

const TARGET_STATUS: Record<DecisionAction, ApplicationStatus> = {
  review: "Under review",
  assessment: "Assessment",
  change: "Changes requested",
  offer: "Offered",
  waitlist: "Waitlisted",
  decline: "Declined",
};

/** Notes shown when the current status leaves no further staff action. */
const NO_ACTION_NOTE: Partial<Record<ApplicationStatus, string>> = {
  Offered: "A seat offer is outstanding · the applicant's response is awaited.",
  Declined: "This application is closed.",
  Enrolled: "This applicant is enrolled.",
  Withdrawn: "This application was withdrawn by the applicant.",
};

const REASON_MIN_LENGTH = 10;

/** Default applicant-visible notes for actions that do not require a typed
 *  reason, matching the defaults the admissions service records. */
const DEFAULT_NOTE: Partial<Record<DecisionAction, string>> = {
  review: "Review started.",
  assessment: "Moved to the assessment panel.",
};

function defaultNoteFor(action: DecisionAction): string {
  return DEFAULT_NOTE[action] ?? "Decision recorded.";
}

/**
 * Phase-1 maker/checker gating: review actions (move to assessment, request
 * changes) belong to admissions.review; decision actions (offer, waitlist,
 * decline) belong to admissions.approve. Hidden controls stay hidden — the
 * service enforces the grant regardless of what the UI shows.
 */
function actionNeeds(action: DecisionAction, canReview: boolean, canApprove: boolean): boolean {
  if (action === "review" || action === "assessment" || action === "change") return canReview;
  return canApprove;
}

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
    description: "The record has metadata, but no file is attached to this demo record yet. Ask the applicant to re-upload it.",
  },
  "access-denied": {
    title: "Access denied",
    description: "This simulates a server authorization response. Ask an administrator to confirm reviewer scope. No private file was requested or exposed.",
  },
};

const DOWNLOAD_COPY: Record<DemoFileState, string> = {
  "demo-preview": "Demo file not provided · this preview contains metadata only, so no download started.",
  missing: "Demo file not provided · this record has no attached file. Ask the applicant to re-upload it.",
  "access-denied": "Demo download blocked · access denied. No private file was requested or exposed.",
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
          <p className="field-help">State selector for review only · it does not call storage or authorization services.</p>
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
 * Decision confirmation modal, reusing the in-file dialog pattern from
 * DocumentPreviewDialog (showModal, Escape via onCancel, return focus to the
 * trigger). Shows the exact object, the status transition, the consequences,
 * and the required applicant-visible reason. The safe default focus is the
 * Close control, never the confirm action.
 */
function DecisionConfirmDialog({
  applicationRef,
  studentName,
  actionLabel,
  actionTone,
  currentStatus,
  targetStatus,
  reason,
  demoMode,
  processing,
  error,
  trigger,
  onClose,
  onConfirm,
}: {
  applicationRef: string;
  studentName: string;
  actionLabel: string;
  actionTone: "primary" | "saffron" | "danger";
  currentStatus: string;
  targetStatus: string;
  reason: string;
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
      aria-labelledby="admission-decision-confirm-title"
      aria-describedby="admission-decision-confirm-desc"
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
            <h2 id="admission-decision-confirm-title" className={styles.confirmTitle}>
              {actionLabel}?
            </h2>
          </div>
          <button ref={cancelRef} type="button" className="button button--quiet" onClick={closeDialog} disabled={processing}>
            Close
          </button>
        </div>
        <div id="admission-decision-confirm-desc">
          <div className="facts-ledger">
            <div className="fl-row">
              <span className="k">Object</span>
              <span className="v num">
                {applicationRef} · {studentName}
              </span>
            </div>
            <div className="fl-row">
              <span className="k">Transition</span>
              <span className="v">
                {currentStatus} → {targetStatus}
              </span>
            </div>
            <div className="fl-row">
              <span className="k">Reason shown to applicant</span>
              <span className="v">{reason}</span>
            </div>
            <div className="fl-row">
              <span className="k">Recorded by</span>
              <span className="v">Admissions office</span>
            </div>
          </div>
          <div className="callout" style={{ marginTop: 14 }}>
            <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
              info
            </span>
            <span className="small">
              This decision is recorded{demoMode ? " in the demo session" : ""} with actor and timestamp, appends to
              the applicant-visible history, and the applicant sees the reason above. It is not undone here. A
              further staff decision is required to change status.
            </span>
          </div>
        </div>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.confirmActions}>
          <button
            type="button"
            className={`button ${actionTone === "primary" ? "button--primary" : actionTone === "saffron" ? "button--saffron" : "button--danger"}`}
            onClick={onConfirm}
            disabled={processing}
          >
            {processing ? "Recording decision…" : `Confirm · ${actionLabel}`}
          </button>
          <button type="button" className="button button--quiet" onClick={closeDialog} disabled={processing}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Staff review workspace for one admission application. The record comes
 * from the admissions service — the server renders the initial record, demo
 * mode refreshes it from the session on mount, and every decision refreshes
 * it in either mode. Consequential decisions require a written reason and an
 * inline confirmation, and every recorded decision appends a timeline event
 * that the queue and applicant views read back through the same service.
 */
export function ApplicationReview({
  applicationRef,
  initial,
  documentLabels,
}: {
  applicationRef: string;
  initial: ApplicationRecord | null;
  /** Configured admission requirement labels keyed by requirement/attachment
   * code. The server page passes them so the review shows the school's human
   * labels ("Address proof", "Birth certificate") instead of derived codes;
   * unknown codes fall back to the code-derived label. */
  documentLabels?: Record<string, string>;
}) {
  const supabaseMode = clientAdapterMode() === "supabase";
  const [record, setRecord] = useState<ApplicationRecord | null>(initial);
  const [loading, setLoading] = useState(!supabaseMode && initial === null);
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
  const [duplicateReason, setDuplicateReason] = useState("");
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [resolvingDuplicate, setResolvingDuplicate] = useState(false);
  const [privateNote, setPrivateNote] = useState("");
  const [reviewerNames, setReviewerNames] = useState<Record<string, string>>({});

  const { summary } = useStaffContext();
  const profileCode = summary?.profileCode ?? null;
  const actorAccountId = summary?.accountId;
  const canReview = canAnyRole(summary?.roles ?? [], "admissions.review");
  const canApprove = canAnyRole(summary?.roles ?? [], "admissions.approve");

  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement | null>(null);
  const decisionHeadingRef = useRef<HTMLHeadingElement>(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    admissionsService
      .getStaffApplication(applicationRef)
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
    if (supabaseMode) {
      setRecord(initial);
      setLoading(false);
      return;
    }
    let cancelled = false;
    admissionsService
      .getStaffApplication(applicationRef)
      .then((application) => {
        if (!cancelled) setRecord(application);
      })
      .catch(() => {
        /* A refresh failure must not blank a loaded review; without an SSR
           record there is nothing to show, so surface the retry state. */
        if (!cancelled && initial === null) {
          setLoadError("We could not load this application right now. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationRef, initial, supabaseMode]);

  /* Officer display names come from a separate directory read: the staff
     projection carries account ids only and the workspace must never render
     an id. Refreshing whenever the loaded record changes keeps the latest
     decision attributed; a failed or empty read keeps earlier names and the
     office fallback, so the panel is never blanked. */
  useEffect(() => {
    if (record === null) return;
    let cancelled = false;
    admissionsService
      .reviewerDirectory(applicationRef)
      .then((directory) => {
        if (!cancelled) setReviewerNames((previous) => ({ ...previous, ...directory }));
      })
      .catch(() => {
        /* The office fallback already covers an unresolved officer. */
      });
    return () => {
      cancelled = true;
    };
  }, [applicationRef, record]);

  /* Move focus to the reason field when a reasoned action is chosen. The
     confirm modal manages its own safe default focus (Close) and returns
     focus to the continue control on dismiss. */
  useEffect(() => {
    if (action && ACTION_DETAILS[action].requiresReason && !confirming) {
      reasonRef.current?.focus();
    }
  }, [action, confirming]);

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

  function continueToConfirm(trigger: HTMLButtonElement | null) {
    if (!action || processing) return;
    const meta = ACTION_DETAILS[action];
    if (meta.requiresReason && reason.trim().length < REASON_MIN_LENGTH) {
      setValidationError(`Please add a reason of at least ${REASON_MIN_LENGTH} characters · it is recorded with the decision.`);
      reasonRef.current?.focus();
      return;
    }
    setValidationError(null);
    setActionError(null);
    confirmTriggerRef.current = trigger;
    setConfirming(true);
  }

  function cancelConfirm() {
    setConfirming(false);
    setActionError(null);
    setValidationError(null);
    requestAnimationFrame(() => confirmTriggerRef.current?.focus());
  }

  async function resolveDuplicate(outcome: "approved" | "rejected") {
    if (!record || resolvingDuplicate) return;
    if (duplicateReason.trim().length < 3) {
      setDuplicateError("Record a reason of at least 3 characters for the identity review.");
      return;
    }
    setResolvingDuplicate(true);
    setDuplicateError(null);
    try {
      const updated = await admissionsService.resolveDuplicateReview(applicationRef, {
        outcome,
        reason: duplicateReason.trim(),
        expectedVersion: record.version,
        evidenceReference: record.duplicateReviewRef,
      });
      setRecord(updated);
      setDuplicateReason("");
      setAnnouncement(
        outcome === "approved"
          ? "Identity verified · the application returned to admissions review."
          : "Identity review rejected · the application was declined.",
      );
    } catch (error) {
      setDuplicateError(error instanceof Error ? error.message : "The identity review could not be recorded.");
    } finally {
      setResolvingDuplicate(false);
    }
  }

  async function recordDecision() {
    if (!record || !action || processing) return;
    setProcessing(true);
    setActionError(null);
    try {
      const note = reason.trim();
      /* Optimistic concurrency: the version the reviewer is looking at is the
         token the server checks, so a stale tab cannot overwrite a decision. */
      const version = record.version;
      const staffOnly = privateNote.trim() || undefined;
      if (action === "review") {
        await admissionsService.staffStartReview(applicationRef, note || undefined, actorAccountId, version, staffOnly);
      } else if (action === "assessment") {
        await admissionsService.staffMoveToAssessment(applicationRef, note || undefined, actorAccountId, version, staffOnly);
      } else if (action === "change") {
        await admissionsService.requestChange(applicationRef, note, version, staffOnly);
      } else if (action === "offer") {
        await admissionsService.staffOfferSeat(applicationRef, note, actorAccountId, version, staffOnly);
      } else if (action === "waitlist") {
        await admissionsService.staffWaitlist(applicationRef, note, actorAccountId, version, staffOnly);
      } else {
        await admissionsService.staffDecline(applicationRef, note, actorAccountId, version, staffOnly);
      }
      /* Re-read through the service so the panel shows exactly what the
         authoritative service now holds. */
      const updated = await admissionsService.getStaffApplication(applicationRef);
      if (!updated) throw new Error("The record could not be reloaded after the decision.");
      setRecord(updated);
      setAnnouncement(`${ACTION_DETAILS[action].label} recorded · ${note || defaultNoteFor(action)}`);
      setAction(null);
      setReason("");
      setPrivateNote("");
      setConfirming(false);
      setValidationError(null);
      requestAnimationFrame(() => decisionHeadingRef.current?.focus());
    } catch (error) {
      const message = error instanceof Error ? error.message : "The decision could not be recorded. Please try again.";
      /* The optimistic version was stale (another tab or officer): close the
         confirm and reload the authoritative record before any retry. */
      setActionError(`${message} The current record is being reloaded; review it before retrying.`);
      setConfirming(false);
      load();
    } finally {
      setProcessing(false);
    }
  }

  if (!record) {
    return (
      <div className={styles.review}>
        {loading ? (
          <p className={styles.note} role="status">
            Loading application {applicationRef}{!supabaseMode ? " from the demo session" : ""}…
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
              <Link prefetch={false} className="button button--quiet" href={canonicalStaffUrl(profileCode, "/admissions")}>
                Back to all applications →
              </Link>
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
        ? "This workspace cannot record decisions on this application · the service enforces the admissions grant."
        : (NO_ACTION_NOTE[record.status] ?? "No further actions are available for this status.")
      : null;
  const actionMeta = action ? ACTION_DETAILS[action] : null;
  /* Version comparison derives only from the loaded record: the timeline is
     the version history the admissions service returns (getApplication).
     The service retains current answers only, so field-level old-vs-new
     values have no source and are honestly omitted. The compare shows
     original submission, requested change, and resubmission events. */
  const firstSubmittedEvent = record.timeline.find((event) => event.status === "Submitted") ?? null;
  const firstChangeEvent = record.timeline.find((event) => event.status === "Changes requested") ?? null;
  const changeIndex = firstChangeEvent ? record.timeline.indexOf(firstChangeEvent) : -1;
  const resubmissionEvent =
    changeIndex >= 0 ? (record.timeline.slice(changeIndex + 1).find((event) => event.status === "Submitted") ?? null) : null;
  const hasRequestedChange = firstChangeEvent !== null;
  const latestReview = (record.staffReviews ?? []).at(-1) ?? null;
  const versions = record.versions ?? [];
  const previousVersion = versions.length >= 2 ? versions[0] : null;
  const latestVersion = versions.length >= 2 ? versions[versions.length - 1] : null;
  const currentDocumentRefs = currentDocumentReferences(record.documents ?? []);
  const hasDocumentHistory = (record.documents ?? []).length > 1;

  return (
    <div className={styles.review}>
      {record.duplicateReview ? (
        <section className="panel" aria-labelledby="duplicate-review-heading">
          <div className="pn-head">
            <div>
              <h2 id="duplicate-review-heading">Duplicate identity review</h2>
              <p className="sub">Approver decision · no record is merged automatically</p>
            </div>
            <StatusBadge tone="alert">Review required</StatusBadge>
          </div>
          <div className="pn-body">
            <p className={styles.note}>
              The applicant name matches an existing student record.
              {record.candidateStudentName ? (
                <> Candidate: <strong>{record.candidateStudentName}</strong></>
              ) : null}
              {record.duplicateReviewRef ? (
                <> · review reference <span className="num">{record.duplicateReviewRef}</span></>
              ) : null}
              . Verifying the identity returns the application to admissions review; rejecting it declines the
              application. No student record is created or merged here.
            </p>
            {canApprove ? (
              <>
                <div className="field">
                  <label htmlFor="duplicate-review-reason">Reason (recorded with the evidence)</label>
                  <textarea
                    id="duplicate-review-reason"
                    className="textarea"
                    value={duplicateReason}
                    onChange={(event) => setDuplicateReason(event.target.value)}
                    placeholder="What was checked, and how the identity was confirmed or rejected?"
                  />
                </div>
                {duplicateError !== null ? (
                  <p className="field-error" role="alert">
                    {duplicateError}
                  </p>
                ) : null}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className="button button--primary button--small"
                    disabled={resolvingDuplicate}
                    onClick={() => void resolveDuplicate("approved")}
                  >
                    {resolvingDuplicate ? "Recording…" : "Verify identity · return to review"}
                  </button>
                  <button
                    type="button"
                    className="button button--danger button--small"
                    disabled={resolvingDuplicate}
                    onClick={() => void resolveDuplicate("rejected")}
                  >
                    Reject · decline application
                  </button>
                </div>
              </>
            ) : (
              <p className={styles.note}>Only an admissions approver can resolve this identity review.</p>
            )}
          </div>
        </section>
      ) : null}
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

          {hasRequestedChange ? (
            <section className="panel" aria-labelledby="version-compare-heading">
              <div className="pn-head">
                <div>
                  <h2 id="version-compare-heading">Version comparison</h2>
                  <p className="sub">Requested-change history from the loaded record</p>
                </div>
              </div>
              <div className="pn-body">
                {previousVersion && latestVersion ? (
                  <>
                    <div className="callout">
                      <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
                        info
                      </span>
                      <span className="small">
                        Field-level compare between immutable submission snapshots v{previousVersion.version} and v
                        {latestVersion.version}. Only changed answers are marked; everything else is unchanged.
                      </span>
                    </div>
                    <dl className={styles.versionFields} aria-label="Submitted answer comparison">
                      {VERSION_FIELD_LABELS.map(({ key, label }) => {
                        const before = snapshotValue(previousVersion.snapshot, key);
                        const after = snapshotValue(latestVersion.snapshot, key);
                        const changed = before !== after;
                        return (
                          <div key={key} className={changed ? styles.versionChanged : undefined}>
                            <dt>
                              {label}
                              {changed ? <span className={styles.changeTag}>Changed</span> : null}
                            </dt>
                            <dd>
                              {changed ? (
                                <>
                                  <span className={styles.versionOld}>{before}</span>
                                  <span aria-hidden="true"> → </span>
                                  <span>{after}</span>
                                </>
                              ) : (
                                after
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </>
                ) : (
                  <>
                    <div className="callout">
                      <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
                        info
                      </span>
                      <span className="small">Submitted answers beside current answers. A field-level compare appears once a resubmission snapshot exists. History below comes from the loaded timeline.</span>
                    </div>
                    <div className={styles.versionGrid}>
                      <div className={styles.versionCard}>
                        <h3>Submitted</h3>
                        {firstSubmittedEvent ? (
                          <>
                            <p className={styles.versionMeta}>
                              <span className="num">{formatKolkata(firstSubmittedEvent.atIso, { format: "short" })}</span>
                            </p>
                            <p className={styles.versionNote}>{firstSubmittedEvent.note}</p>
                            <p className={styles.versionMeta}>{firstSubmittedEvent.actor}</p>
                          </>
                        ) : null}
                      </div>
                      <div className={styles.versionCard}>
                        <h3>{resubmissionEvent ? "Resubmitted" : "Current"}</h3>
                        {resubmissionEvent ? (
                          <>
                            <p className={styles.versionMeta}>
                              <span className="num">{formatKolkata(resubmissionEvent.atIso, { format: "short" })}</span>
                            </p>
                            <p className={styles.versionNote}>{resubmissionEvent.note}</p>
                            <p className={styles.versionMeta}>{resubmissionEvent.actor}</p>
                          </>
                        ) : (
                          <p className={styles.versionNote}>Awaiting resubmission. The answers below are the current record.</p>
                        )}
                      </div>
                    </div>
                    {firstChangeEvent ? (
                      <ol className={styles.versionDiff}>
                        <li>
                          <strong>Change requested</strong>
                          <span>{firstChangeEvent.note}</span>
                        </li>
                        <li>
                          <strong>{resubmissionEvent ? "Resubmission received" : "Resubmission pending"}</strong>
                          <span>{resubmissionEvent ? resubmissionEvent.note : "No later submission is on the loaded timeline yet."}</span>
                        </li>
                      </ol>
                    ) : null}
                    <div className="facts-ledger" aria-label="Current answers">
                      <div className="fl-row">
                        <span className="k">Student</span>
                        <span className="v">{record.studentName}</span>
                      </div>
                      <div className="fl-row">
                        <span className="k">Guardian</span>
                        <span className="v">{record.parentName}</span>
                      </div>
                      <div className="fl-row">
                        <span className="k">Contact</span>
                        <span className="v num">{record.contact}</span>
                      </div>
                      <div className="fl-row">
                        <span className="k">Grade and session</span>
                        <span className="v">{record.grade} · {record.session}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>
          ) : null}

          <section className="panel" aria-labelledby="documents-heading">
            <h2 id="documents-heading" className="section-label">
              Documents
            </h2>
            {supabaseMode ? (
              (record.documents ?? []).length === 0 ? (
                <p className={styles.note}>
                  {record.status === "Draft" || record.status === "Changes requested"
                    ? "No documents have been attached to this application yet. The applicant can upload them from the application draft until the window closes."
                    : "No documents have been attached to this application."}
                </p>
              ) : (
                <ul className={styles.documents}>
                  {(record.documents ?? []).map((document) => {
                    const ready = document.finalizedAtIso !== null && (document.scanStatus === "clean" || document.scanStatus === "ready");
                    return (
                      <li key={document.reference} className={styles.documentRow}>
                        <span>
                          {documentLabel(document.requirementCode ?? document.category, documentLabels)}{" "}
                          <span className={styles.documentState}>· {scanStateLabel(document.scanStatus)}</span>
                          <span className={styles.documentState}>
                            {" "}· {document.filename} · {formatBytes(document.sizeBytes)}
                          </span>
                          {hasDocumentHistory ? (
                            <span className={styles.documentState}>
                              {" "}· {currentDocumentRefs.has(document.reference) ? "Current" : "Earlier upload"}
                            </span>
                          ) : null}
                        </span>
                        {ready ? (
                          <a
                            className={`button button--small button--quiet ${styles.documentButton}`}
                            href={`/api/documents/${encodeURIComponent(document.reference)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open file
                          </a>
                        ) : (
                          <span className={styles.note}>Not downloadable while {scanStateLabel(document.scanStatus).toLowerCase()}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <>
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
                <p className={styles.note}>
                  Demo uploads · preview shows metadata only. Missing and access-denied states are selectable for
                  recovery review; no private file is opened.
                </p>
              </>
            )}
          </section>
        </div>

        <div className={styles.right}>
          <section className="panel" aria-labelledby="timeline-heading">
            <div className="pn-head">
              <div>
                <h2 id="timeline-heading">Applicant-visible history</h2>
                <p className="sub">Shown to the applicant</p>
              </div>
            </div>
            <div className="pn-body">
              <div className="callout">
                <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
                  info
                </span>
                <span className="small">Only reasons recorded here leave the staff workspace. Staff-only context lives in the separate panel below.</span>
              </div>
            <ol className={styles.timeline}>
              {record.timeline.map((event, index) => (
                <li key={timelineEventKey(event, index)} className={styles.timelineRow}>
                  <span className={styles.timelineDot} aria-hidden="true" />
                  <div>
                    <p className={styles.timelineHead}>
                      <strong>{event.status}</strong>
                      <span className="num">{formatKolkata(event.atIso, { format: "short" })}</span>
                    </p>
                    <p className={styles.timelineNote}>
                      {event.note} <span className={styles.timelineActor}>· {event.actor}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            </div>
          </section>

          <section className="panel" aria-labelledby="staff-context-heading">
            <div className="pn-head">
              <div>
                <h2 id="staff-context-heading">Staff-internal context</h2>
                <p className="sub">Staff only, never shown to applicants</p>
              </div>
            </div>
            <div className="pn-body">
              <div className="facts-ledger" aria-label="Staff-internal context">
                <div className="fl-row">
                  <span className="k">Latest review</span>
                  <span className="v">
                    {latestReview ? (
                      <>
                        {latestReview.action.replace(/_/g, " ")} · {officerLabel(latestReview, reviewerNames)} ·{" "}
                        <time className="num" dateTime={latestReview.atIso}>
                          {formatKolkata(latestReview.atIso, { format: "short" })}
                        </time>
                      </>
                    ) : (
                      "Not recorded"
                    )}
                  </span>
                </div>
                <div className="fl-row">
                  <span className="k">Duplicate check</span>
                  <span className="v">{record.duplicateReview ? "Flagged for duplicate review" : "No duplicate flag"}</span>
                </div>
                <div className="fl-row">
                  <span className="k">Application</span>
                  <span className="v num">{record.ref}</span>
                </div>
              </div>
              {(record.staffReviews ?? []).length > 0 ? (
                <ol className={styles.staffNotes} aria-label="Staff-only notes">
                  {(record.staffReviews ?? []).map((review, index) => (
                    <li key={staffReviewKey(review, index)} className={styles.staffNote}>
                      <p className={styles.staffNoteHead}>
                        <strong>{review.action.replace(/_/g, " ")}</strong>
                        <time className="num" dateTime={review.atIso}>
                          {formatKolkata(review.atIso, { format: "short" })}
                        </time>
                      </p>
                      <p className={styles.staffNoteLine}>Recorded by {officerLabel(review, reviewerNames)}</p>
                      {review.visibleReason ? (
                        <p className={styles.staffNoteLine}>Applicant-visible reason: {review.visibleReason}</p>
                      ) : null}
                      <p className={styles.staffNoteLine}>
                        {review.privateNote ? (
                          <>
                            <strong>Private note:</strong> {review.privateNote}
                          </>
                        ) : (
                          "No private note recorded with this step."
                        )}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={styles.note}>No staff notes recorded yet.</p>
              )}
              <p className={styles.note}>Kept out of the applicant timeline above. Private notes never leave this workspace.</p>
            </div>
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
                    <label htmlFor="decision-reason">Reason shown to applicant (required)</label>
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
                      Shown to the applicant on the visible history above. Minimum {REASON_MIN_LENGTH} characters. Staff-only context stays in the internal panel and is never sent.
                    </p>
                    {validationError ? (
                      <p id="decision-reason-error" className="field-error" role="alert">
                        {validationError}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {actionMeta ? (
                  <div className="field">
                    <label htmlFor="decision-private-note">Private note (staff only, optional)</label>
                    <textarea
                      id="decision-private-note"
                      className="textarea"
                      value={privateNote}
                      onChange={(event) => setPrivateNote(event.target.value)}
                      disabled={processing}
                      placeholder="Context for other staff · verification checked, documents queried. Never shown to the applicant."
                      aria-describedby="decision-private-note-help"
                    />
                    <p id="decision-private-note-help" className="field-help">
                      Recorded on the staff review row and shown only in the internal panel below.
                    </p>
                  </div>
                ) : null}

                <div className={styles.actions}>
                  <button type="button" className="button button--primary" onClick={(event) => continueToConfirm(event.currentTarget)} disabled={!action || processing}>
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
                Some decisions are hidden because the active workspace lacks the matching grant (review vs approve).
                The service enforces the decision.
              </p>
            ) : null}
            <p className={styles.note}>{!supabaseMode ? "UI demo - recorded in the demo session only. " : ""}Staff-internal context above is never shown to applicants.</p>
          </section>
        </div>
      </div>

      {confirming && actionMeta && action ? (
        <DecisionConfirmDialog
          applicationRef={record.ref}
          studentName={record.studentName}
          actionLabel={actionMeta.label}
          actionTone={actionMeta.tone}
          currentStatus={record.status}
          targetStatus={TARGET_STATUS[action]}
          reason={reason.trim() || defaultNoteFor(action)}
          demoMode={!supabaseMode}
          processing={processing}
          error={actionError}
          trigger={confirmTriggerRef.current}
          onClose={cancelConfirm}
          onConfirm={() => void recordDecision()}
        />
      ) : null}
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
