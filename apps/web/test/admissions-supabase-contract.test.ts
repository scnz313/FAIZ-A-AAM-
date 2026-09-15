import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdmissionsQueue } from "@/components/staff/AdmissionsQueue";
import { ApplicationReview } from "@/components/staff/ApplicationReview";
import {
  admissionsService,
  type ApplicationDraft,
  type StaffQueueRecord,
} from "@/modules/services/admissions";

vi.mock("@/components/staff/StaffContextProvider", () => ({
  useStaffContext: () => ({ summary: null }),
}));

const APP_ID = "00000000-0000-4000-8000-00000000a001";
const YEAR_ID = "00000000-0000-4000-8000-000000000602";
const GRADE_ID = "00000000-0000-4000-8000-000000000708";
const APP_REF = "APP-2026-0501";

const draft: ApplicationDraft = {
  session: "2026-27",
  grade: "Class 8",
  studentName: "Test Child",
  dob: "2015-01-01",
  gender: "Male",
  placeOfBirth: "Bandipora",
  guardianName: "Test Guardian",
  relation: "Parent",
  phone: "+919419001001",
  email: "guardian@example.test",
  occupation: "Teacher",
  houseStreet: "School Road",
  villageTown: "Bandipora",
  district: "Bandipora",
  pin: "193502",
  priorSchoolName: "Previous School",
  lastClassAttended: "Class 7",
  leavingCertificate: "",
  conditions: [],
  documents: { birth: "birth.pdf", photo: "photo.jpg", reportCard: "report.pdf", addressProof: "address.pdf" },
  consent: true,
};

