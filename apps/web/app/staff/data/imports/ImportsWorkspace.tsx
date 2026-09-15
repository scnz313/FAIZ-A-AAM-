"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState, ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import type { DataImportPreview, DataImportReport } from "@fass/contracts";
import {
  dataImportService,
  type ImportBatchDetail,
  type ImportBatchRow,
  type ImportIssueRow,
  type ImportRowOutcome,
  type ImportScanStatus,
  type MappingTemplateRow,
} from "@/modules/services/data-import";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { schoolConfigService } from "@/modules/services/school-config";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { CSV_MAX_BYTES, isImportableSpreadsheet } from "@/modules/imports/csv-client";
import {
  CANONICAL_TARGET_FIELDS,
  mappingIssues,
  suggestColumnMapping,
} from "@/modules/imports/source-rows";
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
  partially_committed: "report",
  cancelled: "upload",
  failed: "scan",
};

/**
 * Data imports workspace (Administrator): Upload → Scan → Map → Validate →
 * Resolve → Commit → Report. In Supabase mode the raw file is uploaded to a
 * private store and parsed server-side with hard limits; the browser only
 * receives normalized counts, scan headers, issues, and the exact commit
 * preview. In demo mode the selected CSV is parsed locally with the same
 * bounded parser — nothing is uploaded and no remote step is simulated.
 */
