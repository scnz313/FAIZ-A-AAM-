import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { admissionsService, type ApplicationDraft } from "@/modules/services/admissions";

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

  it("does not fall back to demo records when the owner is denied", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ok: false, errors: [{ code: "forbidden", message: "not the application owner", field: null }] }, 403)),
    );
    await expect(admissionsService.getApplication(APP_REF)).rejects.toThrow(/application owner/);
  });
});
