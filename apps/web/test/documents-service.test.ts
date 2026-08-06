// @vitest-environment node
/**
 * Deterministic contract tests for the documents demo adapter
 * (modules/services/documents.ts). The bundle is per student: report cards
 * come from the academics service, receipts from the student-scoped finance
 * ledger, and student/enrollment references from the family context service.
 * The page itself imports no fixtures — it reads only the service.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  DEMO_GUARDIAN_ACCOUNT_ID,
  familyContextService,
  RELATIONSHIPS_SESSION_KEY,
} from "@/modules/services/family-context";
import { FINANCE_SESSION_KEYS } from "@/modules/services/finance";
import { documentsService } from "@/modules/services/documents";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const ACADEMICS_SESSION_KEY = sessionKey("academics");
const UNKNOWN_STUDENT_ID = "00000000-0000-4000-8000-000000000903";

beforeEach(() => {
  setDemoNow(new Date("2026-08-10T05:00:00.000Z"));
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  Object.values(FINANCE_SESSION_KEYS).forEach((key) => sessionRemove(key));
  sessionRemove(ACADEMICS_SESSION_KEY);
});

afterEach(() => {
  setDemoNow(null);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  Object.values(FINANCE_SESSION_KEYS).forEach((key) => sessionRemove(key));
  sessionRemove(ACADEMICS_SESSION_KEY);
});

async function accessibleContexts() {
  return familyContextService.listAccessibleStudentContexts(DEMO_GUARDIAN_ACCOUNT_ID);
}

describe("documentsService", () => {
  it("returns the report cards, receipts, and school-record references for the active child", async () => {
    const contexts = await accessibleContexts();
    const first = contexts[0]!;
    expect(first).toBeDefined();

    const bundle = await documentsService.listForStudent(DEMO_GUARDIAN_ACCOUNT_ID, first.student.id);

    expect(bundle.studentId).toBe(first.student.id);
    expect(bundle.studentRef).toBe(first.student.ref);
    expect(bundle.enrollmentRef).toBe(first.enrollment.ref);
    expect(bundle.gradeSectionLabel).toBe("Class 8-A");

    /* Report cards derive from the academics terms/publications. */
    expect(bundle.reportCards).toHaveLength(3);
    const term1 = bundle.reportCards.find((term) => term.termLabel === "Term 1");
    expect(term1?.publicationStatus).toBe("final");
    expect(term1?.publishedAtIso).toBe("2026-06-15T06:00:00Z");
    expect(term1?.version).toBe(2);
    const term3 = bundle.reportCards.find((term) => term.termLabel === "Term 3");
    expect(term3?.publicationStatus).toBe("not-published");
    expect(term3?.publishedAtIso).toBeNull();

    /* Receipts come from the finance ledger, scoped to this student. */
    expect(bundle.receipts.map((receipt) => receipt.ref)).toEqual(["RC-2026-0102", "RC-2026-0131"]);
    expect(bundle.receipts.every((receipt) => receipt.studentId === first.student.id)).toBe(true);

    /* Certificates have no records yet — the portal keeps its empty state. */
    expect(bundle.certificates).toEqual([]);
  });

  it("returns per-student rows: the second linked child gets its own receipts and references", async () => {
    const contexts = await accessibleContexts();
    expect(contexts).toHaveLength(2);
    const [first, second] = contexts;

    const bundleA = await documentsService.listForStudent(DEMO_GUARDIAN_ACCOUNT_ID, first!.student.id);
    const bundleB = await documentsService.listForStudent(DEMO_GUARDIAN_ACCOUNT_ID, second!.student.id);

    expect(bundleA.studentRef).not.toBe(bundleB.studentRef);
    expect(bundleA.enrollmentRef).not.toBe(bundleB.enrollmentRef);
    expect(bundleB.studentRef).toBe(second!.student.ref);
    expect(bundleB.enrollmentRef).toBe(second!.enrollment.ref);

    /* Mariam's ledger holds her own receipts — no cross-student rows. */
    expect(bundleB.receipts.map((receipt) => receipt.ref)).toEqual(["RC-2026-0124", "RC-2026-0138"]);
    expect(bundleB.receipts.every((receipt) => receipt.studentId === second!.student.id)).toBe(true);
    expect(bundleB.receipts.map((receipt) => receipt.ref)).not.toEqual(
      bundleA.receipts.map((receipt) => receipt.ref),
    );

    expect(bundleB.reportCards).toHaveLength(3);
    expect(bundleB.certificates).toEqual([]);
  });

  it("denies a student that is not linked to the account", async () => {
    await expect(
      documentsService.listForStudent(DEMO_GUARDIAN_ACCOUNT_ID, UNKNOWN_STUDENT_ID),
    ).rejects.toThrow(/not accessible/);
  });
});
