// @vitest-environment node
/**
 * The gateway kicks the outbox worker after every successful NON-read
 * operation. `isReadOperation` is an explicit allowlist: an unlisted name is
 * a write and kicks. These tests pin the allowlist against the real registry
 * so a newly registered read-like name fails here until it is classified,
 * and a newly registered write can never silently miss the kick.
 */
import { describe, expect, it } from "vitest";

import { adapterModules } from "@/app/api/adapter/registry";
import { isReadOperation } from "@/app/api/adapter/read-operations";

const REGISTERED = adapterModules.flatMap((module) => module.operations.map((operation) => operation.name));

/* Names whose semantics are read-only but whose spelling does not match the
 * read pattern — keep explicit so the classifier stays honest. */
const READ_SPellingExceptions = new Set([
  "context.family",
  "context.staff",
  "enrollment.readiness",
  "guardianClaims.preview",
  "jobs.retentionStatus",
  "jobs.vacancies",
  "results.examDefinitions",
  "results.releaseCandidates",
  "settings.readLatest",
  "timetable.effective",
  "timetable.validateDraft",
  "dataExports.healthCheck",
  "dataExports.healthSnapshot",
  "dataExports.healthSnapshots",
  "dataImports.report",
  "documents.get",
  "notifications.unreadCount",
  "links.capabilities",
  "admissions.reviewerDirectory",
  "admissions.staffByRef",
  "admissions.staffQueue",
  "jobs.staffQueue",
  "admissions.enrollmentReference",
  "admissions.listMine",
  "jobs.listMine",
  "links.listMine",
  "audit.listPage",
  "documents.listPage",
  "links.listPage",
  "dataExports.listPaginated",
  "dataImports.listBatchesPaginated",
  "dataImports.listIssuesPaginated",
  "schoolSetup.read",
  "guardians.adminList",
  "staff.profilesList",
]);

const READ_NAME_PATTERN = /(?:^|\.)(?:list|read|get|preview|summary|search|page|mine|unread|has|count)/i;

describe("adapter read-operation classifier", () => {
  it("covers the registry: every registered operation is classified", () => {
    for (const name of REGISTERED) {
      expect(typeof isReadOperation(name)).toBe("boolean");
    }
  });

  it("classifies every read-spelled registry operation as read", () => {
    const missed = REGISTERED.filter(
      (name) => (READ_NAME_PATTERN.test(name) || READ_SPellingExceptions.has(name)) && !isReadOperation(name),
    );
    expect(missed).toEqual([]);
  });

  it("defaults unlisted names to write (kick)", () => {
    expect(isReadOperation("results.publish")).toBe(false);
    expect(isReadOperation("dataImports.commit")).toBe(false);
    expect(isReadOperation("staffInvites.create")).toBe(false);
    expect(isReadOperation("notifications.markRead")).toBe(false);
    expect(isReadOperation("brandNew.writeOp")).toBe(false);
  });

  it("contains no stale names that are not registered operations", () => {
    const registered = new Set(REGISTERED);
    for (const name of REGISTERED) {
      if (isReadOperation(name)) expect(registered.has(name)).toBe(true);
    }
  });
});
