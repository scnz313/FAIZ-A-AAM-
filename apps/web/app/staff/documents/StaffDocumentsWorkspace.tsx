"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useStaffContext } from "@/components/staff/StaffContextProvider";
import Button from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import {
  documentsService,
  type DocumentProcessingState,
  type DocumentVisibility,
  type PrivateDocumentMetadata,
} from "@/modules/services/documents";
import { uploadDocumentFile } from "@/modules/services/document-upload";
import { workspacesForAction } from "@/modules/services/staff-authorization";
import { roleLabel } from "@/modules/services/staff-context";
import { canAnyRole } from "@/modules/services/staff-profiles";

import styles from "./page.module.css";

const DOCUMENT_ACTION = "documents.view" as const;
const PUBLIC_REGISTER_ACTION = "content.publish" as const;

const SCHOOL_DOCUMENT_CATEGORIES = [
  { value: "school_policy", label: "School policy" },
  { value: "disclosure", label: "Disclosure" },
  { value: "fee_schedule", label: "Fee schedule" },
  { value: "circular", label: "Circular" },
  { value: "prospectus", label: "Prospectus" },
] as const;

/* Only school-level documents belong in the anonymous public downloads
   register. Student, applicant, staff, and import records stay private. */
const PUBLIC_REGISTER_OWNER_DOMAIN = "school_document";
const PUBLIC_APPROVAL_ELIGIBLE_TITLE = "Only clean, finalized documents can be approved for public view.";
const PUBLIC_APPROVAL_INELIGIBLE_TITLE =
  "Only school documents can be approved for the public downloads register. Student, applicant, staff, and import records stay private.";

