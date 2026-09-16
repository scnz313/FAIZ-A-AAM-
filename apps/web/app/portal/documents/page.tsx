"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { PrivateDocumentList } from "@/components/ui/PrivateDocumentList";
import { formatKolkata } from "@/modules/iot/domain";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { documentsService, formatINR, type ReportCardDocument, type StudentDocumentBundle } from "@/modules/services/documents";

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
    description: "The record has metadata, but no file is attached to this demo record yet. Ask the school office to provide it.",
  },
  "access-denied": {
    title: "Access denied",
    description: "This simulates a server authorization response. Ask the school office to confirm the linked-child access. No private file was requested or exposed.",
  },
};

const DOWNLOAD_COPY: Record<DemoFileState, string> = {
  "demo-preview": "Demo file not provided · this preview contains metadata only, so no download started.",
  missing: "Demo file not provided · this record has no attached file. Ask the school office to upload it.",
  "access-denied": "Demo download blocked · access denied. No private file was requested or exposed.",
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
          <p className="field-help">State selector for review only · it does not call a storage or authorization service.</p>
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
  const { context, activeStudent, status: contextStatus, errorMessage: contextError, retry: retryContext } = useFamilyContext();
  const supabaseMode = clientAdapterMode() === "supabase";
  const childName = activeStudent ? activeStudent.student.displayName : "the linked student";

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
      {/* V14 PageHead */}
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Documents</h1>
          <p className="ph-sub">
            Report cards, receipts, certificates and school records for {childName}. Private documents are scanned before they appear.
          </p>
          <ActiveChildLine />
        </div>
      </div>

      {contextStatus === "error" ? (
        <div className="workspace-state" role="alert">
          <p className="workspace-state-title">Documents unavailable</p>
          <p className="workspace-state-note">
            The active child could not be resolved{contextError ? ` · ${contextError}` : "."}
          </p>
          <button type="button" className="button button--quiet" onClick={retryContext}>
            Try again
          </button>
        </div>
      ) : bundleError ? (
        <div className="workspace-state" role="alert">
          <p className="workspace-state-title">Documents unavailable</p>
          <p className="workspace-state-note">{bundleError}</p>
          <button type="button" className="button button--quiet" onClick={() => setReloadKey((key) => key + 1)}>
            Try again
          </button>
        </div>
      ) : bundle === null ? (
        <div className={styles.loadingBlock} role="status" aria-busy="true">
          <span className="sr-only">Loading documents…</span>
          <span className="skeleton-rule" aria-hidden="true" />
          <span className="skeleton-bar" style={{ width: "58%" }} aria-hidden="true" />
          <span className="skeleton-bar" style={{ width: "74%" }} aria-hidden="true" />
          <span className="skeleton-bar" style={{ width: "42%" }} aria-hidden="true" />
        </div>
      ) : (
        <>
          {supabaseMode ? (
            <section className="panel" aria-labelledby="private-files-heading">
              <div className="pn-head">
                <h2 id="private-files-heading">Private files</h2>
                <p className="sub">Scanned uploads and generated records for {childName}</p>
              </div>
              <div className="pn-body flush">
                <PrivateDocumentList
                  documents={bundle.metadata ?? []}
                  emptyTitle="No private files yet"
                  emptyNote={`Files generated or uploaded for ${childName} appear here with their finalization and scan state.`}
                />
              </div>
            </section>
          ) : null}

          {/* V14 Panel with flush ledger table for report cards */}
          <section className="panel">
            <div className="pn-head"><h2>Report cards</h2></div>
            <div className="pn-body flush">
              {bundle.reportCards.length === 0 ? (
                <div className="pn-body">
                  <p className="muted small">
                    No report cards yet. Published term reports appear here once the school releases them for {childName}.
                  </p>
                  <Link prefetch={false} className="btn btn-ghost btn-sm" href="/portal/results">
                    Open results
                  </Link>
                </div>
              ) : (
              <div className="table-wrap">
                <table className={`ledger ${styles.registerTable}`}>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Kind</th>
                      <th>Added</th>
                      <th>State</th>
                      <th className={styles.actionHead}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle.reportCards.map((term) => {
                      const available = term.publicationStatus !== "not-published";
                      const document = reportCardDocument(term);
                      return (
                        <tr key={term.termId}>
                          <td>
                            <span className={styles.docTitle}>
                              <span className={`msym ${styles.docIcon}`} aria-hidden="true">description</span>
                              {term.termLabel} report card
                            </span>
                          </td>
                          <td className="small muted">Report card</td>
                          <td className="num small">
                            {term.publishedAtIso ? formatKolkata(term.publishedAtIso, { format: "day" }) : "—"}
                          </td>
                          <td>
                            {available ? (
                              <span className="status-badge status-badge--good">
                                <span className="status-dot status-dot--good" aria-hidden="true" />
                                {term.publicationStatus === "final"
                                  ? (supabaseMode ? "Published" : "Ready")
                                  : "Provisional"}
                              </span>
                            ) : (
                              <span className="status-badge status-badge--neutral">
                                <span className="status-dot status-dot--neutral" aria-hidden="true" />
                                Not published
                              </span>
                            )}
                          </td>
                          <td className={styles.actionCell}>
                            {available ? (
                              <div className={styles.rowActions}>
                                <Link prefetch={false} className="btn btn-ghost btn-sm" href={`/portal/results?term=${term.termId}`}>
                                  <span className="msym" style={{ fontSize: 16 }}>visibility</span> View
                                </Link>
                                {!supabaseMode ? (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={(event) => openPreview(document, event.currentTarget)}
                                  >
                                    <span className="msym" style={{ fontSize: 16 }}>download</span> PDF
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              <span className="tiny muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          </section>

          {/* V14 Panel with flush ledger table for receipts */}
          <section className="panel">
            <div className="pn-head"><h2>Receipts</h2></div>
            <div className="pn-body flush">
              {bundle.receipts.length === 0 ? (
                <div className="pn-body">
                  <p className="muted small">No receipts yet. Numbered receipts appear here after a payment is recorded for {childName}.</p>
                  <Link prefetch={false} className="btn btn-ghost btn-sm" href="/portal/fees">
                    Go to the fee ledger
                  </Link>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className={`ledger ${styles.registerTable}`}>
                    <thead>
                      <tr>
                        <th>Document</th>
                        <th>Kind</th>
                        <th>Added</th>
                        <th>State</th>
                        <th className={styles.actionHead}><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
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
                          <tr key={receipt.ref}>
                            <td>
                              <span className={styles.docTitle}>
                                <span className={`msym ${styles.docIcon}`} aria-hidden="true">receipt_long</span>
                                {receipt.ref}
                              </span>
                            </td>
                            <td className="small muted">Receipt · {receipt.method}</td>
                            <td className="num small">{formatKolkata(receipt.issuedAtIso, { format: "day" })}</td>
                            <td>
                              <span className="status-badge status-badge--good">
                                <span className="status-dot status-dot--good" aria-hidden="true" />
                                Ready
                              </span>
                            </td>
                            <td className={styles.actionCell}>
                              <div className={styles.rowActions}>
                                <Link prefetch={false} className="btn btn-ghost btn-sm" href={`/portal/receipts/${receipt.ref}`}>
                                  <span className="msym" style={{ fontSize: 16 }}>visibility</span> View
                                </Link>
                                {!supabaseMode ? (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={(event) => openPreview(document, event.currentTarget)}
                                  >
                                    <span className="msym" style={{ fontSize: 16 }}>download</span> PDF
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
            </div>
          </section>

          {/* V14 Panel for certificates */}
          <section className="panel">
            <div className="pn-head"><h2>Certificates</h2></div>
            <div className="pn-body">
              <p className="muted small">No certificates yet. Certificates requested through the school office appear here.</p>
            </div>
          </section>

          {/* Panel for school record references */}
          <section className="panel">
            <div className="pn-head"><h2>School records</h2></div>
            <div className="pn-body flush">
              <div className={styles.recordStrip} aria-label="School record references">
                <div className={styles.recordCell}>
                  <span className={styles.recordLabel}>Student reference</span>
                  <span className={`num ${styles.recordValue}`}>{bundle.studentRef}</span>
                </div>
                <div className={styles.recordCell}>
                  <span className={styles.recordLabel}>Enrolment reference</span>
                  <span className={`num ${styles.recordValue}`}>{bundle.enrollmentRef}</span>
                </div>
              </div>
              <p className="muted small" style={{ margin: 0, padding: "12px 16px 14px" }}>
                References identify the school record. Issued certificates and generated documents appear in the register above once the school publishes them.
              </p>
            </div>
          </section>

          {/* V14 callout for quarantined files */}
          <div style={{ marginTop: 18 }}>
            <div className="callout" style={{ borderColor: "var(--madder-line)" }}>
              <span className="msym" style={{ fontSize: 20, flex: "none", marginTop: 1, color: "var(--madder-ink)" }}>gpp_maybe</span>
              <span className="small">
                <strong>Quarantined files are never processed.</strong> If a document you uploaded fails the safety scan, it is held and the office contacts you. Nothing unreadable ever reaches a student record.
              </span>
            </div>
          </div>

          {!supabaseMode ? (
            <p className={styles.demoNote}>
              <span className="demo-badge">Demo data</span>
              <span>Fictional documents for {childName} · previews show metadata only; no private file or real download is available.</span>
            </p>
          ) : null}
        </>
      )}

      {!supabaseMode && preview ? (
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