const config = {
  academicYears: [{ id: YEAR_ID, ref: "AY-2026-27", label: "2026–27", startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current" }],
  grades: [{ id: GRADE_ID, code: "8", label: "Class 8", sortOrder: 8 }],
  gradeSections: [],
  subjects: [],
  periods: [],
  policy: { version: 1, status: "policy_pending", values: {} },
};

const INITIAL_APPLICATION: StaffQueueRecord = {
  ref: APP_REF,
  session: "2026-27",
  grade: "Class 8",
  studentName: "Server Child",
  parentName: "Server Guardian",
  contact: "+919419001001",
  submittedAtIso: "2026-08-10T05:00:00.000Z",
  status: "Submitted",
  timeline: [{ status: "Submitted", atIso: "2026-08-10T05:00:00.000Z", actor: "Applicant", note: "Submitted" }],
  reviewer: "Admissions officer",
};

function row(status = "offered") {
  return {
    id: APP_ID,
    reference: APP_REF,
    academic_year_id: YEAR_ID,
    grade_id: GRADE_ID,
    current_status: status,
    student_name: "Test Child",
    parent_name: "Test Guardian",
    parent_contact: "+919419001001",
    version: 1,
    submitted_at: "2026-08-10T05:00:00.000Z",
    created_at: "2026-08-10T05:00:00.000Z",
    academic_years: { label: "2026–27", starts_on: "2026-04-01", ends_on: "2027-03-31", status: "current" },
    grades: { label: "Class 8" },
    admission_drafts: [],
    admission_application_versions: [],
    admission_events: [{ event_type: "submitted", visible_to_applicant: true, copy: "Application submitted", created_at: "2026-08-10T05:00:00.000Z" }],
    admission_offers: [{ id: "00000000-0000-4000-8000-00000000b001", grade_id: GRADE_ID, academic_year_id: YEAR_ID, conditions: { admissionFeePaise: 500000 }, expires_at: "2026-09-01T00:00:00.000Z", fee_required: true, admission_invoice_ref: null, response: "pending", responded_at: null, decided_by_account_id: "00000000-0000-4000-8000-00000000c001", version: 1 }],
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("admissions Supabase facade", () => {
  it("saves a server draft, submits by authoritative ref, reads status, and responds to an offer", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      switch (request.op) {
        case "config.read":
          return json({ ok: true, value: config });
        case "admissions.saveDraft":
          return json({ ok: true, value: { id: APP_ID, reference: APP_REF, version: 0, status: "draft", updatedAt: "2026-08-10T05:00:00.000Z" } });
        case "admissions.submit":
          return json({ ok: true, value: { versionId: "00000000-0000-4000-8000-00000000d001" } });
        case "admissions.listMine":
          return json({ ok: true, value: [row()] });
        case "admissions.respondOffer":
          return json({ ok: true, value: { invoiceRef: "INV-2026-0501" } });
        default:
          return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
      }
    });
    vi.stubGlobal("fetch", fetchMock);

    const saved = await admissionsService.saveDraft("new", draft);
    expect(saved.draftRef).toBe(APP_REF);
    expect(await admissionsService.submitApplication(draft, saved.draftRef)).toEqual({ ref: APP_REF });
    expect((await admissionsService.getApplication(APP_REF))?.status).toBe("Offered");
    const responded = await admissionsService.respondToOffer(APP_REF, true, "Applicant");
    expect(responded.ref).toBe(APP_REF);
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).op)).toContain("admissions.submit");
  });

  it("restores a draft saved as a to-one embed (live PostgREST shape)", async () => {
    /* admission_drafts.application_id is UNIQUE, so PostgREST returns an
       object; the previous array-only read silently lost every saved draft. */
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
        if (request.op === "admissions.listMine") {
          return json({
            ok: true,
            value: [{
              ...row("draft"),
              admission_drafts: {
                draft: { ...draft, studentName: "Restored Child" },
                schema_version: 1,
                expires_at: "2026-12-01T00:00:00.000Z",
                updated_at: "2026-08-10T05:00:00.000Z",
              },
              admission_offers: null,
            }],
          });
        }
        return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
      }),
    );

    const restored = await admissionsService.getDraft(APP_REF);
    expect(restored?.studentName).toBe("Restored Child");
    expect(restored?.documents).toEqual(draft.documents);
  });

  it("does not fall back to demo records when the owner is denied", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ok: false, errors: [{ code: "forbidden", message: "not the application owner", field: null }] }, 403)),
    );
    await expect(admissionsService.getApplication(APP_REF)).rejects.toThrow(/application owner/);
  });

  it("responds to an offer on a cold session without a prior status load", async () => {
    /* Regression: respondToOffer used to read serverAdmissionIds before
       serverApplicationByRef populated it, so the first response in a fresh
       browser session always failed with "Application offer not found." */
    vi.resetModules();
    const ops: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
        ops.push(request.op);
        switch (request.op) {
          case "admissions.listMine":
            return json({ ok: true, value: [row()] });
          case "admissions.respondOffer":
            return json({ ok: true, value: { invoiceRef: "INV-2026-0501" } });
          default:
            return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
        }
      }),
    );
    const fresh = await import("@/modules/services/admissions");
    const responded = await fresh.admissionsService.respondToOffer(APP_REF, true, "Applicant");
    expect(responded.ref).toBe(APP_REF);
    expect(ops).toContain("admissions.respondOffer");
  });

  it("resolves a duplicate identity review with the recorded candidate and version", async () => {
    const CANDIDATE_ID = "00000000-0000-4000-8000-00000000c001";
    const duplicateRow = {
      ...row("duplicate_review"),
      admission_duplicate_reviews: [{
        status: "pending",
        candidate_student_id: CANDIDATE_ID,
        reference: "DUP-2026-0001",
        reason: null,
        reviewed_at: null,
        students: { reference: "STU-2026-0001", people: { display_name: "Existing Child" } },
      }],
    };
    const ops: Array<{ op: string; payload: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload: Record<string, unknown> };
        ops.push(request);
        switch (request.op) {
          case "admissions.staffByRef":
            return json({ ok: true, value: duplicateRow });
          case "admissions.resolveDuplicateReview":
            return json({ ok: true, value: { applicationRef: APP_REF, status: "approved", evidenceRef: "EVID-2026-0001" } });
          default:
            return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
        }
      }),
    );

    const updated = await admissionsService.resolveDuplicateReview(APP_REF, {
      outcome: "approved",
      reason: "Birth certificate matches the existing record.",
      expectedVersion: 1,
    });
    const resolveCall = ops.find((entry) => entry.op === "admissions.resolveDuplicateReview");
    expect(resolveCall?.payload.candidateStudentId).toBe(CANDIDATE_ID);
    expect(resolveCall?.payload.outcome).toBe("approved");
    expect(resolveCall?.payload.expectedVersion).toBe(1);
    expect(resolveCall?.payload.evidenceType).toBe("staff_review");
    expect(updated.ref).toBe(APP_REF);
    /* A decision refresh is one bounded record read; the queue is never listed again. */
    expect(ops.map((entry) => entry.op)).toEqual(["admissions.staffByRef", "admissions.resolveDuplicateReview", "admissions.staffByRef"]);
    expect(ops.some((entry) => entry.op === "admissions.staffQueue")).toBe(false);
  });

  it("resolves reviewer names through the reviewer directory by public reference", async () => {
    const ops: Array<{ op: string; payload: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload: Record<string, unknown> };
        ops.push(request);
        if (request.op === "admissions.reviewerDirectory") {
          return json({
            ok: true,
            value: [
              { accountId: "00000000-0000-4000-8000-00000000e001", displayName: "Aaliya Khan" },
              { accountId: "00000000-0000-4000-8000-00000000e002", displayName: "Bilal Mir" },
            ],
          });
        }
        return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
      }),
    );

    const directory = await admissionsService.reviewerDirectory(APP_REF);
    const call = ops.find((entry) => entry.op === "admissions.reviewerDirectory");
    expect(call?.payload.applicationRef).toBe(APP_REF);
    expect(call?.payload).not.toHaveProperty("applicationId");
    expect(directory).toEqual({
      "00000000-0000-4000-8000-00000000e001": "Aaliya Khan",
      "00000000-0000-4000-8000-00000000e002": "Bilal Mir",
    });
  });

  it("refreshes a staff decision from one bounded record read, never the queue", async () => {
    const ops: Array<{ op: string; payload: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload: Record<string, unknown> };
        ops.push(request);
        switch (request.op) {
          case "admissions.staffByRef":
            return json({ ok: true, value: row("under_review") });
          case "admissions.reviewAdvance":
            return json({ ok: true, value: { ok: true } });
          default:
            return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
        }
      }),
    );

    const updated = await admissionsService.staffStartReview(APP_REF, "Documents verified.", undefined, 1);
    expect(updated.ref).toBe(APP_REF);
    expect(ops.map((entry) => entry.op)).toEqual(["admissions.reviewAdvance", "admissions.staffByRef"]);
    expect(ops.find((entry) => entry.op === "admissions.reviewAdvance")?.payload.expectedVersion).toBe(1);
  });

  it("lists the applicant's own applications and never falls back to the staff queue", async () => {
    const ops: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
        ops.push(request.op);
        return json({ ok: true, value: [row()] });
      }),
    );

    const list = await admissionsService.listMyApplications();
    expect(list).toHaveLength(1);
    expect(list[0]?.ref).toBe(APP_REF);

    const single = await admissionsService.getApplication(APP_REF);
    expect(single?.ref).toBe(APP_REF);
    expect(ops.filter((op) => op === "admissions.staffQueue")).toHaveLength(0);
  });

  it("re-reads the public conversion references for an enrolled application", async () => {
    const ops: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
        ops.push(request.op);
        switch (request.op) {
          case "admissions.listMine":
            return json({ ok: true, value: [row("enrolled")] });
          case "admissions.enrollmentReference":
            return json({ ok: true, value: { studentRef: "STU-2026-0001", enrollmentRef: "ENR-2026-0001", linkRef: "LINK-2026-0001", matchedExisting: false } });
          default:
            return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
        }
      }),
    );

    const record = await admissionsService.getApplication(APP_REF);
    expect(record?.studentRef).toBe("STU-2026-0001");
    expect(record?.enrollmentRef).toBe("ENR-2026-0001");
    expect(record?.linkRef).toBe("LINK-2026-0001");
    expect(ops).toContain("admissions.enrollmentReference");
  });

  it("does not request conversion references for a non-enrolled application", async () => {
    const ops: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
        ops.push(request.op);
        return json({ ok: true, value: [row()] });
      }),
    );

    const record = await admissionsService.getApplication(APP_REF);
    expect(record?.studentRef).toBeUndefined();
    expect(ops).not.toContain("admissions.enrollmentReference");
  });
});

