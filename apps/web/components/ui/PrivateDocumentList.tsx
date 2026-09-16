"use client";

import { useEffect, useMemo, useState } from "react";

import {
  documentsService,
  type DocumentProcessingState,
  type DocumentVisibility,
  type PrivateDocumentMetadata,
} from "@/modules/services/documents";

import { StatusBadge, type StatusTone } from "./StatusBadge";
import styles from "./PrivateDocumentList.module.css";

export const DOCUMENT_STATE_PRESENTATION: Record<DocumentProcessingState, { label: string; note: string; tone: StatusTone }> = {
  pending: {
    label: "Processing",
    note: "The upload is being finalized or scanned. It cannot be opened yet.",
    tone: "watch",
  },
  ready: {
    label: "Ready",
    note: "The private file passed finalization and scanning.",
    tone: "good",
  },
  quarantined: {
    label: "Quarantined",
    note: "Security scanning isolated this file. Ask the uploader to replace it.",
    tone: "alert",
  },
  failed: {
    label: "Processing failed",
    note: "The file could not be finalized or scanned. Retry processing or request a replacement.",
    tone: "alert",
  },
  denied: {
    label: "Access denied",
    note: "Your current relationship, role, or assignment cannot access this file.",
    tone: "offline",
  },
  expired: {
    label: "Expired",
    note: "The file or its retention period has expired and it is no longer available.",
    tone: "neutral",
  },
};

type ReadinessFilter = "all" | DocumentProcessingState;

/* Readiness chips reuse only the processing states the documents service
   exposes, in register order. There is no "missing" state in the data
   model — an absent file is simply no record — so no chip is rendered
   for it. Labels come from the presentation map above, never invented. */
