import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEnrollmentReadiness, convertApplication } from "@/modules/services/enrollment";

const APP_ID = "00000000-0000-4000-8000-00000000a001";
const APP_REF = "APP-2026-0501";

const admissionRow = {
  id: APP_ID,
  reference: APP_REF,
  academic_year_id: "00000000-0000-4000-8000-000000000602",
  grade_id: "00000000-0000-4000-8000-000000000708",
  current_status: "offered",
  student_name: "Test Child",
  parent_name: "Test Guardian",
  parent_contact: null,
  version: 1,
  submitted_at: "2026-08-10T05:00:00.000Z",
  created_at: "2026-08-10T05:00:00.000Z",
  academic_years: { label: "2026–27", starts_on: "2026-04-01", ends_on: "2027-03-31", status: "current" },
  grades: { label: "Class 8" },
  admission_drafts: [],
  admission_application_versions: [],
  admission_events: [],
  admission_offers: [{ id: "00000000-0000-4000-8000-00000000b001", grade_id: "00000000-0000-4000-8000-000000000708", academic_year_id: "00000000-0000-4000-8000-000000000602", conditions: {}, expires_at: "2026-09-01T00:00:00.000Z", fee_required: true, admission_invoice_ref: "INV-2026-0501", response: "accepted", responded_at: "2026-08-10T05:00:00.000Z", decided_by_account_id: "00000000-0000-4000-8000-00000000c001", version: 1 }],
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("enrollment Supabase facade", () => {
  it("maps authoritative readiness and idempotent conversion projections", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "admissions.listMine") return json({ ok: true, value: [admissionRow] });
      if (request.op === "enrollment.readiness") {
        return json({ ok: true, value: { applicationRef: APP_REF, offered: true, accepted: true, admissionInvoiceRef: "INV-2026-0501", feePaid: true, documentsComplete: true, capacityAvailable: true, finalApproved: true } });
      }
      if (request.op === "enrollment.convert") {
        return json({ ok: true, value: { application: APP_REF, student: "00000000-0000-4000-8000-00000000d001", studentRef: "STU-2026-0904", enrollment: "00000000-0000-4000-8000-00000000d002", enrollmentRef: "ENR-2026-1206", guardian_link: "00000000-0000-4000-8000-00000000d003", matched_existing: true } });
      }
      if (request.op === "finance.listInvoices") return json({ ok: true, value: [] });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] });
    }));

    await expect(getEnrollmentReadiness(APP_REF)).resolves.toMatchObject({ ready: true, feePaid: true });
    await expect(convertApplication(APP_REF)).resolves.toMatchObject({ studentRef: "STU-2026-0904", matchedExisting: true, portalAvailable: true });
  });
});
