"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState, ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import {
  dataExportService,
  type ExportCatalog,
  type ExportDomain,
  type ExportRequestRow,
} from "@/modules/services/data-export";

import styles from "./page.module.css";

type PendingAction =
  | { kind: "retry"; reference: string }
  | { kind: "cancel"; reference: string }
  | { kind: "recover"; reference: string; requestId: string }
  | null;

/**
 * Protected data exports (Administrator): purpose-bound, column-allowlisted,
 * formula-safe, private, expiring, and audited. The approved catalog drives
 * field selection; artifacts are private generated documents with short
 * signed delivery — never raw dumps. Demo mode states plainly that protected
 * exports require the live database instead of fabricating a file.
 */
export default function DataExportsWorkspace() {
  const { summary } = useStaffContext();
  const canManage = canAnyRole(summary?.roles ?? [], "users.manage");
  const supabaseMode = clientAdapterMode() === "supabase";
  const [catalogs, setCatalogs] = useState<ExportCatalog[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [rows, setRows] = useState<ExportRequestRow[] | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const pagesLoadedRef = useRef(1);
  const [domain, setDomain] = useState<ExportDomain>("students");
  const [selectedColumns, setSelectedColumns] = useState<string[] | null>(null);
  const [format] = useState<"csv">("csv");
  const [purpose, setPurpose] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ purpose?: string; reason?: string; columns?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failedRef, setFailedRef] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionReason, setActionReason] = useState("");

  const selectedCatalog = useMemo(
    () => catalogs?.find((catalog) => catalog.domain === domain) ?? null,
    [catalogs, domain],
  );

  const loadCatalogs = useCallback(async (): Promise<void> => {
    if (!supabaseMode) {
      setCatalogs([]);
      setCatalogError(null);
      return;
    }
    try {
      const loaded = await dataExportService.listCatalogs();
      setCatalogs(loaded);
      setCatalogError(null);
      setDomain((current) => loaded.some((catalog) => catalog.domain === current)
        ? current
        : (loaded[0]?.domain ?? current));
      setSelectedColumns(null);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "The export catalog could not be loaded.");
    }
  }, [supabaseMode]);

  /* The registry is keyset-paginated so a long audit history never ships as
     one unbounded payload. A refresh re-reads exactly the pages the operator
     has already opened, so a poll cannot drop already-loaded rows. */
  const loadRows = useCallback(async (): Promise<void> => {
    if (!supabaseMode) {
      setRows([]);
      setRowsError(null);
      setNextCursor(null);
      return;
    }
    try {
      const first = await dataExportService.listRequestsPage(null);
      let merged = first.rows;
      let cursor = first.nextCursor;
      for (let page = 1; page < pagesLoadedRef.current && cursor !== null; page += 1) {
        const next = await dataExportService.listRequestsPage(cursor);
        merged = [...merged, ...next.rows];
        cursor = next.nextCursor;
      }
      setRows(merged);
      setNextCursor(cursor);
      setRowsError(null);
    } catch (error) {
      setRowsError(error instanceof Error ? error.message : "Export requests could not be loaded.");
    }
  }, [supabaseMode]);

  async function loadMoreRows(): Promise<void> {
    if (nextCursor === null) return;
    setLoadingMore(true);
    try {
      const next = await dataExportService.listRequestsPage(nextCursor);
      setRows((current) => [...(current ?? []), ...next.rows]);
      setNextCursor(next.nextCursor);
      pagesLoadedRef.current += 1;
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "More export requests could not be loaded." });
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void loadCatalogs();
  }, [loadCatalogs]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!supabaseMode || rows === null) return;
    if (!rows.some((row) => row.state === "requested" || row.state === "generating")) return;
    const timer = window.setInterval(() => { void loadRows(); }, 5000);
    return () => window.clearInterval(timer);
  }, [supabaseMode, rows, loadRows]);

  function chooseDomain(nextDomain: ExportDomain) {
    setDomain(nextDomain);
    /* null means "every approved column is selected" for that catalog. */
    setSelectedColumns(null);
    setErrors({});
  }

  function toggleColumn(column: string, checked: boolean) {
    setSelectedColumns((current) => {
      const base = current ?? selectedCatalog?.availableColumns.map((entry) => entry.column) ?? [];
      return checked ? [...base.filter((value) => value !== column), column] : base.filter((value) => value !== column);
    });
  }

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabaseMode) return;
    setFailedRef(null);
    const columns = selectedColumns ?? selectedCatalog?.availableColumns.map((column) => column.column) ?? [];
    const next: { purpose?: string; reason?: string; columns?: string } = {
      purpose: purpose.trim().length >= 3 ? undefined : "A stated purpose is required.",
      reason: reason.trim().length >= 3 ? undefined : "A recorded reason is required.",
      columns: columns.length === 0 ? "Select at least one column from the approved catalog." : undefined,
    };
    setErrors(next);
    if (Object.values(next).some((value) => value !== undefined)) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await dataExportService.request({
        domain,
        filters: {},
        columns,
        format,
        purpose: purpose.trim(),
        reason: reason.trim(),
      });
      setNotice(`Export ${result.reference} requested · the artifact is generated privately and expires in 24 hours.`);
      setPurpose("");
      setReason("");
      await loadRows();
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "The export request failed." });
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(reference: string) {
    setBusy(true);
    setFailedRef(null);
    setErrors({});
    try {
      const signedUrl = await dataExportService.signedDownloadUrl(reference);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setFailedRef(reference);
      setErrors({ form: error instanceof Error ? error.message : "The download failed." });
    } finally {
      setBusy(false);
    }
  }

  async function handlePendingAction() {
    if (pendingAction === null) return;
    if (actionReason.trim().length < 3) {
      setErrors({ form: "A reason of at least three characters is recorded in the audit trail." });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      if (pendingAction.kind === "retry") {
        await dataExportService.retry(pendingAction.reference, actionReason.trim());
        setNotice(`Retry requested for ${pendingAction.reference}. Generation will start again shortly.`);
      } else if (pendingAction.kind === "recover") {
        await dataExportService.recover(pendingAction.requestId, actionReason.trim());
        setNotice(`Recovery released ${pendingAction.reference} back to the queue · the reason is recorded in the audit trail.`);
      } else {
        await dataExportService.cancel(pendingAction.reference, actionReason.trim());
        setNotice(`Export ${pendingAction.reference} cancelled.`);
      }
      setPendingAction(null);
      setActionReason("");
      await loadRows();
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "The action failed." });
    } finally {
      setBusy(false);
    }
  }

  if (!supabaseMode) {
    return (
      <div className={styles.page}>
        <div className="page-head">
          <div>
            <h1>Data exports</h1>
            <p className="ph-sub">
              Purpose-bound, filtered exports with formula-safe output, private storage, short expiry, and full audit.
            </p>
          </div>
          <span className="demo-badge">Demo data</span>
        </div>
        <EmptyState
          title="Protected exports require the live school database"
          note="Demo mode does not generate or download files. Sign in with an Administrator account against the school database to request a protected export."
        />
        <p className={styles.note}>
          Exports are column-allowlisted and formula-neutralized; internal identifiers, auth fields, invitation tokens,
          and medical/support detail are omitted by default. Artifacts are private documents with short signed delivery.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1>Data exports</h1>
          <p className="ph-sub">
            Purpose-bound, filtered exports with formula-safe output, private storage, short expiry, and full audit.
          </p>
        </div>
      </div>

      {notice ? <p className={styles.liveNote} role="status" aria-live="polite">{notice}</p> : null}

      {catalogError !== null ? (
        <ErrorPanel title="The export catalog could not be loaded" note={catalogError}>
          <Button variant="quiet" onClick={() => { setCatalogs(null); setCatalogError(null); void loadCatalogs(); }}>
            Try again
          </Button>
        </ErrorPanel>
      ) : catalogs === null ? (
        <LoadingSkeleton lines={3} label="Loading the export catalog…" />
      ) : (
        <form className={styles.panel} onSubmit={handleRequest} noValidate>
          <div className="field">
            <label htmlFor="export-domain">Domain</label>
            <select id="export-domain" className="select" value={domain}
              onChange={(event) => chooseDomain(event.target.value as ExportDomain)}>
              {catalogs.map((catalog) => (
                <option key={catalog.domain} value={catalog.domain}>{catalog.displayName}</option>
              ))}
            </select>
            {selectedCatalog?.description ? <p className="field-help">{selectedCatalog.description}</p> : null}
          </div>

          <fieldset className={styles.columns}>
            <legend className="section-label">Columns ({selectedColumns?.length ?? selectedCatalog?.availableColumns.length ?? 0} of {selectedCatalog?.availableColumns.length ?? 0} selected)</legend>
            {selectedCatalog === null || selectedCatalog.availableColumns.length === 0 ? (
              <p className={styles.errorNote}>This domain has no approved columns; request an export cannot be made.</p>
            ) : (
              <div className={styles.columnGrid}>
                {selectedCatalog.availableColumns.map((column) => (
                  <label key={column.column} className={styles.columnItem}>
                    <input
                      type="checkbox"
                      checked={selectedColumns === null || selectedColumns.includes(column.column)}
                      onChange={(event) => toggleColumn(column.column, event.target.checked)}
                    />
                    {" "}{column.label}
                  </label>
                ))}
              </div>
            )}
            <p className="field-help">
              Only approved catalog columns can be exported; the server re-checks the allowlist. Internal identifiers,
              auth fields, invitation tokens, and medical/support detail are not exportable.
            </p>
            {errors.columns ? <p className="field-error" role="alert">{errors.columns}</p> : null}
          </fieldset>

          <div className="field">
            <label htmlFor="export-format">Format</label>
            <select id="export-format" className="select" value={format} disabled aria-describedby="export-format-help">
              <option value="csv">CSV (formula-safe)</option>
              <option value="xlsx" disabled>XLSX · unavailable (CSV-only in this release)</option>
            </select>
            <p className="field-help" id="export-format-help">CSV-only in this release · XLSX stays disabled.</p>
          </div>

          <div className="field">
            <label htmlFor="export-purpose">Purpose (stated and audited)</label>
            <input id="export-purpose" className="input" type="text" value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              aria-invalid={errors.purpose !== undefined}
              aria-describedby={errors.purpose ? "export-purpose-error" : undefined} />
            {errors.purpose ? <p className="field-error" id="export-purpose-error">{errors.purpose}</p> : null}
          </div>
          <div className="field">
            <label htmlFor="export-reason">Reason (recorded in audit trail)</label>
            <input id="export-reason" className="input" type="text" value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={errors.reason !== undefined}
              aria-describedby={errors.reason ? "export-reason-error" : undefined} />
            {errors.reason ? <p className="field-error" id="export-reason-error">{errors.reason}</p> : null}
          </div>
          {errors.form ? (
            <div className={styles.errorWrap} role="alert">
              <p className={styles.errorNote}>{errors.form}</p>
              {failedRef ? (
                <Button variant="quiet" onClick={() => void handleDownload(failedRef)} disabled={busy}>
                  {busy ? "Retrying…" : `Retry download ${failedRef}`}
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className={styles.actions}>
            <Button variant="primary" type="submit" disabled={busy || !canManage}>
              {busy ? "Requesting…" : "Request export"}
            </Button>
          </div>
        </form>
      )}

      <section aria-labelledby="exports-heading">
        <h2 id="exports-heading" className="section-label">Export requests</h2>
        {rowsError !== null ? (
          <ErrorPanel title="Export requests could not be loaded" note={rowsError}>
            <Button variant="quiet" onClick={() => { setRows(null); setRowsError(null); void loadRows(); }}>
              Try again
            </Button>
          </ErrorPanel>
        ) : rows === null ? (
          <LoadingSkeleton lines={3} label="Loading export requests…" />
        ) : rows.length === 0 ? (
          <EmptyState title="No export requests" note="Request a filtered export above; artifacts expire after 24 hours." />
        ) : (
          <div className="table--scroll">
            <table className={`table ${styles.table}`}>
              <caption className="sr-only">Export requests with state and expiry</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Domain</th>
                  <th scope="col">State</th>
                  <th scope="col" className="num">Rows</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.requestId}>
                    <td className="num">{row.reference}</td>
                    <td>{row.domain.replace(/_/g, " ")}</td>
                    <td>
                      <StatusBadge tone={row.state === "ready" ? "good" : row.state === "failed" || row.state === "expired" ? "alert" : "watch"}>
                        {row.state}
                      </StatusBadge>
                      {row.lastEventType === "failed" && row.lastEventDetail !== null ? (
                        <span className={styles.failureReason}>
                          {row.lastEventDetail}
                          {row.failedAt !== null
                            ? ` · ${new Date(row.failedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
                            : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="num">{row.rowCount ?? "—"}</td>
                    <td>{row.expiresAt !== null ? new Date(row.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</td>
                    <td className={styles.rowActions}>
                      {row.state === "ready" ? (
                        <Button variant="quiet" onClick={() => void handleDownload(row.reference)} disabled={busy}>Download</Button>
                      ) : null}
                      {row.state === "failed" ? (
                        <Button variant="quiet" onClick={() => { setPendingAction({ kind: "retry", reference: row.reference }); setActionReason(""); setErrors({}); }}>
                          Retry generation
                        </Button>
                      ) : null}
                      {row.state === "generating" && row.lastEventType === "failed" ? (
                        <Button variant="quiet" onClick={() => { setPendingAction({ kind: "recover", reference: row.reference, requestId: row.requestId }); setActionReason(""); setErrors({}); }}>
                          Recover generation
                        </Button>
                      ) : null}
                      {row.state === "requested" || row.state === "generating" ? (
                        <Button variant="quiet" onClick={() => { setPendingAction({ kind: "cancel", reference: row.reference }); setActionReason(""); setErrors({}); }}>
                          Cancel
                        </Button>
                      ) : null}
                      {row.state === "expired" ? (
                        <span className={styles.note}>Expired · request a new export</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor !== null ? (
          <div className={styles.actions}>
            <Button variant="quiet" onClick={() => void loadMoreRows()} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load older requests"}
            </Button>
          </div>
        ) : null}
      </section>

      {pendingAction !== null ? (
        <section className={styles.panel} aria-labelledby="export-action-heading">
          <h2 id="export-action-heading" className="section-label">
            {pendingAction.kind === "retry"
              ? "Retry export generation"
              : pendingAction.kind === "recover"
                ? "Recover export generation"
                : "Cancel export"} · {pendingAction.reference}
          </h2>
          <p className={styles.note}>
            {pendingAction.kind === "retry"
              ? "Generation restarts under a new provider-job key; the failed attempt stays in the audit trail."
              : pendingAction.kind === "recover"
                ? "Recovery releases a stale generation claim back to the queue. It is only allowed when a failed queue record exists and the worker lease has expired; the reason is recorded in the audit trail."
                : "Cancelling stops generation; the request and its audit trail remain visible."}
          </p>
          <div className="field">
            <label htmlFor="export-action-reason">Reason (required, recorded in the audit trail)</label>
            <input id="export-action-reason" className="input" type="text" value={actionReason}
              onChange={(event) => setActionReason(event.target.value)} />
          </div>
          <div className={styles.actions}>
            <Button variant={pendingAction.kind === "cancel" ? "danger" : "primary"}
              onClick={() => void handlePendingAction()}
              disabled={busy || actionReason.trim().length < 3}>
              {busy
                ? "Working…"
                : pendingAction.kind === "retry"
                  ? "Confirm retry"
                  : pendingAction.kind === "recover"
                    ? "Confirm recovery"
                    : "Confirm cancellation"}
            </Button>
            <Button variant="quiet" onClick={() => setPendingAction(null)} disabled={busy}>Keep request</Button>
          </div>
        </section>
      ) : null}

      <p className={styles.note}>
        Exports are column-allowlisted and formula-neutralized; internal identifiers, auth fields, invitation tokens,
        and medical/support detail are omitted by default. Artifacts are private documents with short signed delivery.
      </p>
    </div>
  );
}
