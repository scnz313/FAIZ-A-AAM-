import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { familyContextService } from "@/modules/services/family-context";
import { staffContextService } from "@/modules/services/staff-context";

const AARIF_ID = "00000000-0000-4000-8000-000000000901";
const MARIAM_ID = "00000000-0000-4000-8000-000000000902";
const UNLINKED_ID = "00000000-0000-4000-8000-000000009999";
const FINANCE_GRANT_ID = "00000000-0000-4000-8000-000000000304";
const PUBLISHER_GRANT_ID = "00000000-0000-4000-8000-000000000305";

const FAMILY_RESPONSE = {
  accountId: "00000000-0000-4000-8000-000000000201",
  personId: "00000000-0000-4000-8000-000000000101",
  displayName: "Firdous Ahmad",
  guardianId: "00000000-0000-4000-8000-000000001001",
  activeStudentId: AARIF_ID,
  activeEnrollmentId: "00000000-0000-4000-8000-000000001202",
  academicYearId: "00000000-0000-4000-8000-000000000602",
  contexts: [
    {
      student: { id: AARIF_ID, ref: "STU-2026-0901", personId: "00000000-0000-4000-8000-000000000103", status: "active", displayName: "Aarif Hussain" },
      link: { id: "00000000-0000-4000-8000-000000001101", ref: "LINK-2026-1101", guardianId: "00000000-0000-4000-8000-000000001001", studentId: AARIF_ID, relationshipLabel: "Parent", status: "active", verificationSource: "staff_review", approvedByPersonId: null, approvedAtIso: null, effectiveFromIso: "2026-07-01T08:30:00.000Z", effectiveToIso: null, restrictionReason: null, rejectionReason: null, contactPriority: 1, isEmergencyContact: true, isBillingContact: true, capabilities: ["academics", "finance", "documents", "notices", "profile"], version: 1 },
      enrollment: { id: "00000000-0000-4000-8000-000000001202", ref: "ENR-2026-1202", studentId: AARIF_ID, academicYearId: "00000000-0000-4000-8000-000000000602", gradeSectionId: "00000000-0000-4000-8000-000000000702", status: "active", effectiveFromIso: "2026-04-01T08:00:00.000Z", effectiveToIso: null },
      gradeSection: { id: "00000000-0000-4000-8000-000000000702", ref: "SEC-2026-8A", gradeLabel: "Class 8", sectionLabel: "A", academicYearId: "00000000-0000-4000-8000-000000000602", status: "active" },
      academicYear: { id: "00000000-0000-4000-8000-000000000602", ref: "AY-2026-27", label: "2026–27", startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current" },
    },
    {
      student: { id: MARIAM_ID, ref: "STU-2026-0902", personId: "00000000-0000-4000-8000-000000000104", status: "active", displayName: "Mariam Hussain" },
      link: { id: "00000000-0000-4000-8000-000000001102", ref: "LINK-2026-1102", guardianId: "00000000-0000-4000-8000-000000001001", studentId: MARIAM_ID, relationshipLabel: "Parent", status: "active", verificationSource: "enrollment_invitation", approvedByPersonId: null, approvedAtIso: null, effectiveFromIso: "2026-07-01T08:45:00.000Z", effectiveToIso: null, restrictionReason: null, rejectionReason: null, contactPriority: 2, isEmergencyContact: false, isBillingContact: true, capabilities: ["academics", "finance", "documents", "notices", "profile"], version: 1 },
      enrollment: { id: "00000000-0000-4000-8000-000000001204", ref: "ENR-2026-1204", studentId: MARIAM_ID, academicYearId: "00000000-0000-4000-8000-000000000602", gradeSectionId: "00000000-0000-4000-8000-000000000702", status: "active", effectiveFromIso: "2026-04-01T08:00:00.000Z", effectiveToIso: null },
      gradeSection: { id: "00000000-0000-4000-8000-000000000702", ref: "SEC-2026-8A", gradeLabel: "Class 8", sectionLabel: "A", academicYearId: "00000000-0000-4000-8000-000000000602", status: "active" },
      academicYear: { id: "00000000-0000-4000-8000-000000000602", ref: "AY-2026-27", label: "2026–27", startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current" },
    },
  ],
};

const STAFF_RESPONSE = {
  accountId: "00000000-0000-4000-8000-000000000203",
  personId: "00000000-0000-4000-8000-000000000106",
  displayName: "Sana Wani",
  title: "Finance officer",
  staffMemberId: "00000000-0000-4000-8000-000000000402",
  activeRoleGrantId: FINANCE_GRANT_ID,
  activeRole: "finance_officer",
  grantedWorkspaceCount: 2,
  grants: [
    { id: FINANCE_GRANT_ID, reference: "ROLE-2026-0304", account_id: "00000000-0000-4000-8000-000000000203", role_code: "finance_officer", status: "active", granted_by_account_id: null, reason: "Finance", effective_from: "2026-01-01T00:00:00.000Z", effective_to: null, version: 1 },
    { id: PUBLISHER_GRANT_ID, reference: "ROLE-2026-0305", account_id: "00000000-0000-4000-8000-000000000203", role_code: "result_publisher", status: "active", granted_by_account_id: null, reason: "Results", effective_from: "2026-01-01T00:00:00.000Z", effective_to: null, version: 1 },
  ],
  assignments: [],
  academicYear: { id: "00000000-0000-4000-8000-000000000602", reference: "AY-2026-27", label: "2026–27", starts_on: "2026-04-01", ends_on: "2027-03-31", status: "current" },
};

function jsonResponse(value: unknown, status = 200): Response {
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

describe("Supabase family/staff context contracts", () => {
  it("hydrates family context, persists explicit child selection in the request payload, and never falls back", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload?: { studentId?: string } };
      if (body.op === "context.family" && body.payload?.studentId === UNLINKED_ID) {
        return jsonResponse({ ok: false, errors: [{ code: "forbidden", message: "That student is not linked.", field: null }] }, 403);
      }
      if (body.op === "context.family") {
        return jsonResponse({
          ok: true,
          value: body.payload?.studentId === MARIAM_ID
            ? { ...FAMILY_RESPONSE, activeStudentId: MARIAM_ID, activeEnrollmentId: "00000000-0000-4000-8000-000000001204" }
            : FAMILY_RESPONSE,
        });
      }
      return jsonResponse({ ok: false, errors: [{ code: "unavailable", message: "Unexpected operation.", field: null }] }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const contexts = await familyContextService.listAccessibleStudentContexts("server");
    expect(contexts).toHaveLength(2);
    expect((await familyContextService.getContext("server")).activeStudentId).toBe(AARIF_ID);
    expect((await familyContextService.setActiveStudent("server", MARIAM_ID)).activeStudentId).toBe(MARIAM_ID);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/adapter",
      expect.objectContaining({ body: JSON.stringify({ op: "context.family", payload: { studentId: MARIAM_ID } }) }),
    );

    await expect(familyContextService.setActiveStudent("server", UNLINKED_ID)).rejects.toMatchObject({
      code: "student-not-linked",
    });
    expect(await familyContextService.classifyStudentAccess("server", UNLINKED_ID)).toBe("none");
  });

  it("keeps staff workspace scope request-bound and denies AAL/scope failures", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload?: { roleGrantId?: string } };
      if (body.op === "context.staff" && body.payload?.roleGrantId === PUBLISHER_GRANT_ID) {
        return jsonResponse({ ok: true, value: { ...STAFF_RESPONSE, activeRoleGrantId: PUBLISHER_GRANT_ID, activeRole: "result_publisher" } });
      }
      if (body.op === "context.staff") return jsonResponse({ ok: true, value: STAFF_RESPONSE });
      return jsonResponse({ ok: false, errors: [{ code: "unavailable", message: "Unexpected operation.", field: null }] }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    expect((await staffContextService.getWorkspace("server")).activeRole).toBe("finance_officer");
    expect((await staffContextService.setActiveWorkspace("server", PUBLISHER_GRANT_ID)).activeRole).toBe("result_publisher");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/adapter",
      expect.objectContaining({ body: JSON.stringify({ op: "context.staff", payload: { roleGrantId: PUBLISHER_GRANT_ID } }) }),
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, errors: [{ code: "forbidden", message: "AAL2 required.", field: null }] }, 403));
    await expect(staffContextService.getWorkspace("server")).rejects.toMatchObject({ code: "workspace-not-granted" });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, errors: [{ code: "forbidden", message: "Wrong workspace scope.", field: null }] }, 403));
    await expect(staffContextService.setActiveWorkspace("server", UNLINKED_ID)).rejects.toMatchObject({ code: "workspace-not-granted" });
  });
});