const SCAN_LABEL: Record<string, string> = {
  pending_scan: "Pending",
  ready: "Ready",
  clean: "Clean",
  quarantined: "Quarantined",
  failed: "Failed",
  denied: "Denied",
  expired: "Expired",
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

function shortDate(value: string | null): string {
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

function statusPresentation(document: PrivateDocumentMetadata): { label: string; tone: StatusTone } {
  if (document.visibility === "public_approved") return { label: "Public", tone: "good" };
  switch (document.processingState) {
    case "ready":
      return { label: "Ready", tone: "good" };
    case "pending":
      return { label: "Processing", tone: "watch" };
    case "quarantined":
    case "failed":
      return { label: "Blocked", tone: "alert" };
    default:
      return { label: "Blocked", tone: "neutral" };
  }
}

function processingLine(document: PrivateDocumentMetadata): string {
  const scan = SCAN_LABEL[document.scanState] ?? labelFromCode(document.scanState);
  const finalization =
    document.finalizationState === "verified"
      ? `Finalised ${shortDate(document.finalizedAtIso)}`
      : document.finalizationState === "failed"
        ? "Finalisation failed"
        : "Awaiting byte verification";
  return `Scan: ${scan} · ${finalization}`;
}

export function StaffDocumentsWorkspace() {
  const {
    status,
    errorMessage,
    summary,
    workspaces,
    switching,
    switchWorkspace,
    retry,
  } = useStaffContext();
  const [documents, setDocuments] = useState<PrivateDocumentMetadata[] | null>(null);
  const [documentsTotal, setDocumentsTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [expandedRef, setExpandedRef] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<ReadonlySet<string>>(() => new Set());
  const [delivery, setDelivery] = useState<Record<string, { state: DocumentProcessingState; message: string }>>({});
  const [visibilityPending, setVisibilityPending] = useState<ReadonlySet<string>>(() => new Set());
  const [visibilityErrors, setVisibilityErrors] = useState<Record<string, string>>({});
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<string>(SCHOOL_DOCUMENT_CATEGORIES[0].value);
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const allowed = summary !== null && canAnyRole(summary.roles, DOCUMENT_ACTION);
  const canManagePublicRegister = summary !== null && canAnyRole(summary.roles, PUBLIC_REGISTER_ACTION);
  const activeRoleGrantId = summary?.activeRoleGrantId ?? null;

  const setPublicVisibility = useCallback(
    (document: PrivateDocumentMetadata, visibility: DocumentVisibility) => {
      if (visibilityPending.has(document.ref)) return;
      setVisibilityPending((current) => new Set(current).add(document.ref));
      setVisibilityErrors((current) => {
        const next = { ...current };
        delete next[document.ref];
        return next;
      });
      void documentsService
        .setPublicVisibility(document.ref, visibility)
        .then((updated) => {
          setDocuments((current) =>
            current === null
              ? current
              : current.map((record) => (record.ref === updated.ref ? { ...record, visibility: updated.visibility } : record)),
          );
        })
        .catch((error) => {
          setVisibilityErrors((current) => ({
            ...current,
            [document.ref]: error instanceof Error ? error.message : "The document visibility could not be changed.",
          }));
        })
        .finally(() => {
          setVisibilityPending((current) => {
            const next = new Set(current);
            next.delete(document.ref);
            return next;
          });
        });
    },
    [visibilityPending],
  );

  useEffect(() => {
    if (status !== "ready" || !allowed || activeRoleGrantId === null) {
      setDocuments(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setDocuments(null);
    setDocumentsTotal(0);
    setNextOffset(null);
    setLoadError(null);
    setLoadMoreError(null);
    setCategoryFilter("all");
    setExpandedRef(null);
    void documentsService
      .listForStaff()
      .then((page) => {
        if (cancelled) return;
        setDocuments(page.rows);
        setDocumentsTotal(page.total);
        setNextOffset(page.nextOffset);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Documents could not be loaded.");
      });

    return () => {
      cancelled = true;
    };
  }, [activeRoleGrantId, allowed, reloadKey, status]);

  const loadMoreDocuments = useCallback(async (): Promise<void> => {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await documentsService.listForStaff(nextOffset);
      setDocuments((current) => {
        const seen = new Set((current ?? []).map((record) => record.ref));
        return [...(current ?? []), ...page.rows.filter((record) => !seen.has(record.ref))];
      });
      setDocumentsTotal(page.total);
      setNextOffset(page.nextOffset);
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : "More documents could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextOffset]);

  /* Category chips are derived from the authorized records in hand, never
     hardcoded, so no category is faked into the register. */
  const categories = useMemo(
    () => Array.from(new Set((documents ?? []).map((document) => document.category))).sort((a, b) => a.localeCompare(b)),
    [documents],
  );

  useEffect(() => {
    if (categoryFilter !== "all" && !categories.includes(categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [categories, categoryFilter]);

  const visibleDocuments = useMemo(
    () =>
      (documents ?? []).filter(
        (document) => categoryFilter === "all" || document.category === categoryFilter,
      ),
    [documents, categoryFilter],
  );

  const requestDownload = useCallback(
    async (document: PrivateDocumentMetadata) => {
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
    },
    [requesting],
  );

  if (status === "error") {
    return (
      <div className={styles.accessState} role="alert">
        <p className="eyebrow">Staff · Documents</p>
        <h1 className={styles.accessTitle}>Workspace unavailable</h1>
        <p className={styles.accessNote}>{errorMessage ?? "The staff workspace could not be loaded."}</p>
        <button type="button" className="button button--primary button--small" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }

  if (status === "loading" || summary === null) {
    return (
      <div className={styles.accessState} role="status" aria-live="polite">
        <p className="eyebrow">Staff · Documents</p>
        <h1 className={styles.accessTitle}>Checking document access…</h1>
        <p className={styles.accessNote}>The active workspace is being verified before private metadata is requested.</p>
      </div>
    );
  }

  if (!allowed) {
    const switchTargets = workspacesForAction(workspaces, DOCUMENT_ACTION);
    return (
      <div className={styles.accessState} role="alert">
        <p className="eyebrow">Access control</p>
        <h1 className={styles.accessTitle}>This workspace cannot open documents</h1>
        <p className={styles.accessNote}>
          <strong>{summary.roleLabel}</strong> does not include <span className="num">{DOCUMENT_ACTION}</span>. The
          database remains the final authority for every document record and download.
        </p>
        {switchTargets.length > 0 ? (
          <div className={styles.switchBlock}>
            <p className={styles.accessNote}>Switch to a granted workspace to continue:</p>
            <div className={styles.actions}>
              {switchTargets.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  className="button button--primary button--small"
                  disabled={switching}
                  onClick={() => void switchWorkspace(workspace.id)}
                >
                  {switching ? "Switching…" : `Open as ${roleLabel(workspace.role)}`}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className={styles.accessNote}>No granted workspace on this account can read private document metadata.</p>
        )}
      </div>
    );
  }

  const ownerDomainCount = documents === null
    ? 0
    : new Set(documents.map((document) => document.ownerDomain)).size;
  const demoMode = clientAdapterMode() !== "supabase";

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (uploadPending) return;
    if (uploadFile === null) {
      setUploadError("Choose a document file to upload.");
      return;
    }
    setUploadPending(true);
    setUploadError(null);
    setUploadNotice(null);
    try {
      await uploadDocumentFile({
        ownerDomain: "school_document",
        ownerRecordRef: summary.accountId,
        attachmentCode: uploadCategory,
        file: uploadFile,
      });
      setUploadFile(null);
      if (uploadInputRef.current !== null) uploadInputRef.current.value = "";
      setUploadNotice("Uploaded · waiting for the security scan");
      setReloadKey((key) => key + 1);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The document could not be uploaded.");
    } finally {
      setUploadPending(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1>Private documents</h1>
          <p className="ph-sub">
            Read-only processing oversight for files the active staff workspace is authorized to inspect.
          </p>
        </div>
      </div>

      <p className={styles.scope}>
        Scope: <strong>{summary.profileLabel ?? summary.roleLabel}</strong>. Records come from the database projection for the active role, assignment and owning-record policies; owner labels are context only.
        {ownerDomainCount > 1 ? ` This authorized response contains ${ownerDomainCount} owner domains.` : ""}
        {summary.role === "auditor" ? " Auditor access is read-only; every file request is re-authorized against its owning record." : ""}
      </p>

      <div className={`g32 ${styles.layout}`}>
        <section className="panel" aria-labelledby="document-register-heading">
          <div className="pn-head">
            <div>
              <h2 id="document-register-heading">Authorized files</h2>
              <p className="sub">Processing register</p>
            </div>
            {documents !== null && documentsTotal > 0 ? (
              <p className={styles.resultCount} aria-live="polite">
                <span className="num">{documentsTotal}</span> {documentsTotal === 1 ? "record" : "records"}
              </p>
            ) : null}
          </div>
          <div className="pn-body flush">
            {loadError ? (
              <div className={styles.statePad}>
                <div className="workspace-state" role="alert">
                  <p className="workspace-state-title">Documents unavailable</p>
                  <p className="workspace-state-note">{loadError}</p>
                  <button
                    type="button"
                    className="button button--quiet button--small"
                    onClick={() => setReloadKey((key) => key + 1)}
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : documents === null ? (
              <div className={`${styles.loading} ${styles.statePad}`} role="status" aria-live="polite" aria-busy="true">
                <span className="sr-only">Loading authorized documents…</span>
                <span className="skeleton-rule" aria-hidden="true" />
                <span className="skeleton-bar" style={{ width: "68%" }} aria-hidden="true" />
                <span className="skeleton-bar" style={{ width: "82%" }} aria-hidden="true" />
                <span className="skeleton-bar" style={{ width: "54%" }} aria-hidden="true" />
              </div>
            ) : documents.length === 0 ? (
              <div className={styles.statePad}>
                <div className="workspace-state">
                  <p className="workspace-state-title">No authorized documents</p>
                  <p className="workspace-state-note">
                    {demoMode
                      ? "The demo adapter intentionally exposes no private staff files. Database-authorized records appear here in a connected staff session."
                      : "No document metadata is currently available within this workspace's database-authorized scope."}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {categories.length > 1 ? (
                  <div className={`${styles.chipRow} x-scroll`} role="group" aria-label="Filter documents by category">
                    <button
                      type="button"
                      className={`chip${categoryFilter === "all" ? " on" : ""}`}
                      aria-pressed={categoryFilter === "all"}
                      onClick={() => setCategoryFilter("all")}
                    >
                      All categories <span className="num">{documents.length}</span>
                    </button>
                    {categories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        className={`chip${categoryFilter === category ? " on" : ""}`}
                        aria-pressed={categoryFilter === category}
                        onClick={() => setCategoryFilter(category)}
                      >
                        {labelFromCode(category)}{" "}
                        <span className="num">{documents.filter((document) => document.category === category).length}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {visibleDocuments.length === 0 ? (
                  <div className={styles.statePad}>
                    <div className="workspace-state">
                      <p className="workspace-state-title">No documents in this view</p>
                      <p className="workspace-state-note">No authorized records match the selected category.</p>
                      <button type="button" className="button button--quiet button--small" onClick={() => setCategoryFilter("all")}>
                        Show all categories
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="table-wrap" role="region" aria-label="Authorized document register" tabIndex={0}>
                    <table className="ledger">
                      <caption className="sr-only">Authorized documents with owner, processing state, and actions</caption>
                      <thead>
                        <tr>
                          <th scope="col">Document</th>
                          <th scope="col">Owner</th>
                          <th scope="col">Status</th>
                          <th scope="col">Updated</th>
                          <th scope="col">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleDocuments.map((document) => (
                          <DocumentRow
                            key={document.ref}
                            document={document}
                            expanded={expandedRef === document.ref}
                            onToggle={() => setExpandedRef(expandedRef === document.ref ? null : document.ref)}
                            downloadBusy={requesting.has(document.ref)}
                            delivery={delivery[document.ref]}
                            onDownload={() => void requestDownload(document)}
                            canManagePublicRegister={canManagePublicRegister}
                            approvalBusy={visibilityPending.has(document.ref)}
                            approvalError={visibilityErrors[document.ref]}
                            onVisibility={setPublicVisibility}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className={styles.filterCount} aria-live="polite">
                  {categoryFilter !== "all" ? (
                    <>Showing <span className="num">{visibleDocuments.length}</span> of <span className="num">{documents.length}</span> loaded records</>
                  ) : documentsTotal > documents.length ? (
                    <>Showing <span className="num">{documents.length}</span> of <span className="num">{documentsTotal}</span> records</>
                  ) : (
                    <>Showing all <span className="num">{documents.length}</span> {documents.length === 1 ? "record" : "records"}</>
                  )}
                </p>
              </>
            )}
            {documents !== null && nextOffset !== null ? (
              <div className={styles.moreRow}>
                <Button variant="quiet" onClick={() => void loadMoreDocuments()} disabled={loadingMore}>
                  {loadingMore
                    ? "Loading…"
                    : `Show more documents (${documents.length} of ${documentsTotal})`}
                </Button>
                {loadMoreError !== null ? (
                  <p className="field-error" role="alert" style={{ marginTop: 8 }}>
                    {loadMoreError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <section className={`panel ${styles.registerPanel}`} aria-labelledby="public-register-heading">
          <div className="pn-head">
            <div>
              <h2 id="public-register-heading">Public register</h2>
              <p className="sub">School documents approved for the public downloads page</p>
            </div>
          </div>
          <div className="pn-body">
            {canManagePublicRegister ? (
              <>
                <h3 className={styles.registerTitle}>Add a school document</h3>
                <p className={styles.uploadNote}>
                  Upload a non-sensitive school document for the public downloads register. The file stays private until
                  its security scan is complete, then you can approve it for public view in the register.
                </p>
                <form className={styles.uploadForm} onSubmit={(event) => void handleUpload(event)}>
                  <div className="field">
                    <label htmlFor="school-document-file">Document file</label>
                    <input
                      ref={uploadInputRef}
                      id="school-document-file"
                      className="input"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(event) => {
                        setUploadFile(event.target.files?.[0] ?? null);
                        setUploadError(null);
                      }}
                    />
                    <p className="field-help">PDF, JPEG, or PNG · up to 10 MB.</p>
                  </div>
                  <div className="field">
                    <label htmlFor="school-document-category">Register category</label>
                    <select
                      id="school-document-category"
                      className="select"
                      value={uploadCategory}
                      onChange={(event) => setUploadCategory(event.target.value)}
                    >
                      {SCHOOL_DOCUMENT_CATEGORIES.map((category) => (
                        <option key={category.value} value={category.value}>{category.label}</option>
                      ))}
                    </select>
                  </div>
                  {uploadError ? (
                    <p className="field-error" role="alert">{uploadError}</p>
                  ) : null}
                  {uploadNotice ? (
                    <p className={styles.uploadNotice} role="status" aria-live="polite">{uploadNotice}</p>
                  ) : null}
                  <div>
                    <button type="submit" className="button button--primary" disabled={uploadPending}>
                      {uploadPending ? "Uploading…" : "Upload document"}
                    </button>
                  </div>
                </form>
                <hr className="rule" />
              </>
            ) : null}
            <div className="facts-ledger" aria-label="Public register rules">
              <div className="fl-row">
                <span className="k">Who approves</span>
                <span className="v">{canManagePublicRegister ? "This workspace can approve for public view" : "A content publisher approves for public view"}</span>
              </div>
              <div className="fl-row">
                <span className="k">Eligibility</span>
                <span className="v">Only clean, finalized school documents</span>
              </div>
              <div className="fl-row">
                <span className="k">Stays private</span>
                <span className="v">Student, applicant, staff, and import records</span>
              </div>
              <div className="fl-row">
                <span className="k">Audit</span>
                <span className="v">Every visibility change is recorded</span>
              </div>
            </div>
            {canManagePublicRegister ? (
              <p className={styles.registerNote}>
                Approving for public view adds a document to the public downloads register. Only clean, finalized
                documents can be approved; every change is recorded in the audit trail.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function DocumentRow({
  document,
  expanded,
  onToggle,
  downloadBusy,
  delivery,
  onDownload,
  canManagePublicRegister,
  approvalBusy,
  approvalError,
  onVisibility,
}: {
  document: PrivateDocumentMetadata;
  expanded: boolean;
  onToggle: () => void;
  downloadBusy: boolean;
  delivery: { state: DocumentProcessingState; message: string } | undefined;
  onDownload: () => void;
  canManagePublicRegister: boolean;
  approvalBusy: boolean;
  approvalError: string | undefined;
  onVisibility: (document: PrivateDocumentMetadata, visibility: DocumentVisibility) => void;
}) {
  const presentation = statusPresentation(document);
  const isPublic = document.visibility === "public_approved";
  const publicEligible = document.ownerDomain === PUBLIC_REGISTER_OWNER_DOMAIN;
  return (
    <>
      <tr>
        <td>
          <strong className={styles.fileName}>{document.filename}</strong>
          <span className={styles.secondary}>
            {labelFromCode(document.category)} · {document.mimeType} · <span className="num">{formatBytes(document.sizeBytes)}</span> · v{document.version}
          </span>
          {approvalError ? (
            <span className={styles.rowError} role="alert">{approvalError}</span>
          ) : delivery ? (
            <span className={styles.rowNote}>{delivery.message}</span>
          ) : null}
        </td>
        <td>
          {labelFromCode(document.ownerDomain)}
          <span className={`ref ${styles.secondary}`}>{document.ownerReference ?? "Scoped record"}</span>
        </td>
        <td>
          <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
          <span className={styles.secondary}>{processingLine(document)}</span>
        </td>
        <td>
          <span className={styles.secondary}>{shortDate(document.updatedAtIso ?? document.createdAtIso)}</span>
        </td>
        <td>
          <div className={styles.rowActions}>
            {document.processingState === "ready" ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={downloadBusy}
                onClick={onDownload}
              >
                {downloadBusy ? "Authorizing…" : "Download"}
              </button>
            ) : null}
            {canManagePublicRegister ? (
              isPublic ? (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={approvalBusy}
                  onClick={() => onVisibility(document, "private")}
                >
                  {approvalBusy ? "Updating…" : "Withdraw"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  disabled={approvalBusy || document.processingState !== "ready" || !publicEligible}
                  title={publicEligible ? PUBLIC_APPROVAL_ELIGIBLE_TITLE : PUBLIC_APPROVAL_INELIGIBLE_TITLE}
                  onClick={() => onVisibility(document, "public_approved")}
                >
                  {approvalBusy ? "Updating…" : "Approve for public"}
                </button>
              )
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-controls={`document-detail-${document.ref}`}
              aria-label={expanded ? `Hide details for ${document.filename}` : `Show details for ${document.filename}`}
            >
              {expanded ? "Close" : "Details"}
            </button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={5} className={styles.detailCell}>
            <div className={styles.detailPanel} id={`document-detail-${document.ref}`}>
              <dl className="kv">
                <dt>Reference</dt>
                <dd className="num">{document.ref}</dd>
                <dt>Owning record</dt>
                <dd>{labelFromCode(document.ownerDomain)} · <span className="num">{document.ownerReference ?? "Scoped record"}</span></dd>
                <dt>Attachment</dt>
                <dd className="num">{document.attachmentCode ?? "General file"}</dd>
                <dt>Visibility</dt>
                <dd>{isPublic ? "Public downloads register" : "Private"}</dd>
                <dt>Checksum</dt>
                <dd>{document.checksumVerified ? "Verified" : "Not verified"}</dd>
                <dt>Finalization</dt>
                <dd>{document.finalizationState === "verified" ? `Verified ${shortDate(document.finalizedAtIso)}` : document.finalizationState === "failed" ? "Failed" : "Awaiting byte verification"}</dd>
                <dt>Created</dt>
                <dd>{shortDate(document.createdAtIso)}</dd>
                <dt>Updated</dt>
                <dd>{shortDate(document.updatedAtIso)}</dd>
                <dt>Retention until</dt>
                <dd>{shortDate(document.retentionUntilIso)}</dd>
              </dl>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default StaffDocumentsWorkspace;
