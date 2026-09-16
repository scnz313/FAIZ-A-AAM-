// @vitest-environment node
/**
 * Adapter registry contract for the result-batch creation path: the
 * read-only exam-definition op and the create-batch op with its exact zod
 * payload shape (uuid selection + optional idempotency key).
 */
import { describe, expect, it, vi } from "vitest";
import { timetableListVersions } from "@/lib/supabase/domain";

import { adapterModules } from "@/app/api/adapter/registry";
import type { AdapterOperation } from "@/app/api/adapter/registry/types";

const EXAM_ID = "00000000-0000-4000-8000-00000000e101";
const SECTION_ID = "00000000-0000-4000-8000-00000000e102";
const SUBJECT_ID = "00000000-0000-4000-8000-00000000e103";

function operation(name: string): AdapterOperation {
  for (const adapterModule of adapterModules) {
    const found = adapterModule.operations.find((candidate) => candidate.name === name);
    if (found !== undefined) return found;
  }
  throw new Error(`operation ${name} is not registered`);
}

describe("results batch-creation adapter operations", () => {
  it("accepts a boolean timetable summary flag while retaining the full-history default", () => {
    const read = operation("timetable.listVersions");
    for (const payload of [{}, { summaryOnly: true }, { summaryOnly: false }]) {
      expect(read.schema.safeParse({ op: "timetable.listVersions", payload }).success).toBe(true);
    }
    expect(read.schema.safeParse({ op: "timetable.listVersions", payload: { summaryOnly: "true" } }).success).toBe(false);
  });

  it("reads only timetable version metadata for the dashboard under the same database client", async () => {
    const rows = [{ id: "version", grade_section_id: SECTION_ID, status: "draft", version: 2 }];
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    const select = vi.fn().mockReturnValue({ order });
    const from = vi.fn().mockReturnValue({ select });
    const rpc = vi.fn();
    const db = { from, rpc } as unknown as Parameters<typeof timetableListVersions>[0];
    await expect(timetableListVersions(db, true)).resolves.toMatchObject({ ok: true, value: rows });
    expect(from).toHaveBeenCalledExactlyOnceWith("timetable_versions");
    expect(select).toHaveBeenCalledExactlyOnceWith("id, grade_section_id, status, version");
    expect(order).toHaveBeenCalledExactlyOnceWith("version", { ascending: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("registers the exam-definition read with an empty payload", () => {
    const read = operation("results.examDefinitions");
    expect(read.schema.safeParse({ op: "results.examDefinitions", payload: {} }).success).toBe(true);
  });

  it("accepts the exact create-batch selection and an optional idempotency key", () => {
    const create = operation("results.createBatch");
    expect(create.schema.safeParse({
      op: "results.createBatch",
      payload: { examDefinitionId: EXAM_ID, gradeSectionId: SECTION_ID, subjectId: SUBJECT_ID },
    }).success).toBe(true);
    expect(create.schema.safeParse({
      op: "results.createBatch",
      payload: { examDefinitionId: EXAM_ID, gradeSectionId: SECTION_ID, subjectId: SUBJECT_ID, idempotencyKey: "batch:1" },
    }).success).toBe(true);
  });

  it("rejects a missing, non-uuid, or blank create selection", () => {
    const create = operation("results.createBatch");
    expect(create.schema.safeParse({
      op: "results.createBatch",
      payload: { examDefinitionId: "midterm-8-a", gradeSectionId: SECTION_ID, subjectId: SUBJECT_ID },
    }).success).toBe(false);
    expect(create.schema.safeParse({
      op: "results.createBatch",
      payload: { examDefinitionId: EXAM_ID, gradeSectionId: SECTION_ID },
    }).success).toBe(false);
    expect(create.schema.safeParse({
      op: "results.createBatch",
      payload: { examDefinitionId: EXAM_ID, gradeSectionId: SECTION_ID, subjectId: SUBJECT_ID, idempotencyKey: "" },
    }).success).toBe(false);
  });

  it("registers the correction review operations", () => {
    const list = operation("results.listCorrections");
    expect(list.schema.safeParse({ op: "results.listCorrections", payload: {} }).success).toBe(true);

    const approve = operation("results.approveCorrection");
    const REQUEST_ID = "00000000-0000-4000-8000-000000009001";
    expect(approve.schema.safeParse({
      op: "results.approveCorrection",
      payload: { requestId: REQUEST_ID, expectedVersion: 1 },
    }).success).toBe(true);
    expect(approve.schema.safeParse({
      op: "results.approveCorrection",
      payload: { requestId: REQUEST_ID, expectedVersion: 0 },
    }).success).toBe(false);
    expect(approve.schema.safeParse({
      op: "results.approveCorrection",
      payload: { expectedVersion: 1 },
    }).success).toBe(false);
  });
});
