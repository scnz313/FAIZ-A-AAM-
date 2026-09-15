// @vitest-environment node
/**
 * Deterministic contract tests for the documents demo adapter
 * (modules/services/documents.ts). The bundle is per student: report cards
 * come from the academics service, receipts from the student-scoped finance
 * ledger, and student/enrollment references from the family context service.
 * The page itself imports no fixtures — it reads only the service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  DEMO_GUARDIAN_ACCOUNT_ID,
  familyContextService,
  RELATIONSHIPS_SESSION_KEY,
} from "@/modules/services/family-context";
import { FINANCE_SESSION_KEYS } from "@/modules/services/finance";
import {
  documentsService,
  generatedReportCardReleaseReference,
  isDocumentDownloadable,
  isDocumentMetadataDownloadable,
  isFamilyVisibleDocument,
  mapPrivateDocumentMetadata,
  normalizeDocumentProcessingState,
} from "@/modules/services/documents";
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

describe("documentsService private access states (S4)", () => {
  it("normalizes provider scan states into the private processing states", () => {
    expect(normalizeDocumentProcessingState("ready")).toBe("ready");
    expect(normalizeDocumentProcessingState("clean")).toBe("ready");
    expect(normalizeDocumentProcessingState("pending")).toBe("pending");
    expect(normalizeDocumentProcessingState("pending_scan")).toBe("pending");
    expect(normalizeDocumentProcessingState("uploading")).toBe("pending");
    expect(normalizeDocumentProcessingState("failed")).toBe("failed");
    expect(normalizeDocumentProcessingState("quarantine")).toBe("quarantined");
    expect(normalizeDocumentProcessingState("quarantined")).toBe("quarantined");
    expect(normalizeDocumentProcessingState("denied")).toBe("denied");
    expect(normalizeDocumentProcessingState("deleted")).toBe("expired");
    expect(normalizeDocumentProcessingState("expired")).toBe("expired");
    expect(normalizeDocumentProcessingState("unexpected-shape")).toBe("pending");
  });

  it("never exposes storage buckets or object keys in the UI metadata shape", () => {
    const meta = mapPrivateDocumentMetadata({
      reference: "DOC-2026-0001",
      owner_domain: "student",
      status: "ready",
      bucket: "private-docs",
      objectKey: "student/a/b.pdf",
      object_key: "student/a/b.pdf",
    } as unknown as Parameters<typeof mapPrivateDocumentMetadata>[0]);
    expect(meta.ref).toBe("DOC-2026-0001");
    expect(meta).not.toHaveProperty("bucket");
    expect(meta).not.toHaveProperty("objectKey");
    expect(meta).not.toHaveProperty("object_key");
    expect(Object.keys(meta).sort()).toEqual(
      [
        "attachmentCode", "category", "checksumVerified", "createdAtIso", "filename",
        "finalizationState", "finalizedAtIso", "mimeType", "ownerDomain", "ownerReference",
        "processingState", "ref", "retentionUntilIso", "scanState", "sizeBytes",
        "updatedAtIso", "version", "visibility",
      ].sort(),
    );
    expect(meta.visibility).toBe("private");
  });

  it("only ready documents are downloadable — quarantined/denied/expired/failed/pending never are", () => {
    expect(isDocumentDownloadable("ready")).toBe(true);
    for (const state of ["pending", "failed", "quarantined", "denied", "expired"] as const) {
      expect(isDocumentDownloadable(state)).toBe(false);
    }
    for (const status of ["quarantined", "denied", "expired", "failed", "pending_scan"] as const) {
      const meta = mapPrivateDocumentMetadata({ reference: "DOC-X", status });
      expect(isDocumentMetadataDownloadable(meta)).toBe(false);
    }
    const ready = mapPrivateDocumentMetadata({ reference: "DOC-R", status: "ready" });
    expect(isDocumentMetadataDownloadable(ready)).toBe(true);
  });

  it("demo mode never issues a download URL", async () => {
    const result = await documentsService.requestDownload("DOC-2026-0001");
    expect(result.state).not.toBe("ready");
    if (result.state !== "ready") {
      expect(result.message).toMatch(/demo mode/);
    }
  });
});

describe("documentsService family report-card visibility (supabase mode)", () => {
  const SERVER_ACCOUNT_ID = "00000000-0000-4000-8000-000000000010";
  const SERVER_STUDENT_ID = "00000000-0000-4000-8000-000000000777";
  const SERVER_STUDENT_REF = "STU-2026-0777";
  const SERVER_ENROLLMENT_REF = "ENR-2026-0777";
  const PUBLISHED_RELEASE_ID = "00000000-0000-4000-8000-000000001001";
  const PUBLISHED_RELEASE_REF = "RPR-2026-8A114E";
  const SUPERSEDED_RELEASE_REF = "RPR-2026-8E5549";

  const familyContext = {
    accountId: SERVER_ACCOUNT_ID,
    personId: "00000000-0000-4000-8000-000000000778",
    displayName: "Sana Wani",
    guardianId: "00000000-0000-4000-8000-000000000779",
    activeStudentId: SERVER_STUDENT_ID,
    activeEnrollmentId: "00000000-0000-4000-8000-000000000780",
    academicYearId: "00000000-0000-4000-8000-000000000781",
    contexts: [{
      student: { id: SERVER_STUDENT_ID, ref: SERVER_STUDENT_REF, displayName: "Ayaan Wani" },
      link: { id: "00000000-0000-4000-8000-000000000782", capabilities: ["documents"] },
      enrollment: { id: "00000000-0000-4000-8000-000000000780", ref: SERVER_ENROLLMENT_REF },
      gradeSection: { gradeLabel: "Class 8", sectionLabel: "A" },
      academicYear: { id: "00000000-0000-4000-8000-000000000781", label: "2026-27" },
    }],
  };

  const publishedRelease = {
    id: PUBLISHED_RELEASE_ID,
    reference: PUBLISHED_RELEASE_REF,
    term: "Term 1",
    status: "published",
    version: 1,
    publishedAt: "2026-06-15T06:00:00Z",
    items: [],
  };

  const supersededReportCard = {
    reference: "DOC-2026-B4EEBA",
    ownerDomain: "student",
    category: "generated_report_card",
    filename: `report-card-${SUPERSEDED_RELEASE_REF}.pdf`,
    status: "ready",
    mimeType: "application/pdf",
    sizeBytes: 4096,
  };

  const publishedReportCard = {
    reference: "DOC-2026-68FCDC",
    ownerDomain: "student",
    category: "generated_report_card",
    filename: `report-card-${PUBLISHED_RELEASE_REF}.pdf`,
    status: "ready",
    mimeType: "application/pdf",
    sizeBytes: 4096,
  };

  const uploadedStudentDocument = {
    reference: "DOC-2026-UPLOAD",
    ownerDomain: "student",
    category: "birth_certificate",
    filename: "birth-certificate.pdf",
    status: "ready",
    mimeType: "application/pdf",
    sizeBytes: 2048,
  };

  function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  }

  function stubAdapter(documents: unknown[]): void {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op } = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (op === "context.family") return json({ ok: true, value: familyContext });
      if (op === "results.listReleases") return json({ ok: true, value: [publishedRelease] });
      if (op === "finance.listReceipts") return json({ ok: true, value: [] });
      if (op === "documents.list") return json({ ok: true, value: documents });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${op}`, field: null }] }, 500);
    }));
  }

  beforeEach(() => {
    vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    /* The node environment refuses the browser gateway without a window; the
       stub mirrors the page runtime while `fetch` stays fully stubbed. */
    vi.stubGlobal("window", {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads the source release reference from the canonical generated report-card filename", () => {
    expect(generatedReportCardReleaseReference({ category: "generated_report_card", filename: `report-card-${SUPERSEDED_RELEASE_REF}.pdf` }))
      .toBe(SUPERSEDED_RELEASE_REF);
    expect(generatedReportCardReleaseReference({ category: "generated_receipt", filename: "receipt-RCP-2026-1.pdf" })).toBeNull();
    expect(generatedReportCardReleaseReference({ category: "generated_report_card", filename: "uploaded-report.pdf" })).toBeNull();
  });

  it("withholds a generated report card unless its release is currently published", () => {
    const publishedReferences = new Set([PUBLISHED_RELEASE_REF]);
    expect(isFamilyVisibleDocument(publishedReportCard, publishedReferences)).toBe(true);
    expect(isFamilyVisibleDocument(supersededReportCard, publishedReferences)).toBe(false);
    expect(isFamilyVisibleDocument(uploadedStudentDocument, publishedReferences)).toBe(true);
  });

  it("omits the superseded report card from the family bundle while keeping published and ordinary files", async () => {
    stubAdapter([supersededReportCard, publishedReportCard, uploadedStudentDocument]);

    const bundle = await documentsService.listForStudent(SERVER_ACCOUNT_ID, SERVER_STUDENT_ID);

    const refs = (bundle.metadata ?? []).map((document) => document.ref);
    expect(refs).toEqual(["DOC-2026-68FCDC", "DOC-2026-UPLOAD"]);
    expect(refs).not.toContain("DOC-2026-B4EEBA");

    /* The report-card panel derives from published releases, and the
       family-visible generated report-card files must match that count. */
    expect(bundle.reportCards.map((card) => card.publicationRef)).toEqual([PUBLISHED_RELEASE_REF]);
    expect((bundle.metadata ?? []).filter((document) => document.category === "generated_report_card")).toHaveLength(bundle.reportCards.length);
  });
});
