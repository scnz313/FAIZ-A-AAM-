/**
 * Import service — demo adapter end-to-end. The demo adapter parses the
 * operator's own bounded CSV locally (never simulating a remote success) and
 * walks the same state machine the Supabase commands enforce:
 * uploaded → mapping → validating → needs_resolution/ready → completed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dataImportService } from "@/modules/services/data-import";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const STORE_KEY = sessionKey("data-imports");

const CSV_OK = [
  "entity,source_key,given_name,family_name,email",
  "students,STU-1,Aarif,Hussain,parent@example.com",
  "students,STU-2,,,,",
].join("\n");

const CSV_VALID = [
  "entity,source_key,given_name,family_name,email",
  "students,STU-1,Aarif,Hussain,parent@example.com",
  "students,STU-2,Sana,Wani,second@example.com",
].join("\n");

function file(body: string, name = "roster.csv"): File {
  return new File([body], name, { type: "text/csv" });
}

describe("data import service (demo mode)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "demo");
    sessionRemove(STORE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    sessionRemove(STORE_KEY);
  });

  it("runs the full wizard: parse, map, validate, resolve, commit, report", async () => {
    const created = await dataImportService.createBatch({
      academicYearId: "00000000-0000-4000-8000-000000000602",
      sourceSystem: "Previous school",
      authorityConfirmation: true,
      privacyConfirmation: true,
    });

    const parsed = await dataImportService.ingestLocalFile(created.batchId, file(CSV_OK));
    expect(parsed.state).toBe("mapping");
    expect(parsed.rowCount).toBe(2);
    expect(parsed.scanHeaders).toEqual(["entity", "source_key", "given_name", "family_name", "email"]);

    await dataImportService.recordMapping({
      batchId: created.batchId,
      columnMappings: { entity: "entity", source_key: "sourceKey", given_name: "givenName", family_name: "familyName", email: "contact" },
    });

    const validation = await dataImportService.runValidation(created.batchId);
    expect(validation.state).toBe("needs_resolution");
    expect(validation.errorCount).toBeGreaterThanOrEqual(1);

    const issues = (await dataImportService.listIssuesPage(created.batchId)).rows;
    const failedIssue = issues.find((issue) => issue.severity === "error");
    expect(failedIssue?.rowId).not.toBeNull();

    const resolution = await dataImportService.resolveIssue({
      batchId: created.batchId,
      rowId: failedIssue!.rowId!,
      issueId: failedIssue!.issueId,
      resolution: "skip",
    });
    expect(resolution.resolution).toBe("skip");

    const finished = await dataImportService.finishValidation(created.batchId);
    expect(finished.state).toBe("ready");
    expect(finished.unresolvedErrorCount).toBe(0);

    const detail = await dataImportService.getBatch(created.batchId);
    const preview = await dataImportService.preview(created.batchId);
    expect(preview.createCount).toBe(1);
    expect(preview.skippedCount).toBe(1);

    const report = await dataImportService.commit({
      batchId: created.batchId,
      expectedState: "ready",
      expectedVersion: detail.version,
      reason: "Initial roster import",
      idempotencyKey: `test-commit:${created.reference}`,
      confirmedCreateCount: preview.createCount,
      confirmedUpdateCount: preview.updateCount,
    });
    expect(report.state).toBe("completed");
    expect(report.createdCount).toBe(1);
    expect(report.skippedCount).toBe(1);

    const replayed = await dataImportService.commit({
      batchId: created.batchId,
      expectedState: "ready",
      expectedVersion: detail.version,
      reason: "Initial roster import",
      idempotencyKey: `test-commit:${created.reference}`,
      confirmedCreateCount: preview.createCount,
      confirmedUpdateCount: preview.updateCount,
    });
    expect(replayed).toEqual(report);

    const stored = await dataImportService.report(created.batchId);
    expect(stored).toEqual(report);

    const outcomes = await dataImportService.listRowOutcomes(created.batchId);
    expect(outcomes.rows).toHaveLength(2);
    expect(outcomes.total).toBe(2);
    expect(outcomes.nextOffset).toBeNull();
    expect(outcomes.rows.map((row) => row.outcome).sort()).toEqual(["create", "skipped"]);
  });

  it("blocks on dangling relationships and unknown grade sections until each row is resolved", async () => {
    const batch = await dataImportService.createBatch({
      academicYearId: "00000000-0000-4000-8000-000000000602",
      sourceSystem: "Manual",
      authorityConfirmation: true,
      privacyConfirmation: true,
    });
    const csv = [
      "entity,source_key,family_key,given_name,family_name,contact,relationship_label,guardian_key,student_key,grade_section_id",
      "students,STU-1,FAM-1,Aarif,Hussain,,,,,",
      "guardians,G-1,FAM-1,Sana,Wani,sana@example.com,,,,",
      "guardian_student_relationships,REL-1,FAM-1,,,,Parent,G-1,STU-1,",
      "guardian_student_relationships,REL-X,FAM-1,,,,Parent,G-MISSING,STU-1,",
      "enrollments,STU-1,FAM-1,,,,,,,00000000-0000-4000-8000-00000000dead",
    ].join("\n");
    await dataImportService.ingestLocalFile(batch.batchId, file(csv));
    await dataImportService.recordMapping({
      batchId: batch.batchId,
      columnMappings: { entity: "entity", source_key: "sourceKey" },
    });

    const validation = await dataImportService.runValidation(batch.batchId);
    expect(validation.state).toBe("needs_resolution");
    const issues = (await dataImportService.listIssuesPage(batch.batchId)).rows;
    expect(issues.some((issue) => issue.code === "unknown_grade_section" && issue.severity === "error")).toBe(true);
    const dangling = issues.find((issue) => issue.code === "missing_relationship" && issue.field === "guardianKey");
    expect(dangling).toBeDefined();

    // A commit with the dangling reference still open is refused.
    const blocked = await dataImportService.finishValidation(batch.batchId);
    expect(blocked.state).toBe("needs_resolution");
    await expect(dataImportService.commit({
      batchId: batch.batchId,
      expectedState: "needs_resolution",
      expectedVersion: blocked.version,
      reason: "Premature commit",
      idempotencyKey: "test-dangling-blocked",
      confirmedCreateCount: 5,
      confirmedUpdateCount: 0,
    })).rejects.toThrow(/not ready to commit/i);

    // Fix the dangling key and skip the unknown enrollment.
    await dataImportService.resolveIssue({
      batchId: batch.batchId,
      rowId: dangling!.rowId!,
      issueId: dangling!.issueId,
      resolution: "modify",
      resolvedValue: { guardianKey: "G-1" },
    });
    const enrollmentIssue = issues.find((issue) => issue.code === "unknown_grade_section");
    await dataImportService.resolveIssue({
      batchId: batch.batchId,
      rowId: enrollmentIssue!.rowId!,
      issueId: enrollmentIssue!.issueId,
      resolution: "skip",
    });

    const finished = await dataImportService.finishValidation(batch.batchId);
    expect(finished.state).toBe("ready");
    const detail = await dataImportService.getBatch(batch.batchId);
    const preview = await dataImportService.preview(batch.batchId);
    expect(preview.createCount).toBe(4);
    expect(preview.skippedCount).toBe(1);

    const report = await dataImportService.commit({
      batchId: batch.batchId,
      expectedState: "ready",
      expectedVersion: detail.version,
      reason: "Resolved QA import",
      idempotencyKey: `test-dangling:${batch.reference}`,
      confirmedCreateCount: preview.createCount,
      confirmedUpdateCount: 0,
    });
    expect(report.state).toBe("completed");
    expect(report.createdCount).toBe(4);
    expect(report.skippedCount).toBe(1);

    const outcomes = await dataImportService.listRowOutcomes(batch.batchId);
    expect(outcomes.rows.filter((row) => row.status === "skipped")).toHaveLength(1);
    expect(outcomes.rows.filter((row) => row.outcome === "create")).toHaveLength(4);
  });

  it("pages batches and issues with server-shaped totals in demo mode", async () => {
    const CSV_TWO_ERRORS = [
      "entity,source_key,given_name,family_name,email",
      "students,STU-1,,,,",
      "students,STU-2,,,,",
    ].join("\n");
    const batch = await dataImportService.createBatch({
      academicYearId: "00000000-0000-4000-8000-000000000602",
      sourceSystem: "Manual",
      authorityConfirmation: true,
      privacyConfirmation: true,
    });
    await dataImportService.createBatch({
      academicYearId: "00000000-0000-4000-8000-000000000602",
      sourceSystem: "Manual",
      authorityConfirmation: true,
      privacyConfirmation: true,
    });
    await dataImportService.ingestLocalFile(batch.batchId, file(CSV_TWO_ERRORS));
    await dataImportService.recordMapping({ batchId: batch.batchId, columnMappings: { entity: "entity", source_key: "sourceKey" } });
    await dataImportService.runValidation(batch.batchId);

    const firstPage = await dataImportService.listBatchesPage(0, 1);
    expect(firstPage.total).toBe(2);
    expect(firstPage.rows).toHaveLength(1);
    expect(firstPage.nextOffset).toBe(1);
    const lastPage = await dataImportService.listBatchesPage(1, 1);
    expect(lastPage.rows).toHaveLength(1);
    expect(lastPage.nextOffset).toBeNull();
    expect(lastPage.rows[0]?.reference).not.toBe(firstPage.rows[0]?.reference);

    const issuePage = await dataImportService.listIssuesPage(batch.batchId, "error", 0, 1);
    expect(issuePage.total).toBe(2);
    expect(issuePage.rows).toHaveLength(1);
    expect(issuePage.nextOffset).toBe(1);
    const issueRest = await dataImportService.listIssuesPage(batch.batchId, "error", 1, 1);
    expect(issueRest.rows).toHaveLength(1);
    expect(issueRest.nextOffset).toBeNull();
  });

  it("refuses to commit when the record version or state changed", async () => {
    const created = await dataImportService.createBatch({
      academicYearId: "00000000-0000-4000-8000-000000000602",
      sourceSystem: "Manual",
      authorityConfirmation: true,
      privacyConfirmation: true,
    });
    await dataImportService.ingestLocalFile(created.batchId, file(CSV_VALID));
    await dataImportService.recordMapping({ batchId: created.batchId, columnMappings: { entity: "entity" } });
    await dataImportService.runValidation(created.batchId);
    const detail = await dataImportService.getBatch(created.batchId);
    expect(detail.state).toBe("ready");

    await expect(dataImportService.commit({
      batchId: created.batchId,
      expectedState: "ready",
      expectedVersion: detail.version + 5,
      reason: "Stale tab",
      idempotencyKey: "test-stale-version",
      confirmedCreateCount: 2,
      confirmedUpdateCount: 0,
    })).rejects.toThrow(/version mismatch/i);

    await expect(dataImportService.commit({
      batchId: created.batchId,
      expectedState: "validating",
      expectedVersion: detail.version,
      reason: "Wrong state",
      idempotencyKey: "test-wrong-state",
      confirmedCreateCount: 2,
      confirmedUpdateCount: 0,
    })).rejects.toThrow(/state changed/i);
  });

  it("cancels a batch with an audited reason and leaves it closed", async () => {
    const created = await dataImportService.createBatch({
      academicYearId: "00000000-0000-4000-8000-000000000602",
      sourceSystem: "Manual",
      authorityConfirmation: true,
      privacyConfirmation: true,
    });
    const detail = await dataImportService.getBatch(created.batchId);
    const cancelled = await dataImportService.cancel({
      batchId: created.batchId,
      expectedVersion: detail.version,
      reason: "Duplicate upload",
    });
    expect(cancelled.state).toBe("cancelled");

    await expect(dataImportService.cancel({
      batchId: created.batchId,
      expectedVersion: cancelled.version,
      reason: "Again",
    })).rejects.toThrow(/already closed/i);
  });

  it("rejects a malformed CSV instead of pretending the rows were parsed", async () => {
    const created = await dataImportService.createBatch({
      academicYearId: "00000000-0000-4000-8000-000000000602",
      sourceSystem: "Manual",
      authorityConfirmation: true,
      privacyConfirmation: true,
    });
    await expect(dataImportService.ingestLocalFile(created.batchId, file("entity,source_key,given_name\nmonsters,STU-1,Aarif\n"))).rejects.toThrow(/entity/i);
    await expect(dataImportService.ingestLocalFile(created.batchId, file("entity,source_key,given_name\n"))).rejects.toThrow(/no data rows/i);
  });

  it("reads a bounded page of per-row outcomes through the server boundary", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      reference: "IMP-2026-0001",
      state: "partially_committed",
      total: 3,
      nextOffset: 2,
      rows: [
        { rowNumber: 2, entity: "students", sourceKey: "STU-1", status: "committed", outcome: "create" },
        { rowNumber: 3, entity: "enrollments", sourceKey: "STU-1", status: "failed", outcome: "error" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const page = await dataImportService.listRowOutcomes("00000000-0000-4000-8000-000000000901", 0, 2);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/data-imports/00000000-0000-4000-8000-000000000901/row-outcomes?offset=0&limit=2",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
    expect(page).toEqual({
      rows: [
        { rowNumber: 2, entity: "students", sourceKey: "STU-1", status: "committed", outcome: "create" },
        { rowNumber: 3, entity: "enrollments", sourceKey: "STU-1", status: "failed", outcome: "error" },
      ],
      total: 3,
      nextOffset: 2,
    });
  });
});
