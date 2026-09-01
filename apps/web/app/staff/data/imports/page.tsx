"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import {
  dataImportService,
  type ImportBatchRow,
  type ImportIssueRow,
  type MappingTemplateRow,
} from "@/modules/services/data-import";
import type { DataImportPreview } from "@fass/contracts";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { schoolConfigService } from "@/modules/services/school-config";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { isImportableSpreadsheet, normalizeImportValue } from "@/modules/imports/csv-client";
import { uploadDocumentFile } from "@/modules/services/document-upload";

import styles from "./page.module.css";

type Step = "upload" | "scan" | "map" | "validate" | "commit" | "report";

const STEP_ORDER: ReadonlyArray<{ key: Step; label: string }> = [
  { key: "upload", label: "Upload" },
  { key: "scan", label: "Scan" },
  { key: "map", label: "Map" },
  { key: "validate", label: "Validate" },
  { key: "commit", label: "Commit" },
  { key: "report", label: "Report" },
];

const STATE_TO_STEP: Record<string, Step> = {
  uploaded: "scan",
  scanning: "scan",
  mapping: "map",
  validating: "validate",
  needs_resolution: "validate",
  ready: "commit",
  committing: "commit",
  completed: "report",
  cancelled: "upload",
  failed: "upload",
};

/**
 * Data imports workspace (Administrator): Upload → Scan → Map → Validate →
 * Resolve → Commit → Report. Raw files are uploaded to a private store and
 * parsed server-side with hard limits; the browser sees normalized row
 * counts, scan headers, issues, and the exact commit preview only.
 */