const READINESS_STATE_ORDER: ReadonlyArray<DocumentProcessingState> = [
  "ready",
  "pending",
  "failed",
  "quarantined",
  "denied",
  "expired",
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function labelFromCode(value: string): string {
  return value
    .replace(/^generated_/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: string | null): string {
  if (value === null) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recorded";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

type DeliveryState = { state: DocumentProcessingState; message: string };

/** Only school-level documents belong in the anonymous public downloads
 *  register. Student, applicant, staff, and import records stay private, so
 *  the approval control is unavailable for them. */
const PUBLIC_REGISTER_OWNER_DOMAIN = "school_document";
const PUBLIC_APPROVAL_ELIGIBLE_TITLE = "Only clean, finalized documents can be approved for public view.";
const PUBLIC_APPROVAL_INELIGIBLE_TITLE =
  "Only school documents can be approved for the public downloads register. Student, applicant, staff, and import records stay private.";

export type PublicApprovalControls = {
  /** References currently waiting for the visibility change to persist. */
  pending: ReadonlySet<string>;
  /** Per-document refusal/error messages keyed by document reference. */
  errors: Record<string, string>;
  onChange: (document: PrivateDocumentMetadata, visibility: DocumentVisibility) => void;
};

export function PrivateDocumentList({
  documents,
  totalRecords,
  emptyTitle = "No private documents",
  emptyNote = "Authorized files appear here after an upload or generated document is recorded.",
  showOwner = false,
  showProcessing = false,
  publicApproval,
}: {
  documents: PrivateDocumentMetadata[];
  /** Exact server total when the list is paged; omitted for fully loaded lists. */
  totalRecords?: number;
  emptyTitle?: string;
  emptyNote?: string;
  showOwner?: boolean;
  showProcessing?: boolean;
  publicApproval?: PublicApprovalControls;
}) {
  const [requesting, setRequesting] = useState<ReadonlySet<string>>(() => new Set());
  const [delivery, setDelivery] = useState<Record<string, DeliveryState>>({});
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  /* Category chips are derived from the authorized records in hand, never
     hardcoded, so no category is faked into the register. */
  const categories = useMemo(
    () => Array.from(new Set(documents.map((document) => document.category))).sort((a, b) => a.localeCompare(b)),
    [documents],
  );

  useEffect(() => {
    if (categoryFilter !== "all" && !categories.includes(categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [categories, categoryFilter]);

  const visibleDocuments = useMemo(
    () =>
      documents.filter(
        (document) =>
          (readinessFilter === "all" || document.processingState === readinessFilter) &&
          (categoryFilter === "all" || document.category === categoryFilter),
      ),
    [documents, readinessFilter, categoryFilter],
  );

  const filtersActive = readinessFilter !== "all" || categoryFilter !== "all";

  function clearFilters() {
    setReadinessFilter("all");
    setCategoryFilter("all");
  }

  async function requestDownload(document: PrivateDocumentMetadata) {
    if (requesting.has(document.ref)) return;
    setRequesting((current) => new Set(current).add(document.ref));
    try {
      const result = await documentsService.requestDownload(document.ref);
      if (result.state !== "ready") {
        setDelivery((current) => ({ ...current, [document.ref]: { state: result.state, message: result.message } }));
        return;
      }

      const expiresAt = new Date(result.expiresAtIso).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        setDelivery((current) => ({
          ...current,
          [document.ref]: { state: "expired", message: "The short-lived link expired before it could open. Request a fresh download." },
        }));
        return;
      }

      const link = window.document.createElement("a");
      link.href = result.url;
      link.download = result.filename;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      setDelivery((current) => ({
        ...current,
        [document.ref]: { state: "ready", message: "A short-lived download link was issued and opened in a new tab." },
      }));
    } catch {
      setDelivery((current) => ({
        ...current,
        [document.ref]: { state: "failed", message: "The download request failed. Check your connection and try again." },
      }));
    } finally {
      setRequesting((current) => {
        const next = new Set(current);
        next.delete(document.ref);
        return next;
      });
    }
  }

  if (documents.length === 0) {
    return (
      <div className={`workspace-state ${styles.emptyPad}`}>
        <p className="workspace-state-title">{emptyTitle}</p>
        <p className="workspace-state-note">{emptyNote}</p>
      </div>
    );
  }

  return (
    <>
      <div className={styles.filters}>
        <div className="tabs" role="group" aria-label="Filter documents by readiness">
          <button
            type="button"
            className={readinessFilter === "all" ? "active" : undefined}
            aria-pressed={readinessFilter === "all"}
            onClick={() => setReadinessFilter("all")}
          >
            All <span className="num">{documents.length}</span>
          </button>
          {READINESS_STATE_ORDER.map((state) => (
            <button
              key={state}
              type="button"
              className={readinessFilter === state ? "active" : undefined}
              aria-pressed={readinessFilter === state}
              onClick={() => setReadinessFilter(state)}
            >
              {DOCUMENT_STATE_PRESENTATION[state].label}{" "}
              <span className="num">{documents.filter((document) => document.processingState === state).length}</span>
            </button>
          ))}
        </div>
        {categories.length > 1 ? (
          <div className="tabs" role="group" aria-label="Filter documents by category">
            <button
              type="button"
              className={categoryFilter === "all" ? "active" : undefined}
              aria-pressed={categoryFilter === "all"}
              onClick={() => setCategoryFilter("all")}
            >
              All categories <span className="num">{documents.length}</span>
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={categoryFilter === category ? "active" : undefined}
                aria-pressed={categoryFilter === category}
                onClick={() => setCategoryFilter(category)}
              >
                {labelFromCode(category)}{" "}
                <span className="num">{documents.filter((document) => document.category === category).length}</span>
              </button>
            ))}
          </div>
        ) : null}
        <p className={styles.filterCount} aria-live="polite">
          {filtersActive ? (
            <>Showing <span className="num">{visibleDocuments.length}</span> of <span className="num">{documents.length}</span> loaded records</>
          ) : totalRecords !== undefined && totalRecords > documents.length ? (
            <>Showing <span className="num">{documents.length}</span> of <span className="num">{totalRecords}</span> records</>
          ) : (
            <>Showing all <span className="num">{documents.length}</span> {documents.length === 1 ? "record" : "records"}</>
          )}
        </p>
      </div>
      {visibleDocuments.length === 0 ? (
        <div className={`workspace-state ${styles.emptyPad}`}>
          <p className="workspace-state-title">No documents in this view</p>
          <p className="workspace-state-note">No authorized records match the selected filters. Clearing the filters restores the full register.</p>
          <button type="button" className={`button button--quiet ${styles.clearButton}`} onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="table-wrap" role="region" aria-label="Private files register" tabIndex={0}>
          <table className={`ledger ${styles.table}`}>
            <caption className="sr-only">Private files with processing state and download actions</caption>
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.actionHead}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleDocuments.map((document) => {
                const deliveryState = delivery[document.ref];
                const effectiveState = deliveryState?.state ?? document.processingState;
                const presentation = DOCUMENT_STATE_PRESENTATION[effectiveState];
                const busy = requesting.has(document.ref);
                const approvalBusy = publicApproval?.pending.has(document.ref) ?? false;
                const approvalError = publicApproval?.errors[document.ref];
                const isPublic = document.visibility === "public_approved";
                const publicEligible = document.ownerDomain === PUBLIC_REGISTER_OWNER_DOMAIN;
                const note = approvalError ?? deliveryState?.message ?? presentation.note;
                return (
                  <tr key={document.ref}>
                    <td className={styles.documentCell}>
                      <strong className={styles.fileName}>{document.filename}</strong>
                      <span className={styles.meta}>
                        {labelFromCode(document.category)} · <span className="num">{formatBytes(document.sizeBytes)}</span> · v<span className="num">{document.version}</span>
                      </span>
                      <span className={`num ${styles.meta}`}>{document.ref}</span>
                      {showOwner ? (
                        <span className={styles.owner}>
                          {labelFromCode(document.ownerDomain)} · <span className="num">{document.ownerReference ?? "Scoped record"}</span>
                        </span>
                      ) : null}
                      {showProcessing ? (
                        <span className={styles.note}>
                          {document.finalizationState === "verified" ? `Verified ${dateLabel(document.finalizedAtIso)}` : document.finalizationState === "failed" ? "Failed" : "Awaiting byte verification"} · Updated {dateLabel(document.updatedAtIso ?? document.createdAtIso)}
                        </span>
                      ) : null}
                      {note ? (
                        <span className={styles.note} role={approvalError ? "alert" : undefined}>{note}</span>
                      ) : null}
                      {publicApproval && !publicEligible && !isPublic && approvalError === undefined ? (
                        <span className={styles.note}>Not eligible for the public downloads register.</span>
                      ) : null}
                    </td>
                    <td className={styles.statusCell}>
                      {isPublic ? <StatusBadge tone="good">Public</StatusBadge> : null}
                      <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
                    </td>
                    <td className={styles.actionCell}>
                      <div className={styles.rowActions}>
                        {publicApproval ? (
                          isPublic ? (
                            <button
                              type="button"
                              className="btn btn-quiet btn-sm"
                              disabled={approvalBusy}
                              onClick={() => publicApproval.onChange(document, "private")}
                            >
                              {approvalBusy ? "Updating…" : "Withdraw"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-quiet btn-sm"
                              disabled={approvalBusy || document.processingState !== "ready" || !publicEligible}
                              title={publicEligible ? PUBLIC_APPROVAL_ELIGIBLE_TITLE : PUBLIC_APPROVAL_INELIGIBLE_TITLE}
                              onClick={() => publicApproval.onChange(document, "public_approved")}
                            >
                              {approvalBusy ? "Updating…" : "Approve"}
                            </button>
                          )
                        ) : null}
                        {document.processingState === "ready" ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={() => void requestDownload(document)}
                          >
                            {busy ? "Authorizing…" : "Download"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default PrivateDocumentList;
