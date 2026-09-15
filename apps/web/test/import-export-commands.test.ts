// @vitest-environment node
/**
 * Supabase command contract for the import/export completion slice:
 *   · validation, resolution, finish, and batch detail are anchored RPCs;
 *   · export retry re-queues through its own command;
 *   · the adapter registry exposes the exact operations the workspace calls
 *     and validates their payload shapes.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adapterModules } from "@/app/api/adapter/registry";
import type { AdapterOperation } from "@/app/api/adapter/registry/types";
import {
  dataExportRecover,
  dataExportRetry,
  dataImportApplyValidation,
  dataImportFinishValidation,
  dataImportGetBatch,
  dataImportResolveIssue,
} from "@/lib/supabase/domain";
import type { Database } from "@/lib/supabase/database.types";

const BATCH_ID = "00000000-0000-4000-8000-000000000901";
const ROW_ID = "00000000-0000-4000-8000-000000007001";
const ISSUE_ID = "00000000-0000-4000-8000-000000008001";

function rpcClient(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  const client = { schema: vi.fn().mockReturnValue({ rpc }) } as unknown as SupabaseClient<Database>;
  return { client, rpc };
}

describe("import validation commands", () => {
  it("resolves an issue through the transactional command", async () => {
    const { client, rpc } = rpcClient({
      id: "resolution-1",
      batchId: BATCH_ID,
      rowId: ROW_ID,
      issueId: ISSUE_ID,
      resolution: "skip",
      resolvedValue: null,
      resolvedAtIso: "2026-09-11T00:00:00.000Z",
      note: null,
    });

    const result = await dataImportResolveIssue(client, {
      batchId: BATCH_ID,
      rowId: ROW_ID,
      issueId: ISSUE_ID,
      resolution: "skip",
    });

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("data_import_resolve_issue", {
      p_batch_id: BATCH_ID,
      p_row_id: ROW_ID,
      p_issue_id: ISSUE_ID,
      p_resolution: "skip",
      p_resolved_value: null,
      p_note: null,
    });
  });

  it("records the computed row statuses and issues", async () => {
    const { client, rpc } = rpcClient({ batchId: BATCH_ID, state: "validating", version: 4 });
    await dataImportApplyValidation(client, {
      batchId: BATCH_ID,
      rows: [{ rowId: ROW_ID, status: "valid" }],
      issues: [],
    });
    expect(rpc).toHaveBeenCalledWith("data_import_apply_validation", {
      p_batch_id: BATCH_ID,
      p_rows: [{ rowId: ROW_ID, status: "valid" }],
      p_issues: [],
    });
  });

  it("finishes validation with the observed version", async () => {
    const { client, rpc } = rpcClient({ batchId: BATCH_ID, state: "ready", version: 5, unresolvedErrorCount: 0 });
    await dataImportFinishValidation(client, { batchId: BATCH_ID, expectedVersion: 4 });
    expect(rpc).toHaveBeenCalledWith("data_import_finish_validation", {
      p_batch_id: BATCH_ID,
      p_expected_version: 4,
    });
  });

  it("reads the batch projection without row payloads", async () => {
    const { client, rpc } = rpcClient({ batchId: BATCH_ID, state: "mapping", scanHeaders: ["entity", "source_key"] });
    const result = await dataImportGetBatch(client, BATCH_ID);
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("data_import_get_batch", { p_batch_id: BATCH_ID });
  });

  it("retries a failed export with the recorded reason", async () => {
    const { client, rpc } = rpcClient({ reference: "EXP-2026-0002", state: "requested", version: 6 });
    await dataExportRetry(client, { requestReference: "EXP-2026-0002", reason: "Provider outage resolved" });
    expect(rpc).toHaveBeenCalledWith("data_export_retry", {
      p_request_reference: "EXP-2026-0002",
      p_reason: "Provider outage resolved",
    });
  });

  it("recovers a stuck generating export by request id with the recorded reason", async () => {
    const { client, rpc } = rpcClient({
      requestId: "00000000-0000-4000-8000-000000000001",
      reference: "EXP-2026-0004",
      state: "requested",
      version: 6,
    });
    await dataExportRecover(client, {
      requestId: "00000000-0000-4000-8000-000000000001",
      reason: "Worker died at the queue layer",
    });
    expect(rpc).toHaveBeenCalledWith("data_export_recover", {
      p_request_id: "00000000-0000-4000-8000-000000000001",
      p_reason: "Worker died at the queue layer",
    });
  });
});

describe("adapter registry contract", () => {
  function operation(name: string): AdapterOperation {
    for (const adapterModule of adapterModules) {
      const found = adapterModule.operations.find((candidate) => candidate.name === name);
      if (found !== undefined) return found;
    }
    throw new Error(`operation ${name} is not registered`);
  }

  it("registers every import wizard operation", () => {
    for (const name of [
      "dataImports.listBatchesPaginated",
      "dataImports.getBatch",
      "dataImports.listIssuesPaginated",
      "dataImports.createBatch",
      "dataImports.preview",
      "dataImports.report",
      "dataImports.commit",
      "dataImports.cancel",
      "dataImports.recordScan",
      "dataImports.applyValidation",
      "dataImports.finishValidation",
      "dataImports.recordMapping",
      "dataImports.listMappingTemplates",
      "dataImports.listResolutions",
      "dataImports.resolveIssue",
    ]) {
      expect(() => operation(name)).not.toThrow();
    }
  });

  it("accepts the optimistic commit payload with its expected state", () => {
    const commit = operation("dataImports.commit");
    const parsed = commit.schema.safeParse({
      op: "dataImports.commit",
      payload: {
        batchId: BATCH_ID,
        expectedState: "ready",
        expectedVersion: 4,
        reason: "Initial roster import",
        idempotencyKey: "import-commit:IMP-2026-0001:4",
        confirmedCreateCount: 3,
        confirmedUpdateCount: 0,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects issue resolution without a real row id", () => {
    const resolve = operation("dataImports.resolveIssue");
    const parsed = resolve.schema.safeParse({
      op: "dataImports.resolveIssue",
      payload: { batchId: BATCH_ID, rowId: "row-4", issueId: ISSUE_ID, resolution: "accept" },
    });
    expect(parsed.success).toBe(false);
  });

  it("registers the export retry operation with an audited reason", () => {
    const retry = operation("dataExports.retry");
    expect(retry.schema.safeParse({
      op: "dataExports.retry",
      payload: { requestReference: "EXP-2026-0002", reason: "Provider outage resolved" },
    }).success).toBe(true);
    expect(retry.schema.safeParse({
      op: "dataExports.retry",
      payload: { requestReference: "EXP-2026-0002", reason: "no" },
    }).success).toBe(false);
  });

  it("registers the stuck-export recovery operation with a request id and reason", () => {
    const recover = operation("dataExports.recover");
    expect(recover.schema.safeParse({
      op: "dataExports.recover",
      payload: { requestId: "00000000-0000-4000-8000-000000000001", reason: "Worker died at the queue layer" },
    }).success).toBe(true);
    expect(recover.schema.safeParse({
      op: "dataExports.recover",
      payload: { requestId: "EXP-2026-0004", reason: "Worker died at the queue layer" },
    }).success).toBe(false);
    expect(recover.schema.safeParse({
      op: "dataExports.recover",
      payload: { requestId: "00000000-0000-4000-8000-000000000001", reason: "no" },
    }).success).toBe(false);
  });
});
