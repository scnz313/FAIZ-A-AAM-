"use client";

import { useEffect, useRef, useState } from "react";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { documentsService, formatINR, type ReportCardDocument, type StudentDocumentBundle } from "@/modules/services/documents";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./page.module.css";

type DemoFileState = "demo-preview" | "missing" | "access-denied";

type PreviewDocument = {
  id: string;
  title: string;
  fileName: string;
  format: string;
  size: string;
  updated: string;
  description: string;
};

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
    description: "The record has metadata, but no file is attached to this demo record yet. Ask the school office to provide it.",
  },
  "access-denied": {
    title: "Access denied",
    description: "This simulates a server authorization response. Ask the school office to confirm the linked-child access. No private file was requested or exposed.",
  },
};

const DOWNLOAD_COPY: Record<DemoFileState, string> = {
  "demo-preview": "Demo file not provided — this preview contains metadata only, so no download started.",
  missing: "Demo file not provided — this record has no attached file. Ask the school office to upload it.",
  "access-denied": "Demo download blocked — access denied. No private file was requested or exposed.",
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
  const [fileState, setFileState] = useState<DemoFileState>("demo-preview");
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
      aria-labelledby="portal-document-preview-title"
      aria-describedby="portal-document-preview-live-state"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
    >
      <div className={styles.previewContent}>
        <div className={styles.previewHeader}>
          <div>
            <p className="section-label">Document preview · demo</p>
            <h2 id="portal-document-preview-title" className={styles.previewTitle}>
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
            <dd className="num">{file.updated}</dd>
          </div>
        </dl>

        <div className={styles.previewControl}>
          <label htmlFor="portal-document-preview-selector">Demo file state</label>
          <select
            id="portal-document-preview-selector"
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
          <p className="field-help">State selector for review only — it does not call a storage or authorization service.</p>
        </div>

        <section
          id="portal-document-preview-live-state"
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

function reportCardDocument(term: ReportCardDocument): PreviewDocument {
  return {
    id: `report-${term.termId}`,
    title: `${term.termLabel} report card`,
    fileName: `${term.termId}.report-card.demo.pdf`,
    format: "PDF-like metadata preview",
    size: "Not provided",
    updated: term.publishedAtIso ? formatKolkata(term.publishedAtIso, { format: "day" }) : "Not published",
    description: "A fictional report-card preview for the linked demo student.",
  };
}

export default function DocumentsPage() {
  const [preview, setPreview] = useState<PreviewDocument | null>(null);
  const [bundle, setBundle] = useState<StudentDocumentBundle | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { context, activeStudent } = useFamilyContext();
  const childName = activeStudent ? activeStudent.student.displayName : "the linked demo student";

  /* The whole page reads the per-student document bundle through the
     documents service; report cards, receipts, and school-record references
     all come from it. */
  useEffect(() => {
    if (context === null || activeStudent === null) return;
    let cancelled = false;
    setBundle(null);
    setBundleError(null);
    void documentsService
      .listForStudent(context.accountId, activeStudent.student.id)
      .then((next) => {
        if (!cancelled) setBundle(next);
      })
      .catch((error) => {
        if (!cancelled) {
          setBundleError(error instanceof Error ? error.message : "Documents could not be loaded.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [context, activeStudent, reloadKey]);

  function openPreview(file: PreviewDocument, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setPreview(file);
  }

  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">Portal · Documents</p>
        <h1 className={styles.title}>Documents</h1>
        <p className={styles.intro}>Reports, receipts, and records for the linked child.</p>
        <ActiveChildLine />
      </header>

      {bundleError ? (
        <div className="workspace-state" role="alert">
          <p className="workspace-state-title">Documents unavailable</p>
          <p className="workspace-state-note">{bundleError}</p>
          <button type="button" className="button button--quiet" onClick={() => setReloadKey((key) => key + 1)}>
            Try again
          </button>
        </div>
      ) : bundle === null ? (
        <p className={styles.loading} role="status">
          Loading documents…
        </p>
      ) : (
        <>
          <section aria-labelledby="report-cards-heading">
            <h2 id="report-cards-heading" className={styles.groupTitle}>
              Report cards
            </h2>
            <div className={styles.rows}>
              {bundle.reportCards.map((term) => {
                const available = term.publicationStatus !== "not-published";
                const document = reportCardDocument(term);
                return (
                  <div key={term.termId} className={styles.row}>
                    <div>
                      <strong>{term.termLabel} report card</strong>
                      <small>
                        {available
                          ? `${term.publicationStatus === "final" ? "Final" : "Provisional"} report${
                              term.publishedAtIso ? ` · published ${formatKolkata(term.publishedAtIso, { format: "day" })}` : ""
                            }`
                          : "Not yet published"}
                      </small>
                    </div>
                    {available ? (
                      <span className={styles.rowRight}>
                        <a className="link-arrow" href={`/portal/results?term=${term.termId}`}>
                          View results →
                        </a>
                        <button
                          type="button"
                          className={`button button--quiet button--small ${styles.documentButton}`}
                          onClick={(event) => openPreview(document, event.currentTarget)}
                        >
                          Preview (demo)
                        </button>
                      </span>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="receipts-heading">
            <h2 id="receipts-heading" className={styles.groupTitle}>
              Receipts
            </h2>
            <div className={styles.rows}>
              {bundle.receipts.map((receipt) => {
                const document: PreviewDocument = {
                  id: `receipt-${receipt.ref}`,
                  title: `Receipt ${receipt.ref}`,
                  fileName: `${receipt.ref}.receipt.demo.pdf`,
                  format: "PDF-like metadata preview",
                  size: "Not provided",
                  updated: formatKolkata(receipt.issuedAtIso, { format: "day" }),
                  description: "A fictional fee receipt preview. The demo does not contain a downloadable receipt file.",
                };
                return (
                  <div key={receipt.ref} className={styles.row}>
                    <div>
                      <strong>{receipt.ref}</strong>
                      <small>
                        {formatKolkata(receipt.issuedAtIso, { format: "day" })} · {receipt.method} · {receipt.invoiceRef}
                      </small>
                    </div>
                    <span className={styles.rowRight}>
                      <span className={`num ${styles.amount}`}>{formatINR(receipt.amountPaise)}</span>
                      <a className="link-arrow" href={`/portal/receipts/${receipt.ref}`}>
                        View receipt →
                      </a>
                      <button
                        type="button"
                        className={`button button--quiet button--small ${styles.documentButton}`}
                        onClick={(event) => openPreview(document, event.currentTarget)}
                      >
                        Preview (demo)
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="certificates-heading">
            <h2 id="certificates-heading" className={styles.groupTitle}>
              Certificates
            </h2>
            <div className="workspace-state">
              <p className="workspace-state-title">No certificates yet</p>
              <p className="workspace-state-note">
                Certificates requested through the school office appear here.
              </p>
            </div>
          </section>

          <section aria-labelledby="admission-heading">
            <h2 id="admission-heading" className={styles.groupTitle}>
              School records
            </h2>
            <div className={styles.rows}>
              <div className={styles.row}>
                <div>
                  <strong>Student reference</strong>
                  <small>School-held student reference for the linked child.</small>
                </div>
                <span className={`num ${styles.ref}`}>{bundle.studentRef}</span>
              </div>
              <div className={styles.row}>
                <div>
                  <strong>Enrollment reference</strong>
                  <small>Current enrollment in {bundle.gradeSectionLabel}.</small>
                </div>
                <span className={`num ${styles.ref}`}>{bundle.enrollmentRef}</span>
              </div>
            </div>
          </section>

          <p className={styles.demoNote}>
            <span className="demo-badge">Demo data</span>
            <span>Fictional documents for {childName} — previews show metadata only; no private file or real download is available.</span>
          </p>
        </>
      )}

      {preview ? (
        <DocumentPreviewDialog
          key={preview.id}
          file={preview}
          trigger={triggerRef.current}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