export function DataImportsWorkspace({
  scannerConfigured,
  scannerProvider = null,
}: {
  scannerConfigured: boolean;
  scannerProvider?: "manual" | "http" | "clamav" | null;
}) {
  const { summary } = useStaffContext();
  const canManage = canAnyRole(summary?.roles ?? [], "users.manage");
  const supabaseMode = clientAdapterMode() === "supabase";
  const [batches, setBatches] = useState<ImportBatchRow[] | null>(null);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [batchesTotal, setBatchesTotal] = useState<number | null>(null);
  const [batchesNextOffset, setBatchesNextOffset] = useState<number | null>(null);
  const [batchesLoadingMore, setBatchesLoadingMore] = useState(false);
  const [activeBatch, setActiveBatch] = useState<ImportBatchDetail | null>(null);
  const [scanState, setScanState] = useState<ImportScanStatus | null>(null);
  const [issues, setIssues] = useState<ImportIssueRow[] | null>(null);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [issuesTotal, setIssuesTotal] = useState<number | null>(null);
  const [issuesNextOffset, setIssuesNextOffset] = useState<number | null>(null);
  const [issuesLoadingMore, setIssuesLoadingMore] = useState(false);
  const [preview, setPreview] = useState<DataImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [report, setReport] = useState<DataImportReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ImportRowOutcome[] | null>(null);
  const [outcomesError, setOutcomesError] = useState<string | null>(null);
  const [outcomesTotal, setOutcomesTotal] = useState<number | null>(null);
  const [outcomesNextOffset, setOutcomesNextOffset] = useState<number | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [sourceSystem, setSourceSystem] = useState("");
  const [authorityConfirmed, setAuthorityConfirmed] = useState(false);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [commitReason, setCommitReason] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mappingTemplates, setMappingTemplates] = useState<MappingTemplateRow[] | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [fixIssueId, setFixIssueId] = useState<string | null>(null);
  const [fixValue, setFixValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const activeIdRef = useRef<string | null>(null);

  const refreshBatches = useCallback(async (): Promise<void> => {
    try {
      const page = await dataImportService.listBatchesPage();
      setBatches(page.rows);
      setBatchesTotal(page.total);
      setBatchesNextOffset(page.nextOffset);
      setBatchesError(null);
    } catch (error) {
      setBatchesError(error instanceof Error ? error.message : "Import batches could not be loaded.");
    }
  }, []);

  async function loadMoreBatches(): Promise<void> {
    if (batchesNextOffset === null) return;
    setBatchesLoadingMore(true);
    try {
      const page = await dataImportService.listBatchesPage(batchesNextOffset);
      setBatches((current) => [...(current ?? []), ...page.rows]);
      setBatchesTotal(page.total);
      setBatchesNextOffset(page.nextOffset);
      setBatchesError(null);
    } catch (error) {
      setBatchesError(error instanceof Error ? error.message : "More import batches could not be loaded.");
    } finally {
      setBatchesLoadingMore(false);
    }
  }

  const loadIssues = useCallback(async (batchId: string): Promise<void> => {
    try {
      const page = await dataImportService.listIssuesPage(batchId);
      setIssues(page.rows);
      setIssuesTotal(page.total);
      setIssuesNextOffset(page.nextOffset);
      setIssuesError(null);
    } catch (error) {
      setIssuesError(error instanceof Error ? error.message : "Validation issues could not be loaded.");
    }
  }, []);

  async function loadMoreIssues(): Promise<void> {
    const batchId = activeIdRef.current;
    if (batchId === null || issuesNextOffset === null) return;
    setIssuesLoadingMore(true);
    try {
      const page = await dataImportService.listIssuesPage(batchId, undefined, issuesNextOffset);
      setIssues((current) => [...(current ?? []), ...page.rows]);
      setIssuesTotal(page.total);
      setIssuesNextOffset(page.nextOffset);
      setIssuesError(null);
    } catch (error) {
      setIssuesError(error instanceof Error ? error.message : "More validation issues could not be loaded.");
    } finally {
      setIssuesLoadingMore(false);
    }
  }

  const loadPreview = useCallback(async (batchId: string): Promise<void> => {
    try {
      setPreview(await dataImportService.preview(batchId));
      setPreviewError(null);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "The commit preview could not be loaded.");
    }
  }, []);

  const loadReport = useCallback(async (batchId: string): Promise<void> => {
    try {
      setReport(await dataImportService.report(batchId));
      setReportError(null);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "The import report could not be loaded.");
    }
  }, []);

  const loadOutcomes = useCallback(async (batchId: string): Promise<void> => {
    try {
      const page = await dataImportService.listRowOutcomes(batchId, 0);
      setOutcomes(page.rows);
      setOutcomesTotal(page.total);
      setOutcomesNextOffset(page.nextOffset);
      setOutcomesError(null);
    } catch (error) {
      setOutcomesError(error instanceof Error ? error.message : "The per-row outcomes could not be loaded.");
    }
  }, []);

  async function loadMoreOutcomes(): Promise<void> {
    const batchId = activeIdRef.current;
    if (batchId === null || outcomesNextOffset === null) return;
    setBusy(true);
    try {
      const page = await dataImportService.listRowOutcomes(batchId, outcomesNextOffset);
      setOutcomes((current) => [...(current ?? []), ...page.rows]);
      setOutcomesTotal(page.total);
      setOutcomesNextOffset(page.nextOffset);
      setOutcomesError(null);
    } catch (error) {
      setOutcomesError(error instanceof Error ? error.message : "More per-row outcomes could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  const openBatch = useCallback(async (batchId: string): Promise<ImportBatchDetail | null> => {
    try {
      const detail = await dataImportService.getBatch(batchId);
      activeIdRef.current = batchId;
      setActiveBatch(detail);
      setMapping(suggestColumnMapping(detail.scanHeaders));
      setSelectedTemplateId("");
      setCancelOpen(false);
      setActionError(null);
      setScanState(null);
      setIssuesTotal(null);
      setIssuesNextOffset(null);
      setOutcomes(null);
      setOutcomesError(null);
      setOutcomesTotal(null);
      setOutcomesNextOffset(null);
      const next = STATE_TO_STEP[detail.state] ?? "validate";
      setStep(next);
      if (next === "validate" || next === "commit") {
        setIssues(null);
        setPreview(null);
        await Promise.all([loadIssues(batchId), loadPreview(batchId)]);
      }
      if (next === "report") {
        setReport(null);
        setOutcomes(null);
        const reportLoads: Array<Promise<void>> = [loadReport(batchId), loadOutcomes(batchId)];
        /* A partially committed batch keeps its retry path reachable from the
           report so a reload never strands the operator without outcomes. */
        if (detail.state === "partially_committed") {
          setIssues(null);
          setPreview(null);
          reportLoads.push(loadIssues(batchId), loadPreview(batchId));
        }
        await Promise.all(reportLoads);
      }
      if (next === "map") {
        setMappingTemplates(null);
        try {
          setMappingTemplates(await dataImportService.listMappingTemplates());
        } catch {
          setMappingTemplates([]);
        }
      }
      return detail;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The import batch could not be opened.");
      return null;
    }
  }, [loadIssues, loadPreview, loadReport, loadOutcomes]);

  useEffect(() => {
    void refreshBatches();
  }, [refreshBatches]);

  /* Scan-step reconciliation: the server advances a linked-and-ready batch
     (the scan can complete before the upload is linked) and reports the
     document scan state, so the panel can offer wait, replace, or cancel. */
  const reconcileScan = useCallback(async (): Promise<ImportScanStatus | null> => {
    const batchId = activeIdRef.current;
    if (batchId === null || !supabaseMode) return null;
    try {
      const next = await dataImportService.reconcileScan(batchId);
      setScanState(next);
      if (next.error !== null) setActionError(next.error);
      if (next.advanced || next.state !== "uploaded") {
        await openBatch(batchId);
      }
      return next;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The scan status could not be checked.");
      return null;
    }
  }, [supabaseMode, openBatch]);

  useEffect(() => {
    /* No scanner on this deployment means no state will ever advance; the
       workspace explains the operator action instead of polling forever. */
    if (!supabaseMode || !scannerConfigured || activeBatch === null || step !== "scan") return;
    const timer = window.setInterval(() => { void reconcileScan(); }, 4000);
    return () => window.clearInterval(timer);
  }, [supabaseMode, scannerConfigured, activeBatch, step, reconcileScan]);

  function chooseFile(selected: File | null): void {
    setFile(selected);
    setFileError(null);
    if (selected !== null && !isImportableSpreadsheet(selected.type, selected.name)) {
      setFileError("Only CSV exports are accepted. XLSX parsing is not enabled in this environment.");
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragActive(false);
    chooseFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function uploadToBatch(detail: ImportBatchDetail): Promise<boolean> {
    if (file === null) {
      setFileError("Choose a CSV export to upload.");
      return false;
    }
    const uploadResult = await uploadDocumentFile({
      ownerDomain: "data_import_batch",
      ownerRecordRef: detail.reference,
      attachmentCode: "source_csv",
      file,
      allowedMimeTypes: ["text/csv"],
      maxBytes: CSV_MAX_BYTES,
    });
    setNotice(scannerConfigured
      ? `Batch ${detail.reference} created. Source document ${uploadResult.documentRef} is being scanned.`
      : `Batch ${detail.reference} created. The source document is stored; document scanning is not configured on this deployment, so the batch stays in "awaiting scan".`);
    await refreshBatches();
    await openBatch(detail.batchId);
    return true;
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFileError(null);
    setActionError(null);
    if (!authorityConfirmed || !privacyConfirmed) {
      setFileError("Confirm the data authority and privacy statements before uploading.");
      return;
    }
    if (file === null) {
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

      if (supabaseMode) {
        let detail: ImportBatchDetail;
        try {
          detail = await dataImportService.getBatch(created.batchId);
        } catch {
          await refreshBatches();
          setFileError(`Batch ${created.reference} was created, but its details could not be loaded. Open it from the list below to retry the upload.`);
          return;
        }
        try {
          const uploaded = await uploadToBatch(detail);
          if (uploaded) setStep("scan");
        } catch (error) {
          /* The batch exists; keep it open so the operator can retry the
             upload without starting over. */
          activeIdRef.current = created.batchId;
          setActiveBatch({ ...detail, hasSourceDocument: false });
          setStep("scan");
          setActionError(error instanceof Error ? error.message : "The source file could not be uploaded. Try again.");
          await refreshBatches();
        }
      } else {
        const detail = await dataImportService.ingestLocalFile(created.batchId, file);
        setNotice(`Batch ${created.reference} parsed locally in demo mode. ${detail.rowCount} rows were read; nothing was uploaded.`);
        activeIdRef.current = created.batchId;
        setActiveBatch(detail);
        setMapping(suggestColumnMapping(detail.scanHeaders));
        setStep("map");
        try {
          setMappingTemplates(await dataImportService.listMappingTemplates());
        } catch {
          setMappingTemplates([]);
        }
        await refreshBatches();
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "The batch could not be created.");
    } finally {
      setParsing(false);
    }
  }

  async function handleRetryUpload() {
    if (activeBatch === null) return;
    setBusy(true);
    setActionError(null);
    try {
      await uploadToBatch(activeBatch);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The source file could not be uploaded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshScan() {
    if (activeBatch === null) return;
    setBusy(true);
    const next = await reconcileScan();
    if (next !== null) {
      if (next.nextStep === "mapping" || next.advanced) {
        setNotice("Scan complete. Loading the mapping step…");
      } else if (next.nextStep === "replace") {
        setNotice("The source file cannot be used. Replace it with a corrected CSV or cancel the batch.");
      } else if (next.nextStep === "upload") {
        setNotice("The batch has no source file attached. Choose the CSV again and upload it.");
      } else if (next.stalled) {
        setNotice("Scanning has not completed. Replace the source file, or cancel the batch and try again.");
      } else {
        setNotice("The scan is still running. This page also refreshes automatically.");
      }
    }
    setBusy(false);
  }

  async function handleRecordMapping() {
    if (activeBatch === null) return;
    setActionError(null);
    const cleaned = Object.fromEntries(Object.entries(mapping).filter(([, target]) => target !== ""));
    if (selectedTemplateId === "") {
      const problems = mappingIssues(cleaned);
      if (problems.length > 0) {
        setActionError(problems.join(" "));
        return;
      }
    }
    setBusy(true);
    try {
      await dataImportService.recordMapping({
        batchId: activeBatch.batchId,
        mappingTemplateId: selectedTemplateId === "" ? null : selectedTemplateId,
        columnMappings: selectedTemplateId === "" ? cleaned : null,
      });
      setNotice("Mapping recorded. Running validation…");
      const detail = await openBatch(activeBatch.batchId);
      if (detail !== null && detail.state === "validating") {
        await runValidation();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The mapping could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function runValidation(): Promise<void> {
    const batchId = activeIdRef.current;
    if (batchId === null) return;
    setBusy(true);
    setActionError(null);
    try {
      const summary = await dataImportService.runValidation(batchId);
      await openBatch(batchId);
      if (summary.unresolvedErrorCount > 0) {
        setNotice(`Validation found ${summary.unresolvedErrorCount} unresolved ${summary.unresolvedErrorCount === 1 ? "row" : "rows"} that need a decision before commit.`);
      } else if (summary.warningCount > 0) {
        setNotice(`Validation passed with ${summary.warningCount} ${summary.warningCount === 1 ? "warning" : "warnings"}. Review them, then continue to commit.`);
      } else {
        setNotice("Validation passed. The batch is ready to commit.");
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Validation could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFinishValidation() {
    const batchId = activeIdRef.current;
    if (batchId === null) return;
    setBusy(true);
    setActionError(null);
    try {
      const summary = await dataImportService.finishValidation(batchId);
      await openBatch(batchId);
      if (summary.unresolvedErrorCount > 0) {
        setNotice(`Resolve the remaining ${summary.unresolvedErrorCount} ${summary.unresolvedErrorCount === 1 ? "error" : "errors"} before committing.`);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Validation could not be finalised.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResolveIssue(issue: ImportIssueRow, resolution: "accept" | "skip") {
    const batchId = activeIdRef.current;
    if (batchId === null || issue.rowId === null) return;
    setBusy(true);
    setActionError(null);
    try {
      await dataImportService.resolveIssue({
        batchId,
        rowId: issue.rowId,
        issueId: issue.issueId,
        resolution,
      });
      await Promise.all([loadIssues(batchId), loadPreview(batchId)]);
      setNotice(`Row ${issue.rowNumber ?? ""} ${resolution === "accept" ? "accepted" : "skipped"}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The issue could not be resolved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFixIssue(issue: ImportIssueRow) {
    const batchId = activeIdRef.current;
    if (batchId === null || issue.rowId === null || issue.field === null) return;
    if (fixValue.trim().length === 0) {
      setActionError("Enter the corrected value before saving the fix.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await dataImportService.resolveIssue({
        batchId,
        rowId: issue.rowId,
        issueId: issue.issueId,
        resolution: "modify",
        resolvedValue: { [issue.field]: fixValue.trim() },
        note: `Corrected ${issue.field} during review.`,
      });
      setFixIssueId(null);
      setFixValue("");
      await Promise.all([loadIssues(batchId), loadPreview(batchId)]);
      setNotice(`Row ${issue.rowNumber ?? ""} corrected.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The correction could not be saved.");
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
    setActionError(null);
    setBusy(true);
    try {
      const result = await dataImportService.commit({
        batchId: activeBatch.batchId,
        expectedState: activeBatch.state,
        expectedVersion: activeBatch.version,
        reason: commitReason.trim(),
        idempotencyKey: `import-commit:${activeBatch.reference}:${activeBatch.version}`,
        confirmedCreateCount: preview?.createCount ?? 0,
        confirmedUpdateCount: preview?.updateCount ?? 0,
      });
      /* The command result is a first paint; the stored rows are the authority
       * for per-row outcomes and the recomputed report, so reload both. */
      setReport(result);
      setStep("report");
      const reportLoads: Array<Promise<void>> = [loadReport(activeBatch.batchId), loadOutcomes(activeBatch.batchId)];
      if (result.state === "partially_committed") {
        setIssues(null);
        setPreview(null);
        reportLoads.push(loadIssues(activeBatch.batchId), loadPreview(activeBatch.batchId));
      }
      await Promise.all(reportLoads);
      await refreshBatches();
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : "The commit failed.");
      /* A stale version or competing change must show the current record. */
      const refreshed = await openBatch(activeBatch.batchId);
      if (refreshed !== null) setNotice("The batch was reloaded with its current state. Review and retry the commit.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (activeBatch === null) return;
    if (cancelReason.trim().length < 3) {
      setActionError("A cancellation reason of at least three characters is required.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await dataImportService.cancel({
        batchId: activeBatch.batchId,
        expectedVersion: activeBatch.version,
        reason: cancelReason.trim(),
      });
      activeIdRef.current = null;
      setActiveBatch(null);
      setStep("upload");
      setCancelOpen(false);
      setCancelReason("");
      setNotice("Import batch cancelled. No rows were written.");
      await refreshBatches();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The cancellation failed.");
    } finally {
      setBusy(false);
    }
  }

  function startAnother() {
    activeIdRef.current = null;
    setActiveBatch(null);
    setReport(null);
    setReportError(null);
    setOutcomes(null);
    setOutcomesError(null);
    setOutcomesTotal(null);
    setOutcomesNextOffset(null);
    setCommitReason("");
    setCommitError(null);
    setStep("upload");
    setFile(null);
    setNotice(null);
  }

  const activeStepIndex = STEP_ORDER.findIndex((entry) => entry.key === step);
  /* The stored rows are the authority for the report counts (the commit
     command result counts a failed group once, not every rolled-back row) —
     but only once every outcome page is loaded; a partial page must fall back
     to the stored report instead of undercounting. */
  const outcomeStats = outcomes === null || outcomesNextOffset !== null
    ? null
    : {
        created: outcomes.filter((row) => row.outcome === "create").length,
        unchanged: outcomes.filter((row) => row.outcome === "unchanged").length,
        skipped: outcomes.filter((row) => row.status === "skipped" || row.outcome === "skipped").length,
        errors: outcomes.filter((row) => row.status === "failed" || row.status === "error" || row.outcome === "error").length,
      };

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1>Data imports</h1>
          <p className="ph-sub">
            School-data import with provenance: upload a CSV export to a private store, scan server-side,
            map columns, review validation issues, preview the exact consequences, then commit once.
            Raw files never leave the private store.
          </p>
        </div>
        {!supabaseMode ? <span className="demo-badge">Demo data</span> : null}
      </div>

      <ol className={styles.stepper} aria-label="Import steps" tabIndex={0}>
        {STEP_ORDER.map((entry, index) => (
          <li key={entry.key} className={index === activeStepIndex ? styles.stepActive : undefined}
            aria-current={index === activeStepIndex ? "step" : undefined}>
            <span className="num">{String(index + 1).padStart(2, "0")}</span> {entry.label}
          </li>
        ))}
      </ol>

      {notice ? <p className={styles.liveNote} role="status" aria-live="polite">{notice}</p> : null}
      {actionError ? (
        <ErrorPanel title="The import step could not be completed" note={actionError}>
          <Button variant="quiet" onClick={() => setActionError(null)}>Dismiss</Button>
        </ErrorPanel>
      ) : null}

      {step === "upload" && (
        <form className={styles.panel} onSubmit={handleUpload} noValidate>
          <div className="field">
            <label htmlFor="import-source">Source system label</label>
            <input id="import-source" className="input" type="text" value={sourceSystem}
              onChange={(event) => setSourceSystem(event.target.value)}
              placeholder="e.g. Previous school records (2026)" />
          </div>
          <div className="field">
            <label
              htmlFor="import-file"
              className={`${styles.dropZone}${dragActive ? ` ${styles.dropZoneActive}` : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
            >
              <span className="msym" aria-hidden="true" style={{ fontSize: 24 }}>upload</span>
              <span className="strong">{file === null ? "Drop a CSV export here" : file.name}</span>
              <span className="small muted">or choose a file · CSV only, up to 5 MB and 10,000 rows</span>
            </label>
            <input id="import-file" ref={fileRef} className="input" type="file" accept=".csv,text/csv"
              onChange={(event: ChangeEvent<HTMLInputElement>) => chooseFile(event.target.files?.[0] ?? null)} />
            <p className="field-help">
              CSV only · XLSX parsing is not enabled in this environment. {supabaseMode
                ? "Files are uploaded to a private store and parsed server-side with hard size (5 MB) and row (10,000) limits."
                : "In demo mode the file is parsed in this browser with the same limits; nothing is uploaded."}
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
        {batches === null && batchesError === null ? (
          <LoadingSkeleton lines={3} label="Loading import batches…" />
        ) : batchesError !== null ? (
          <ErrorPanel title="Import batches could not be loaded" note={batchesError}>
            <Button variant="quiet" onClick={() => { setBatches(null); setBatchesError(null); void refreshBatches(); }}>
              Try again
            </Button>
          </ErrorPanel>
        ) : batches !== null && batches.length === 0 ? (
          <EmptyState title="No import batches" note="Upload a CSV export above to start a batch." />
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
                {(batches ?? []).map((batch) => (
                  <tr key={batch.batchId}>
                    <td className="num">{batch.reference}</td>
                    <td>{batch.sourceSystem}</td>
                    <td><StatusBadge tone={batch.state === "completed" ? "good" : batch.state === "cancelled" || batch.state === "failed" ? "alert" : "watch"}>{batch.state}</StatusBadge></td>
                    <td className="num">{batch.rowCount}</td>
                    <td className="num">{batch.errorCount}</td>
                    <td>
                      <Button variant="quiet" onClick={() => void openBatch(batch.batchId)}>Open</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {batchesNextOffset !== null ? (
          <div className={styles.actions}>
            <Button variant="quiet" onClick={() => void loadMoreBatches()} disabled={batchesLoadingMore}>
              {batchesLoadingMore
                ? "Loading…"
                : `Show more batches (${batches?.length ?? 0} of ${batchesTotal ?? 0})`}
            </Button>
          </div>
        ) : null}
      </section>

      {activeBatch !== null && step === "scan" && (
        <section className={styles.panel} aria-labelledby="scan-heading">
          <h2 id="scan-heading" className="section-label">
            Batch <span className="num">{activeBatch.reference}</span> · Scanning
          </h2>
          {activeBatch.scanError !== null ? (
            <p className={styles.errorNote} role="alert">
              The source file could not be parsed: {activeBatch.scanError}
            </p>
          ) : null}
          {(!activeBatch.hasSourceDocument || scanState?.nextStep === "replace" || scanState?.stalled === true) && supabaseMode ? (
            <>
              <p className={styles.muted}>
                {scanState?.nextStep === "replace"
                  ? "The source file cannot be used. Replace it with a corrected CSV, or cancel the batch and start again."
                  : scanState?.stalled === true
                    ? "Scanning has not completed. Replace the source file, or cancel the batch and try again."
                    : activeBatch.hasSourceDocument
                      ? "The batch has a source file but scanning has not started. Replace it to retry with a corrected CSV."
                      : "The batch was created but its source file is not attached yet. Choose the CSV again and retry the upload."}
              </p>
              <input className="input" type="file" accept=".csv,text/csv" aria-label={activeBatch.hasSourceDocument ? "Replace source CSV" : "Retry source CSV"}
                onChange={(event: ChangeEvent<HTMLInputElement>) => chooseFile(event.target.files?.[0] ?? null)} />
              <div className={styles.actions}>
                <Button variant="primary" onClick={() => void handleRetryUpload()} disabled={busy || file === null}>
                  {busy ? "Uploading…" : activeBatch.hasSourceDocument ? "Replace source file" : "Retry upload"}
                </Button>
              </div>
            </>
          ) : !scannerConfigured && supabaseMode ? (
            <div role="status">
              <p className={styles.errorNote}>
                {scannerProvider === "manual"
                  ? "The manual scanner is not configured on this deployment: an operator must set DOCUMENT_SCANNER_SECRET before a scan result can be reported. The uploaded CSV stays in the private store; use Refresh scan status after the secret is configured."
                  : "Document scanning is not configured on this deployment. The uploaded CSV stays in the private store; ask the operator to configure the selected scanner provider (see .env.example), then use Refresh scan status to continue."}
              </p>
            </div>
          ) : (
            <p className={styles.muted}>
              {scannerProvider === "manual"
                ? "The source file is waiting for the manual scanner result. The result arrives through the authenticated scanner callback; use Refresh scan status to continue once it is reported."
                : "The source file is being parsed server-side. This usually takes a few seconds; the status also refreshes automatically."}
            </p>
          )}
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void handleRefreshScan()} disabled={busy}>
              {busy ? "Checking…" : "Refresh scan status"}
            </Button>
            <Button variant="quiet" onClick={() => setCancelOpen(true)} disabled={busy}>Cancel batch</Button>
          </div>
        </section>
      )}

      {activeBatch !== null && step === "map" && (
        <section className={styles.panel} aria-labelledby="map-heading">
          <h2 id="map-heading" className="section-label">
            Batch <span className="num">{activeBatch.reference}</span> · Column Mapping
          </h2>

          {activeBatch.scanError !== null ? (
            <p className={styles.errorNote} role="alert">
              The source file could not be parsed: {activeBatch.scanError} Cancel this batch and re-upload a corrected CSV.
            </p>
          ) : null}

          {activeBatch.scanError === null && mappingTemplates !== null && mappingTemplates.length > 0 ? (
            <div className="field">
              <label htmlFor="mapping-template">Mapping template</label>
              <select id="mapping-template" className="input" value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}>
                <option value="">Use the detected column mapping below</option>
                {mappingTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name} (v{template.version})</option>
                ))}
              </select>
              <p className="field-help">
                Templates are published by the school office. Selecting one overrides the detected mapping.
              </p>
            </div>
          ) : null}

          {selectedTemplateId === "" && activeBatch.scanError === null ? (
            activeBatch.scanHeaders.length > 0 ? (
              <div className="table--scroll">
                <table className={`table ${styles.table}`}>
                  <caption className="sr-only">Detected source columns and their proposed target fields</caption>
                  <thead>
                    <tr>
                      <th scope="col">Source column</th>
                      <th scope="col">Target field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeBatch.scanHeaders.map((header) => (
                      <tr key={header}>
                        <td>{header}</td>
                        <td>
                          <select className="select" aria-label={`Target field for ${header}`}
                            value={mapping[header] ?? ""}
                            onChange={(event) => setMapping((current) => ({ ...current, [header]: event.target.value }))}>
                            <option value="">Ignore this column</option>
                            {CANONICAL_TARGET_FIELDS.map((field) => (
                              <option key={field.value} value={field.value}>{field.label}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.muted}>
                The scan did not record column headers for this batch. Custom mapping is unavailable without headers;
                cancel and re-upload the source file.
              </p>
            )
          ) : null}

          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void handleRecordMapping()}
              disabled={busy || activeBatch.scanError !== null || activeBatch.scanHeaders.length === 0}>
              {busy ? "Recording…" : "Confirm mapping and validate"}
            </Button>
            <Button variant="quiet" onClick={() => setCancelOpen(true)} disabled={busy}>Cancel batch</Button>
          </div>
        </section>
      )}

      {activeBatch !== null && (step === "validate" || step === "commit") && (
        <section className={styles.panel} aria-labelledby="active-batch-heading">
          <h2 id="active-batch-heading" className="section-label">
            Batch <span className="num">{activeBatch.reference}</span> · {activeBatch.state.replace(/_/g, " ")}
          </h2>

          {activeBatch.scanError !== null || activeBatch.rowCount === 0 ? (
            <ErrorPanel
              title="No rows were parsed from the source file"
              note={activeBatch.scanError ?? "The scan recorded zero data rows. Cancel this batch and re-upload a corrected CSV."}
            >
              <Button variant="quiet" onClick={() => setCancelOpen(true)}>Cancel batch</Button>
            </ErrorPanel>
          ) : null}

          <h3 className="section-label">Validation issues</h3>
          {issuesError !== null ? (
            <ErrorPanel title="Validation issues could not be loaded" note={issuesError}>
              <Button variant="quiet" onClick={() => void loadIssues(activeBatch.batchId)}>Try again</Button>
            </ErrorPanel>
          ) : issues === null ? (
            <LoadingSkeleton lines={2} label="Loading validation issues…" />
          ) : issues.length === 0 ? (
            <p className={styles.muted}>
              {activeBatch.state === "validating" ? "Validation has not run yet." : "No issues recorded."}
            </p>
          ) : (
            <>
            <ul className={styles.issueList}>
              {issues.map((issue) => (
                <li key={issue.issueId} className={issue.severity === "error" ? styles.issueError : styles.issueWarning}>
                  <strong>{issue.code}</strong> {issue.field !== null ? `(${issue.field}) ` : ""}
                  {issue.message}
                  {issue.resolutionHint !== null ? <small> · {issue.resolutionHint}</small> : null}
                  {issue.resolvedAtIso !== null ? <small className={styles.muted}> · Resolved</small> : null}
                  {issue.resolvedAtIso === null ? (
                    issue.rowId !== null ? (
                      fixIssueId === issue.issueId ? (
                        <span className={styles.fixRow}>
                          <label htmlFor={`fix-${issue.issueId}`} className="sr-only">
                            Corrected value for {issue.field ?? "the row"}
                          </label>
                          <input id={`fix-${issue.issueId}`} className="input" type="text" value={fixValue}
                            onChange={(event) => setFixValue(event.target.value)} />
                          <Button variant="primary" onClick={() => void handleFixIssue(issue)} disabled={busy}>Save fix</Button>
                          <Button variant="quiet" onClick={() => { setFixIssueId(null); setFixValue(""); }} disabled={busy}>Cancel</Button>
                        </span>
                      ) : (
                        <span className={styles.issueActions}>
                          <Button variant="quiet" onClick={() => void handleResolveIssue(issue, "accept")} disabled={busy}>Accept</Button>
                          {issue.field !== null ? (
                            <Button variant="quiet" onClick={() => { setFixIssueId(issue.issueId); setFixValue(""); }} disabled={busy}>Fix</Button>
                          ) : null}
                          <Button variant="quiet" onClick={() => void handleResolveIssue(issue, "skip")} disabled={busy}>Skip</Button>
                        </span>
                      )
                    ) : (
                      <small className={styles.muted}> Not bound to an uploaded row; correct the source file and re-upload.</small>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
            {issuesNextOffset !== null ? (
              <div className={styles.actions}>
                <Button variant="quiet" onClick={() => void loadMoreIssues()} disabled={issuesLoadingMore}>
                  {issuesLoadingMore
                    ? "Loading…"
                    : `Show more issues (${issues.length} of ${issuesTotal ?? 0})`}
                </Button>
              </div>
            ) : null}
            </>
          )}

          {previewError !== null ? (
            <ErrorPanel title="The commit preview could not be loaded" note={previewError}>
              <Button variant="quiet" onClick={() => void loadPreview(activeBatch.batchId)}>Try again</Button>
            </ErrorPanel>
          ) : preview !== null ? (
            <div className={styles.preview}>
              <p className="section-label">Exact consequences</p>
              <ul className={styles.previewList}>
                <li><span className="num">{preview.createCount}</span> records created</li>
                <li><span className="num">{preview.updateCount}</span> records updated</li>
                <li><span className="num">{preview.errorCount}</span> errors, <span className="num">{preview.warningCount}</span> warnings</li>
              </ul>
            </div>
          ) : null}

          {step === "validate" ? (
            <div className={styles.actions}>
              {activeBatch.rowCount > 0 && activeBatch.scanError === null
                && (activeBatch.state === "validating" || activeBatch.state === "needs_resolution") ? (
                <>
                  <Button variant="primary" onClick={() => void runValidation()} disabled={busy}>
                    {busy ? "Validating…" : issues === null ? "Run validation" : "Re-run validation"}
                  </Button>
                  <Button variant="quiet" onClick={() => void handleFinishValidation()} disabled={busy}>
                    Continue to commit
                  </Button>
                </>
              ) : null}
              <Button variant="quiet" onClick={() => setCancelOpen(true)} disabled={busy}>Cancel batch</Button>
            </div>
          ) : (
            <div className={styles.commitBox}>
              {activeBatch.state === "partially_committed" ? (
                <p className={styles.errorNote}>
                  A previous commit failed for one or more family groups. Retry the commit to process the remaining rows;
                  already committed rows are not duplicated.
                </p>
              ) : null}
              <div className="field">
                <label htmlFor="commit-reason">Commit reason (required, recorded in audit trail)</label>
                <input id="commit-reason" className="input" type="text" value={commitReason}
                  onChange={(event) => setCommitReason(event.target.value)}
                  aria-invalid={commitError !== null} />
                {commitError ? <p className="field-error" role="alert">{commitError}</p> : null}
              </div>
              <div className={styles.actions}>
                <Button variant="primary" onClick={() => void handleCommit()}
                  disabled={busy || activeBatch.rowCount === 0 || activeBatch.scanError !== null}>
                  {busy ? "Committing…" : `Commit ${preview?.createCount ?? 0} records`}
                </Button>
                <Button variant="quiet" onClick={() => setCancelOpen(true)} disabled={busy}>Cancel batch</Button>
              </div>
            </div>
          )}
        </section>
      )}

      {activeBatch !== null && cancelOpen && (
        <section className={styles.panel} aria-labelledby="cancel-heading">
          <h2 id="cancel-heading" className="section-label">Cancel batch {activeBatch.reference}</h2>
          <p className={styles.muted}>
            Cancelling stops this import and writes no school records. Cancelled batches remain visible in the list
            with their audit trail.
          </p>
          <div className="field">
            <label htmlFor="cancel-reason">Cancellation reason (required)</label>
            <input id="cancel-reason" className="input" type="text" value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)} />
          </div>
          <div className={styles.actions}>
            <Button variant="danger" onClick={() => void handleCancel()} disabled={busy || cancelReason.trim().length < 3}>
              {busy ? "Cancelling…" : "Confirm cancellation"}
            </Button>
            <Button variant="quiet" onClick={() => setCancelOpen(false)} disabled={busy}>Keep batch</Button>
          </div>
        </section>
      )}

      {step === "report" && (
        <section className={styles.panel} aria-labelledby="report-heading">
          <h2 id="report-heading" className="section-label">Import report</h2>
          {report === null && reportError !== null ? (
            <ErrorPanel title="The import report could not be loaded" note={reportError}>
              <Button variant="quiet" onClick={() => { if (activeIdRef.current !== null) void loadReport(activeIdRef.current); }}>
                Try again
              </Button>
            </ErrorPanel>
          ) : report === null ? (
            <LoadingSkeleton lines={2} label="Loading the import report…" />
          ) : (
            <>
              {reportError !== null ? (
                <p className={styles.errorNote} role="alert">
                  The stored report summary could not be refreshed: {reportError} The summary below is the commit result.
                </p>
              ) : null}
              <p>
                State <strong>{report.state.replace(/_/g, " ")}</strong> ·{" "}
                <span className="num">{outcomeStats?.created ?? report.createdCount}</span> records created,{" "}
                <span className="num">{outcomeStats?.unchanged ?? report.unchangedCount}</span> unchanged,{" "}
                <span className="num">{outcomeStats?.skipped ?? report.skippedCount}</span> skipped,{" "}
                <span className="num">{outcomeStats?.errors ?? report.errorCount}</span> errors. The batch summary is immutable and audited.
              </p>
              {report.committedAtIso !== null ? (
                <p className={styles.muted}>Committed {new Date(report.committedAtIso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.</p>
              ) : null}
              {activeBatch?.state === "partially_committed" ? (
                <p className={styles.errorNote}>
                  One or more family groups failed as a unit and were rolled back; no partial family data was written.
                  Retry the commit to process the remaining rows, or resolve any newly reported issues.
                </p>
              ) : null}
            </>
          )}

          {outcomesError !== null ? (
            <ErrorPanel title="The per-row outcomes could not be loaded" note={outcomesError}>
              <Button variant="quiet" onClick={() => { if (activeIdRef.current !== null) void loadOutcomes(activeIdRef.current); }}>
                Try again
              </Button>
            </ErrorPanel>
          ) : outcomes === null ? (
            <LoadingSkeleton lines={2} label="Loading per-row outcomes…" />
          ) : outcomes.length === 0 ? (
            <p className={styles.muted}>No stored rows are attached to this batch.</p>
          ) : (
            <div className="table--scroll">
              <table className={`table ${styles.table}`}>
                <caption className="sr-only">Per-row import outcomes from the stored batch rows</caption>
                <thead>
                  <tr>
                    <th scope="col" className="num">Row</th>
                    <th scope="col">Entity</th>
                    <th scope="col">Source key</th>
                    <th scope="col">Status</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomes.map((row) => {
                    const label = row.outcome ?? row.status;
                    const tone = row.outcome === "create"
                      ? "good"
                      : row.outcome === "error" || row.status === "failed" || row.status === "error"
                        ? "alert"
                        : row.status === "skipped" || row.outcome === "skipped"
                          ? "watch"
                          : "neutral";
                    return (
                      <tr key={`${row.rowNumber}-${row.sourceKey}`}>
                        <td className="num">{row.rowNumber}</td>
                        <td>{row.entity.replace(/_/g, " ")}</td>
                        <td className="num">{row.sourceKey}</td>
                        <td><StatusBadge tone={tone}>{row.status.replace(/_/g, " ")}</StatusBadge></td>
                        <td>{row.outcome !== null ? <StatusBadge tone={tone}>{label}</StatusBadge> : <span className={styles.muted}>Not committed</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {outcomesNextOffset !== null ? (
            <div className={styles.actions}>
              <Button variant="quiet" onClick={() => void loadMoreOutcomes()} disabled={busy}>
                {busy ? "Loading…" : `Show more outcomes (${outcomes?.length ?? 0} of ${outcomesTotal ?? 0})`}
              </Button>
            </div>
          ) : null}

          <div className={styles.actions}>
            {activeBatch?.state === "partially_committed" ? (
              <Button variant="primary" onClick={() => setStep("commit")} disabled={busy}>Retry commit</Button>
            ) : null}
            <Button variant="quiet" onClick={startAnother}>Start another import</Button>
            <Button variant="quiet" onClick={() => void refreshBatches()}>Refresh list</Button>
          </div>
        </section>
      )}
    </div>
  );
}