describe("server-hydrated admissions components", () => {
  it("paints the Supabase queue from SSR, silently refreshes it once, and trusts not-found props", async () => {
    const list = vi.spyOn(admissionsService, "listStaffRecords").mockResolvedValue([
      { ...INITIAL_APPLICATION, status: "Assessment" },
    ]);
    const get = vi.spyOn(admissionsService, "getApplication").mockResolvedValue(null);

    const queue = render(createElement(AdmissionsQueue, { rows: [INITIAL_APPLICATION] }));
    expect(screen.getAllByText((content, element) => element?.textContent?.includes("Server Child") ?? false).length).toBeGreaterThan(0);
    expect(list).toHaveBeenCalledTimes(1);

    /* The silent re-read replaces the SSR rows without a loading state. */
    await waitFor(() =>
      expect(screen.getAllByText((content, element) => element?.textContent?.includes("Assessment") ?? false).length).toBeGreaterThan(0),
    );
    queue.unmount();

    render(createElement(ApplicationReview, { applicationRef: "APP-2026-MISSING", initial: null }));
    expect(screen.getByText("Application not found")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("renders the real attached documents and never the empty note", () => {
    vi.spyOn(admissionsService, "reviewerDirectory").mockResolvedValue({});
    const initial: StaffQueueRecord = {
      ...INITIAL_APPLICATION,
      status: "Offered",
      documents: [{
        requirementCode: "birth",
        reference: "DOC-2026-0101",
        filename: "birth-certificate.pdf",
        category: "birth",
        scanStatus: "ready",
        mimeType: "application/pdf",
        sizeBytes: 4096,
        uploadedAtIso: "2026-08-10T05:00:00.000Z",
        finalizedAtIso: "2026-08-10T05:01:00.000Z",
      }],
    };

    render(createElement(ApplicationReview, { applicationRef: APP_REF, initial }));

    expect(screen.queryByText(/No documents have been attached/)).toBeNull();
    expect(screen.getByText(/birth-certificate\.pdf/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open file" })).toHaveAttribute("href", "/api/documents/DOC-2026-0101");
  });

  it("renders the configured requirement label instead of the derived code", () => {
    vi.spyOn(admissionsService, "reviewerDirectory").mockResolvedValue({});
    const initial: StaffQueueRecord = {
      ...INITIAL_APPLICATION,
      status: "Offered",
      documents: [{
        requirementCode: "addressProof",
        reference: "DOC-2026-0102",
        filename: "address-proof.pdf",
        category: "addressProof",
        scanStatus: "ready",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        uploadedAtIso: "2026-08-10T05:00:00.000Z",
        finalizedAtIso: "2026-08-10T05:01:00.000Z",
      }],
    };

    render(createElement(ApplicationReview, {
      applicationRef: APP_REF,
      initial,
      documentLabels: { addressProof: "Address proof" },
    }));

    expect(screen.getByText(/Address proof/)).toBeInTheDocument();
    expect(screen.queryByText(/AddressProof/)).toBeNull();
  });

  it("shows the honest empty note when no document is attached", () => {
    vi.spyOn(admissionsService, "reviewerDirectory").mockResolvedValue({});
    render(createElement(ApplicationReview, { applicationRef: APP_REF, initial: { ...INITIAL_APPLICATION, documents: [] } }));

    expect(screen.getByText(/No documents have been attached/)).toBeInTheDocument();
  });

  it("keeps the SSR Supabase queue rows when the silent refresh fails", async () => {
    const list = vi.spyOn(admissionsService, "listStaffRecords").mockRejectedValue(new Error("offline"));

    render(createElement(AdmissionsQueue, { rows: [INITIAL_APPLICATION] }));

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText((content, element) => element?.textContent?.includes("Server Child") ?? false).length).toBeGreaterThan(0);
  });

  it("labels each queue row with the application session, not the submission year", async () => {
    const queueRow: StaffQueueRecord = { ...INITIAL_APPLICATION, session: "2027–28", submittedAtIso: "2026-08-10T05:00:00.000Z" };
    vi.spyOn(admissionsService, "listStaffRecords").mockResolvedValue([queueRow]);

    render(createElement(AdmissionsQueue, { rows: [queueRow] }));

    expect(screen.getByText(/session 2027–28/)).toBeInTheDocument();
    expect(screen.queryByText(/session 2026\b/)).toBeNull();
  });

  it("keeps the demo queue mount refresh", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "demo");
    const list = vi.spyOn(admissionsService, "listStaffRecords").mockResolvedValue([INITIAL_APPLICATION]);

    render(createElement(AdmissionsQueue, { rows: [] }));

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText((content, element) => element?.textContent?.includes("Server Child") ?? false).length).toBeGreaterThan(0);
  });
});
