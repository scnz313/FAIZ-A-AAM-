"use client";

import { useState } from "react";

import { documentsService, type DocumentProcessingState, type PrivateDocumentMetadata } from "@/modules/services/documents";

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

export function PrivateDocumentList({
  documents,
  emptyTitle = "No private documents",
  emptyNote = "Authorized files appear here after an upload or generated document is recorded.",
  showOwner = false,
  showProcessing = false,
}: {
  documents: PrivateDocumentMetadata[];
  emptyTitle?: string;
  emptyNote?: string;
  showOwner?: boolean;
  showProcessing?: boolean;
}) {
  const [requesting, setRequesting] = useState<ReadonlySet<string>>(() => new Set());
  const [delivery, setDelivery] = useState<Record<string, DeliveryState>>({});

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
      <div className="workspace-state">
        <p className="workspace-state-title">{emptyTitle}</p>
        <p className="workspace-state-note">{emptyNote}</p>
      </div>
    );
  }

  return (
    <ul className={styles.list}>
      {documents.map((document) => {
        const deliveryState = delivery[document.ref];
        const effectiveState = deliveryState?.state ?? document.processingState;
        const presentation = DOCUMENT_STATE_PRESENTATION[effectiveState];
        const busy = requesting.has(document.ref);
        return (
          <li key={document.ref} className={styles.row}>
            <div className={styles.main}>
              <div className={styles.titleRow}>
                <strong>{document.filename}</strong>
                <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
              </div>
              <p className={styles.meta}>
                <span>{labelFromCode(document.category)}</span>
                <span>{document.mimeType}</span>
                <span className="num">{formatBytes(document.sizeBytes)}</span>
                <span className="num">v{document.version}</span>
              </p>
              {showOwner ? (
                <p className={styles.owner}>
                  {labelFromCode(document.ownerDomain)} · <span className="num">{document.ownerReference ?? "Scoped record"}</span>
                </p>
              ) : null}
              {showProcessing ? (
                <dl className={styles.processing}>
                  <div>
                    <dt>Finalization</dt>
                    <dd>{document.finalizationState === "verified" ? `Verified ${dateLabel(document.finalizedAtIso)}` : document.finalizationState === "failed" ? "Failed" : "Awaiting byte verification"}</dd>
                  </div>
                  <div>
                    <dt>Scan</dt>
                    <dd>{presentation.label}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{dateLabel(document.updatedAtIso ?? document.createdAtIso)}</dd>
                  </div>
                </dl>
              ) : null}
              <p className={styles.note}>{deliveryState?.message ?? presentation.note}</p>
            </div>
            <div className={styles.actions}>
              <span className={`num ${styles.reference}`}>{document.ref}</span>
              {document.processingState === "ready" ? (
                <button
                  type="button"
                  className="button button--primary button--small"
                  disabled={busy}
                  onClick={() => void requestDownload(document)}
                >
                  {busy ? "Authorizing…" : "Download"}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default PrivateDocumentList;
