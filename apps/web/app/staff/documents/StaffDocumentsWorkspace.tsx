"use client";

import { useEffect, useState } from "react";

import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { PrivateDocumentList } from "@/components/ui/PrivateDocumentList";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { documentsService, type PrivateDocumentMetadata } from "@/modules/services/documents";
import { workspacesForAction } from "@/modules/services/staff-authorization";
import { roleLabel } from "@/modules/services/staff-context";
import { canAnyRole } from "@/modules/services/staff-profiles";

import styles from "./page.module.css";

const DOCUMENT_ACTION = "documents.view" as const;

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const allowed = summary !== null && canAnyRole(summary.roles, DOCUMENT_ACTION);
  const activeRoleGrantId = summary?.activeRoleGrantId ?? null;

  useEffect(() => {
    if (status !== "ready" || !allowed || activeRoleGrantId === null) {
      setDocuments(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setDocuments(null);
    setLoadError(null);
    void documentsService
      .listForStaff()
      .then((records) => {
        if (!cancelled) setDocuments(records);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Documents could not be loaded.");
      });

    return () => {
      cancelled = true;
    };
  }, [activeRoleGrantId, allowed, reloadKey, status]);

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

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Documents</p>
        <h1 className="workspace-title">Private documents</h1>
        <p className="workspace-intro">
          Read-only processing oversight for files the active staff workspace is authorized to inspect.
        </p>
      </header>

      <section className={styles.scope} aria-labelledby="document-scope-heading">
        <p className="section-label">Authorized projection</p>
        <h2 id="document-scope-heading" className={styles.scopeTitle}>Database scope is authoritative</h2>
        <p className={styles.scopeNote}>
          The connected service returns records under the active role, assignment, and owning-record policies for {" "}
          <strong>{summary.roleLabel}</strong>. Owner labels provide context only; this page does not use broad
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
      </section>

      <section aria-labelledby="document-register-heading">
        <div className={styles.sectionHead}>
          <div>
            <p className="section-label">Processing register</p>
            <h2 id="document-register-heading" className={styles.sectionTitle}>Authorized files</h2>
          </div>
          {documents !== null && documents.length > 0 ? (
            <p className={styles.resultCount} aria-live="polite">
              <span className="num">{documents.length}</span> {documents.length === 1 ? "record" : "records"}
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
            emptyTitle="No authorized documents"
            emptyNote={
              demoMode
                ? "The demo adapter intentionally exposes no private staff files. Database-authorized records appear here in a connected staff session."
                : "No document metadata is currently available within this workspace's database-authorized scope."
            }
            showOwner
            showProcessing
          />
        )}
      </section>
    </div>
  );
}

export default StaffDocumentsWorkspace;
