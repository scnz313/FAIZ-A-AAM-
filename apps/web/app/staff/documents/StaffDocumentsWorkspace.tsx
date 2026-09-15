"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { useStaffContext } from "@/components/staff/StaffContextProvider";
import Button from "@/components/ui/Button";
import { PrivateDocumentList } from "@/components/ui/PrivateDocumentList";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { documentsService, type DocumentVisibility, type PrivateDocumentMetadata } from "@/modules/services/documents";
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

      <section className={styles.scope} aria-labelledby="document-scope-heading">
        <p className="section-label">Authorized projection</p>
        <h2 id="document-scope-heading" className={styles.scopeTitle}>Database scope is authoritative</h2>
        <p className={styles.scopeNote}>
          The connected service returns records under the active role, assignment, and owning-record policies for {" "}
          <strong>{summary.profileLabel ?? summary.roleLabel}</strong>. Owner labels provide context only; this page does not use broad
          client-side filtering to grant or expand access.
        </p>
        {ownerDomainCount > 1 ? (
          <p className={styles.scopeDetail}>
            This authorized response contains {ownerDomainCount} owner domains. The mixed set is rendered exactly as
            returned by the database projection.
          </p>
        ) : null}
        {summary.role === "auditor" ? (
          <p className={styles.scopeDetail}>
            Auditor access is read-only: there are no processing mutations here, and every file request is
            re-authorized against its owning record.
          </p>
        ) : null}
        {canManagePublicRegister ? (
          <p className={styles.scopeDetail}>
            Approving for public view adds a document to the public downloads register. Only clean, finalized
            documents can be approved; every change is recorded in the audit trail.
          </p>
        ) : null}
      </section>

      {canManagePublicRegister ? (
        <section className="panel" aria-labelledby="document-upload-heading">
          <div className="pn-head">
            <div>
              <p className="section-label">Document publishing</p>
              <h2 id="document-upload-heading">Add a school document</h2>
            </div>
          </div>
          <div className="pn-body">
            <p className={styles.uploadNote}>
              Upload a non-sensitive school document for the public downloads register. The file stays private until
              its security scan is complete, then you can approve it for public view in the register below.
            </p>
            <form className={styles.uploadForm} onSubmit={(event) => void handleUpload(event)}>
              <div className={styles.uploadFields}>
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
              </div>
              {uploadError ? (
                <p className="field-error" role="alert">{uploadError}</p>
              ) : null}
              {uploadNotice ? (
                <p className={styles.uploadNotice} role="status" aria-live="polite">{uploadNotice}</p>
              ) : null}
              <button type="submit" className="button button--primary" disabled={uploadPending}>
                {uploadPending ? "Uploading…" : "Upload document"}
              </button>
            </form>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="document-register-heading">
        <div className={styles.sectionHead}>
          <div>
            <p className="section-label">Processing register</p>
            <h2 id="document-register-heading" className={styles.sectionTitle}>Authorized files</h2>
          </div>
          {documents !== null && documentsTotal > 0 ? (
            <p className={styles.resultCount} aria-live="polite">
              <span className="num">{documentsTotal}</span> {documentsTotal === 1 ? "record" : "records"}
            </p>
          ) : null}
        </div>

        {loadError ? (
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
        ) : documents === null ? (
          <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">Loading authorized documents…</span>
            <span className="skeleton-rule" aria-hidden="true" />
            <span className="skeleton-bar" style={{ width: "68%" }} aria-hidden="true" />
            <span className="skeleton-bar" style={{ width: "82%" }} aria-hidden="true" />
            <span className="skeleton-bar" style={{ width: "54%" }} aria-hidden="true" />
          </div>
        ) : (
          <PrivateDocumentList
            documents={documents}
            totalRecords={documentsTotal}
            emptyTitle="No authorized documents"
            emptyNote={
              demoMode
                ? "The demo adapter intentionally exposes no private staff files. Database-authorized records appear here in a connected staff session."
                : "No document metadata is currently available within this workspace's database-authorized scope."
            }
            showOwner
            showProcessing
            publicApproval={
              canManagePublicRegister
                ? {
                    pending: visibilityPending,
                    errors: visibilityErrors,
                    onChange: setPublicVisibility,
                  }
                : undefined
            }
          />
        )}
        {documents !== null && nextOffset !== null ? (
          <div className={styles.sectionHead} style={{ marginTop: 12 }}>
            <div>
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
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default StaffDocumentsWorkspace;