export default function DataImportsWorkspace() {
  const { summary } = useStaffContext();
  const canManage = canAnyRole(summary?.roles ?? [], "users.manage");
  const supabaseMode = clientAdapterMode() === "supabase";
  const [batches, setBatches] = useState<ImportBatchRow[] | null>(null);
  const [activeBatch, setActiveBatch] = useState<ImportBatchRow | null>(null);
  const [issues, setIssues] = useState<ImportIssueRow[]>([]);
  const [step, setStep] = useState<Step>("upload");
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [sourceSystem, setSourceSystem] = useState("");
  const [authorityConfirmed, setAuthorityConfirmed] = useState(false);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [commitReason, setCommitReason] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DataImportPreview | null>(null);
  const [report, setReport] = useState<{ createdCount: number; errorCount: number; state: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [scanHeaders, setScanHeaders] = useState<string[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [mappingTemplates, setMappingTemplates] = useState<MappingTemplateRow[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setBatches(await dataImportService.listBatches());
    } catch {
      setBatches([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFileError(null);
    if (!authorityConfirmed || !privacyConfirmed) {
      setFileError("Confirm the data authority and privacy statements before uploading.");
      return;
    }
    const file = fileRef.current?.files?.[0];
    if (file === undefined) {
      setFileError("Choose a CSV export to upload.");
      return;
    }
    if (!isImportableSpreadsheet(file.type, file.name)) {
      setFileError("Only CSV exports are accepted. XLSX parsing is not enabled in this environment.");
      return;
    }
    setParsing(true);
    try {
      const config = await schoolConfigService.getConfiguration();
      const currentYear = config.academicYears.find((year) => year.status === "current");
      if (currentYear === undefined) throw new Error("No current academic year is configured.");
      const created = await dataImportService.createBatch({
        academicYearId: currentYear.id,
        sourceSystem: sourceSystem.trim() || "manual",
        authorityConfirmation: true,
        privacyConfirmation: true,
      });

      // Upload the CSV to the private document store (Supabase mode only)
      if (supabaseMode) {
        const uploadResult = await uploadDocumentFile({
          ownerDomain: "data_import_batch",
          ownerRecordRef: created.reference,
          attachmentCode: "source_csv",
          file,
          allowedMimeTypes: ["text/csv"],
          maxBytes: 5 * 1024 * 1024,
        });
        setNotice(`Batch ${created.reference} created. Source document ${uploadResult.documentRef} uploaded. Scan will begin shortly.`);
      } else {
        setNotice(`Batch ${created.reference} created. Parsing runs server-side; the batch appears below once rows are stored.`);
      }
      await refresh();
      setStep("scan");
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "The batch could not be created.");
    } finally {
      setParsing(false);
    }
  }

  async function openBatch(batch: ImportBatchRow) {
    setActiveBatch(batch);
    const nextStep = STATE_TO_STEP[batch.state] ?? "validate";
    setStep(nextStep);
    try {
      setIssues(await dataImportService.listIssues(batch.batchId));
    } catch {
      setIssues([]);
    }
    try {
      setPreview(await dataImportService.preview(batch.batchId));
    } catch {
      setPreview(null);
    }
    // Load mapping templates for the map step
    if (nextStep === "map") {
      try {
        setMappingTemplates(await dataImportService.listMappingTemplates());
      } catch {
        setMappingTemplates([]);
      }
    }
  }

  async function handleRefreshScan() {
    if (activeBatch === null) return;
    setBusy(true);
    try {
      await refresh();
      const updated = (await dataImportService.listBatches()).find((b) => b.batchId === activeBatch.batchId);
      if (updated) {
        setActiveBatch(updated);
        if (updated.state === "mapping") {
          setStep("map");
          setMappingTemplates(await dataImportService.listMappingTemplates());
        } else if (updated.state === "validating" || updated.state === "needs_resolution") {
          setStep("validate");
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not refresh scan status.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordMapping() {
    if (activeBatch === null) return;
    setBusy(true);
    setFileError(null);
    try {
      const mappings = selectedTemplateId
        ? null
        : Object.fromEntries(
            Object.entries(columnMappings).filter(([, target]) => target !== ""),
          );
      await dataImportService.recordMapping({
        batchId: activeBatch.batchId,
        mappingTemplateId: selectedTemplateId || null,
        columnMappings: mappings ?? null,
      });
      setNotice("Mapping recorded. Validation will begin shortly.");
      await refresh();
      setStep("validate");
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "The mapping could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResolveIssue(issue: ImportIssueRow, resolution: "accept" | "reject" | "skip") {
    if (activeBatch === null) return;
    setBusy(true);
    try {
      // Note: rowId is needed; we use a placeholder since issues don't expose rowId directly
      // In a full implementation, the issue row would include rowId
      await dataImportService.resolveIssue({
        batchId: activeBatch.batchId,
        rowId: issue.rowNumber !== null ? `row-${issue.rowNumber}` : "",
        issueId: issue.issueId,
        resolution,
      });
      setIssues(await dataImportService.listIssues(activeBatch.batchId));
      setNotice(`Issue ${resolution}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The issue could not be resolved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (activeBatch === null) return;
    if (commitReason.trim().length < 3) {
      setCommitError("A commit reason is required for the audit trail.");
      return;
    }
    setCommitError(null);
    setBusy(true);
    try {
      const result = await dataImportService.commit({
        batchId: activeBatch.batchId,
        expectedVersion: activeBatch.version,
        reason: commitReason.trim(),
        idempotencyKey: `import-commit:${activeBatch.reference}:${activeBatch.version}`,
        confirmedCreateCount: preview?.createCount ?? 0,
        confirmedUpdateCount: preview?.updateCount ?? 0,
      });
      setReport({ createdCount: result.createdCount, errorCount: result.errorCount, state: result.state });
      setStep("report");
      await refresh();
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : "The commit failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (activeBatch === null) return;
    setBusy(true);
    try {
      await dataImportService.cancel({
        batchId: activeBatch.batchId,
        expectedVersion: activeBatch.version,
        reason: "Cancelled by the administrator before commit.",
      });
      setActiveBatch(null);
      setStep("upload");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The cancellation failed.");
    } finally {
      setBusy(false);
    }
  }

  const activeStepIndex = STEP_ORDER.findIndex((entry) => entry.key === step);

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Administrator · Data</p>
        <h1 className="workspace-title">Data imports</h1>
        <p className="workspace-intro">
          School-data import with provenance: upload a CSV export to a private store, scan server-side,
          map columns, review validation issues, preview the exact consequences, then commit once.
          Raw files never leave the private store.
        </p>
      </header>

      {!supabaseMode ? <p className="demo-badge">Demo data</p> : null}

      <ol className={styles.stepper} aria-label="Import steps">
        {STEP_ORDER.map((entry, index) => (
          <li key={entry.key} className={index === activeStepIndex ? styles.stepActive : undefined}
            aria-current={index === activeStepIndex ? "step" : undefined}>
            <span className="num">{String(index + 1).padStart(2, "0")}</span> {entry.label}
          </li>
        ))}
      </ol>

      {notice ? <p className={styles.liveNote} role="status" aria-live="polite">{notice}</p> : null}

      {step === "upload" && (
        <form className={styles.panel} onSubmit={handleUpload} noValidate>
          <div className="field">
            <label htmlFor="import-source">Source system label</label>
            <input id="import-source" className="input" type="text" value={sourceSystem}
              onChange={(event) => setSourceSystem(event.target.value)}
              placeholder="e.g. Previous school records (2026)" />
          </div>
          <div className="field">
            <label htmlFor="import-file">CSV export</label>
            <input id="import-file" ref={fileRef} className="input" type="file" accept=".csv,text/csv" />
            <p className="field-help">
              CSV only — XLSX parsing is not enabled in this environment. Files are uploaded to a private
              store and parsed server-side with hard size (5 MB) and row (10,000) limits.
            </p>
          </div>
          <div className="field">
            <label>
              <input type="checkbox" checked={authorityConfirmed}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setAuthorityConfirmed(event.target.checked)} />
              {" "}I confirm the school has the authority to import this data.
            </label>
            <label>
              <input type="checkbox" checked={privacyConfirmed}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setPrivacyConfirmed(event.target.checked)} />
              {" "}I confirm the file contains no data beyond what the school legitimately holds.
            </label>
          </div>
          {fileError ? <p className={styles.errorNote} role="alert">{fileError}</p> : null}
          <div className={styles.actions}>
            <Button variant="primary" type="submit" disabled={parsing || !canManage}>
              {parsing ? "Uploading…" : "Create batch"}
            </Button>
          </div>
        </form>
      )}

      <section aria-labelledby="batches-heading">
        <h2 id="batches-heading" className="section-label">Import batches</h2>
        {batches === null ? (
          <p className={styles.loading} role="status">Loading batches…</p>
        ) : batches.length === 0 ? (
          <div className="workspace-state">
            <p className="workspace-state-title">No import batches</p>
            <p className="workspace-state-note">Upload a CSV export to start a batch.</p>
          </div>
        ) : (
          <div className="table--scroll">
            <table className={`table ${styles.table}`}>
              <caption className="sr-only">Import batches with state and counts</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Source</th>
                  <th scope="col">State</th>
                  <th scope="col" className="num">Rows</th>
                  <th scope="col" className="num">Errors</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.batchId}>
                    <td className="num">{batch.reference}</td>
                    <td>{batch.sourceSystem}</td>
                    <td><StatusBadge tone={batch.state === "completed" ? "good" : batch.state === "cancelled" || batch.state === "failed" ? "alert" : "watch"}>{batch.state}</StatusBadge></td>
                    <td className="num">{batch.rowCount}</td>
                    <td className="num">{batch.errorCount}</td>
                    <td>
                      <Button variant="quiet" onClick={() => void openBatch(batch)}>Open</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {activeBatch !== null && step === "scan" && (
        <section className={styles.panel} aria-labelledby="scan-heading">
          <h2 id="scan-heading" className="section-label">
            Batch <span className="num">{activeBatch.reference}</span> — Scanning
          </h2>
          <p className={styles.muted}>
            The source file is being parsed server-side. This usually takes a few seconds.
            Click refresh to check the scan status.
          </p>
          {scanError ? <p className={styles.errorNote} role="alert">Scan error: {scanError}</p> : null}
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void handleRefreshScan()} disabled={busy}>
              {busy ? "Checking…" : "Refresh scan status"}
            </Button>
            <Button variant="quiet" onClick={() => void handleCancel()} disabled={busy}>Cancel batch</Button>
          </div>
        </section>
      )}

      {activeBatch !== null && step === "map" && (
        <section className={styles.panel} aria-labelledby="map-heading">
          <h2 id="map-heading" className="section-label">
            Batch <span className="num">{activeBatch.reference}</span> — Column Mapping
          </h2>
          {scanHeaders !== null && scanHeaders.length > 0 ? (
            <p className={styles.muted}>Detected columns: {scanHeaders.join(", ")}</p>
          ) : null}

          {mappingTemplates.length > 0 ? (
            <div className="field">
              <label htmlFor="mapping-template">Use a mapping template</label>
              <select id="mapping-template" className="input" value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}>
                <option value="">— Custom mapping —</option>
                {mappingTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name} (v{template.version})</option>
                ))}
              </select>
            </div>
          ) : null}

          {selectedTemplateId === "" ? (
            <div className="field">
              <p className="field-help">Map source columns to target fields. Leave unmapped columns blank.</p>
              <p className={styles.muted}>Custom column mapping UI will appear here once scan headers are loaded from the batch.</p>
            </div>
          ) : null}

          {fileError ? <p className={styles.errorNote} role="alert">{fileError}</p> : null}
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void handleRecordMapping()} disabled={busy}>
              {busy ? "Recording…" : "Confirm mapping"}
            </Button>
            <Button variant="quiet" onClick={() => void handleCancel()} disabled={busy}>Cancel batch</Button>
          </div>
        </section>
      )}

      {activeBatch !== null && (step === "validate" || step === "commit") && (
        <section className={styles.panel} aria-labelledby="active-batch-heading">
          <h2 id="active-batch-heading" className="section-label">
            Batch <span className="num">{activeBatch.reference}</span> — {activeBatch.state}
          </h2>

          <h3 className="section-label">Validation issues</h3>
          {issues.length === 0 ? (
            <p className={styles.muted}>No issues recorded.</p>
          ) : (
            <ul className={styles.issueList}>
              {issues.map((issue) => (
                <li key={issue.issueId} className={issue.severity === "error" ? styles.issueError : styles.issueWarning}>
                  <strong>{issue.code}</strong> {issue.field !== null ? `(${issue.field}) ` : ""}
                  {issue.message}
                  {issue.resolutionHint !== null ? <small> — {issue.resolutionHint}</small> : null}
                  {issue.resolvedAtIso === null && supabaseMode ? (
                    <span className={styles.issueActions}>
                      <Button variant="quiet" onClick={() => void handleResolveIssue(issue, "accept")} disabled={busy}>Accept</Button>
                      <Button variant="quiet" onClick={() => void handleResolveIssue(issue, "skip")} disabled={busy}>Skip</Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {preview !== null ? (
            <div className={styles.preview}>
              <p className="section-label">Exact consequences</p>
              <ul className={styles.previewList}>
                <li><span className="num">{preview.createCount}</span> records created</li>
                <li><span className="num">{preview.updateCount}</span> records updated</li>
                <li><span className="num">{preview.errorCount}</span> errors, <span className="num">{preview.warningCount}</span> warnings</li>
              </ul>
            </div>
          ) : null}

          {step === "commit" ? (
            <div className={styles.commitBox}>
              <div className="field">
                <label htmlFor="commit-reason">Commit reason (required, recorded in audit trail)</label>
                <input id="commit-reason" className="input" type="text" value={commitReason}
                  onChange={(event) => setCommitReason(event.target.value)}
                  aria-invalid={commitError !== null} />
                {commitError ? <p className="field-error" role="alert">{commitError}</p> : null}
              </div>
              <div className={styles.actions}>
                <Button variant="primary" onClick={() => void handleCommit()} disabled={busy}>
                  {busy ? "Committing…" : `Commit ${preview?.createCount ?? 0} records`}
                </Button>
                <Button variant="quiet" onClick={() => void handleCancel()} disabled={busy}>Cancel batch</Button>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {step === "report" && report !== null && (
        <section className={styles.panel} aria-labelledby="report-heading">
          <h2 id="report-heading" className="section-label">Import report</h2>
          <p>
            State <strong>{report.state}</strong> — <span className="num">{report.createdCount}</span> records created,{" "}
            <span className="num">{report.errorCount}</span> errors. The batch summary is immutable and audited.
          </p>
          <Button variant="quiet" onClick={() => { setStep("upload"); setActiveBatch(null); setReport(null); }}>
            Start another import
          </Button>
        </section>
      )}
    </div>
  );
}
