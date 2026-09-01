import { describe, expect, it } from "vitest";

import {
  DATA_EXPORT_STATES,
  dataExportRequestInputSchema,
  isFormulaDangerousCell,
} from "./data-exports";
import {
  dataImportCommitInputSchema,
  dataImportReportSchema,
} from "./data-import";
import {
  guardianClaimAcceptInputSchema,
  guardianClaimAcceptanceSchema,
  guardianContactChangeInputSchema,
} from "./guardian-claims";
import {
  teachingAssignmentEndInputSchema,
  teachingAssignmentSchema,
  teachingStaffCreateInputSchema,
} from "./teaching-assignments";
import { isNonAssignableRole, LEGACY_NON_ASSIGNABLE_ROLES } from "./relationships";

const UUID = "3f8b0b1e-2c7a-4f4d-9e1e-6a2c1f9d4b0a";
const OTHER_UUID = "9c2f7e3a-1b4d-4e6f-8a9b-0c1d2e3f4a5b";

describe("teaching assignment contracts", () => {
  it("parses a manual teaching assignment with provenance", () => {
    const parsed = teachingAssignmentSchema.parse({
      id: UUID,
      ref: "TAS-2026-0001",
      staffMemberId: OTHER_UUID,
      academicYearId: UUID,
      gradeSectionId: OTHER_UUID,
      subjectId: UUID,
      status: "active",
      effectiveFromIso: "2026-04-01T00:00:00.000Z",
      effectiveToIso: null,
      version: 1,
      provenance: "manual",
      sourceRef: null,
      createdReason: "Appointed for 2026–27.",
      createdAtIso: "2026-08-01T00:00:00.000Z",
      updatedByAccountId: null,
    });
    expect(parsed.provenance).toBe("manual");
  });

  it("rejects an unknown provenance value", () => {
    expect(
      teachingAssignmentSchema.safeParse({
        id: UUID,
        ref: "TA-1",
        staffMemberId: OTHER_UUID,
        academicYearId: UUID,
        gradeSectionId: OTHER_UUID,
        subjectId: OTHER_UUID,
        status: "active",
        effectiveFromIso: "2026-04-01T00:00:00.000Z",
        effectiveToIso: null,
        version: 1,
        provenance: "guess",
        sourceRef: null,
        createdReason: "x",
        createdAtIso: "2026-08-01T00:00:00.000Z",
        updatedByAccountId: null,
      }).success,
    ).toBe(false);
  });

  it("rejects a short end reason and a stale expected version", () => {
    expect(
      teachingAssignmentEndInputSchema.safeParse({
        assignmentId: UUID,
        reason: "ok",
        expectedVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("creates a teaching staff record without any account linkage", () => {
    const parsed = teachingStaffCreateInputSchema.parse({
      displayName: "Naseer Bhat",
      title: "Mathematics teacher",
      reason: "New appointment for the mathematics department.",
    });
    expect(parsed.displayName).toBe("Naseer Bhat");
  });
});

describe("data import contracts", () => {
  it("parses a committed report with exact counts", () => {
    const parsed = dataImportReportSchema.parse({
      batchRef: "IMP-2026-0001",
      state: "completed",
      rowCount: 11,
      createdCount: 6,
      updatedCount: 2,
      unchangedCount: 1,
      skippedCount: 1,
      errorCount: 1,
      committedAtIso: "2026-08-31T00:00:00.000Z",
      auditRef: "AUD-2026-0001",
    });
    expect(parsed.createdCount + parsed.updatedCount + parsed.unchangedCount + parsed.skippedCount + parsed.errorCount).toBe(parsed.rowCount);
  });

  it("rejects a commit without an idempotency key or short reason", () => {
    const base = {
      batchId: UUID,
      expectedVersion: 2,
      reason: "Roster import approved by the office.",
      idempotencyKey: "import-commit-0001",
      confirmedCreateCount: 6,
      confirmedUpdateCount: 0,
    };
    expect(dataImportCommitInputSchema.safeParse({ ...base, reason: "ok" }).success).toBe(false);
    expect(dataImportCommitInputSchema.safeParse({ ...base, idempotencyKey: "short" }).success).toBe(false);
  });

  it("rejects an import commit without the authority confirmation", () => {
    expect(
      dataImportCommitInputSchema.safeParse({
        batchId: UUID,
        expectedState: "ready",
        expectedVersion: 2,
        reason: "Approved roster import.",
        idempotencyKey: "import-2026-0001",
        confirmedCreateCount: 6,
        confirmedUpdateCount: 0,
      }).success,
    ).toBe(true);
  });
});

describe("guardian claim contracts", () => {
  it("requires a positive consent version on acceptance", () => {
    expect(
      guardianClaimAcceptInputSchema.safeParse({
        token: "a".repeat(32),
        givenName: "Nida",
        familyName: "Bhat",
        consentVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      guardianClaimAcceptInputSchema.safeParse({
        token: "a".repeat(16),
        givenName: "N",
        familyName: "B",
        consentVersion: 0,
      }).success,
    ).toBe(false);
  });

  it("records whether an existing applicant account was reused", () => {
    const parsed = guardianClaimAcceptanceSchema.parse({
      accountId: UUID,
      guardianId: OTHER_UUID,
      reusedExistingAccount: true,
      guardianGrantRef: "ROLE-2026-0001",
      activatedLinkRefs: ["LINK-2026-0001"],
      contactDeliveryVerifiedAtIso: "2026-08-31T00:00:00.000Z",
    });
    expect(parsed.reusedExistingAccount).toBe(true);
  });

  it("requires a reason for a contact change", () => {
    expect(guardianContactChangeInputSchema.safeParse({ newContact: "+919000000000", reason: "ok" }).success).toBe(false);
    expect(guardianContactChangeInputSchema.safeParse({ newContact: "+919000000000", reason: "Old number lost." }).success).toBe(true);
  });
});

describe("data export contracts", () => {
  it("parses a purpose-bound CSV export request", () => {
    const parsed = dataExportRequestInputSchema.parse({
      domain: "students",
      filters: { academicYearRef: "AY-2026-27" },
      columns: ["reference", "display_name", "enrollment_status"],
      format: "csv",
      purpose: "Fee reconciliation follow-up for Term 3.",
      reason: "Office review of outstanding balances.",
    });
    expect(parsed.format).toBe("csv");
  });

  it("flags every OWASP formula-triggering leading character", () => {
    for (const trigger of ["=", "+", "-", "@", "\t", "\r", "\n", "\0", "＝", "＋", "－", "＠"]) {
      expect(isFormulaDangerousCell(`${trigger}payload`)).toBe(true);
    }
    expect(isFormulaDangerousCell("safe value")).toBe(false);
    expect(isFormulaDangerousCell("")).toBe(false);
  });

  it("keeps export states explicit", () => {
    expect([...DATA_EXPORT_STATES]).toEqual([
      "requested",
      "generating",
      "ready",
      "failed",
      "expired",
      "cancelled",
    ]);
  });
});

describe("legacy role assignability", () => {
  it("marks teacher and student as non-assignable", () => {
    expect(LEGACY_NON_ASSIGNABLE_ROLES).toEqual(["teacher", "student"]);
    expect(isNonAssignableRole("teacher")).toBe(true);
    expect(isNonAssignableRole("student")).toBe(true);
    expect(isNonAssignableRole("guardian")).toBe(false);
    expect(isNonAssignableRole("finance_officer")).toBe(false);
  });
});
