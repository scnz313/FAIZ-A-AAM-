import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CareersQueue } from "@/components/staff/CareersQueue";
import { JobReview } from "@/components/staff/JobReview";
import { careersService, type JobApplicationRecord } from "@/modules/services/careers";
import { contentService } from "@/modules/services/content";
import { auditService } from "@/modules/services/audit";
import { notificationsService } from "@/modules/services/notifications";
import { settingsService } from "@/modules/services/settings";
import { supportService } from "@/modules/services/support";

vi.mock("@/components/staff/StaffContextProvider", () => ({
  useStaffContext: () => ({ summary: null }),
}));

const APP_ID = "00000000-0000-4000-8000-00000000e101";
const JOB_REF = "JOB-2026-0101";
const VERSION_ID = "00000000-0000-4000-8000-00000000e102";
const VACANCY_ID = "00000000-0000-4000-8000-00000000e103";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

const jobRow = { id: APP_ID, reference: JOB_REF, applicant_name: "Test Applicant", owner_account_id: "00000000-0000-4000-8000-000000000001", vacancy_id: VACANCY_ID, current_status: "draft", version: 0, created_at: "2026-08-10T05:00:00.000Z", job_vacancies: { title: "Teacher - Mathematics", reference: "VAC-2026-0101" }, job_application_versions: [], job_events: [], job_interviews: [] };

const INITIAL_JOB: JobApplicationRecord = {
  ref: JOB_REF,
  vacancySlug: "teacher-mathematics",
  name: "Server Candidate",
  submittedAtIso: "2026-08-10T05:00:00.000Z",
  status: "Submitted",
  timeline: [{ status: "Submitted", atIso: "2026-08-10T05:00:00.000Z", actor: "Applicant", note: "Submitted" }],
};

beforeEach(() => {
  vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("C2.4 Supabase facade contracts", () => {
  it("persists career drafts through the server row and never the demo session", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "jobs.vacancies") return json({ ok: true, value: [{ vacancyId: VACANCY_ID, versionId: VERSION_ID, reference: "VAC-2026-0101", title: "Teacher - Mathematics", department: "Academics", terms: {} }] });
      if (request.op === "jobs.listMine") return json({ ok: true, value: [jobRow] });
      if (request.op === "jobs.saveDraft") return json({ ok: true, value: { updatedAt: "2026-08-10T05:10:00.000Z" } });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(careersService.saveDraft("teacher-mathematics", { fullName: "Test Applicant", phone: "", email: "", qualification: "", subject: "", year: "", institution: "", experience: "", currentRole: "", location: "", message: "", consent: true })).resolves.toMatchObject({ savedAtIso: expect.any(String) });
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).op)).toContain("jobs.saveDraft");
  });

  it("creates a draft from the public vacancy version id, never an authenticated vacancy lookup", async () => {
    const operations: Array<{ op: string; payload: Record<string, unknown> }> = [];
    let created = false;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload: Record<string, unknown> };
      operations.push(request);
      if (request.op === "jobs.vacancies") return json({ ok: true, value: [{ vacancyId: VACANCY_ID, versionId: VERSION_ID, reference: "VAC-2026-0101", title: "Teacher - Mathematics", department: "Academics", terms: {} }] });
      if (request.op === "jobs.listMine") return created ? json({ ok: true, value: [jobRow] }) : json({ ok: true, value: [] });
      if (request.op === "jobs.createDraft") {
        created = true;
        return json({ ok: true, value: { id: APP_ID, ref: JOB_REF, version: 0 } });
      }
      if (request.op === "jobs.saveDraft") return json({ ok: true, value: { updatedAt: "2026-08-10T05:10:00.000Z" } });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
    }));
    await careersService.saveDraft("teacher-mathematics", { fullName: "Test Applicant", phone: "", email: "", qualification: "", subject: "", year: "", institution: "", experience: "", currentRole: "", location: "", message: "", consent: true });
    const create = operations.find((entry) => entry.op === "jobs.createDraft");
    expect(create?.payload).toMatchObject({ vacancyVersionId: VERSION_ID });
    expect(create?.payload).not.toHaveProperty("vacancyRef");
  });

  it("loads the staff detail from the queue projection that carries reviewer and scorecard evidence", async () => {
    const requestedOps: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      requestedOps.push(request.op);
      if (request.op === "jobs.staffQueue") return json({ ok: true, value: [jobRow] });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
    }));
    await expect(careersService.getApplication(JOB_REF)).resolves.toMatchObject({ ref: JOB_REF });
    expect(requestedOps).toEqual(["jobs.staffQueue"]);
  });

  it("maps settings, notifications, audit, and support projections from the server", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "settings.read") return json({ ok: true, value: { version: 2, status: "effective", policy: { gradingScheme: "A1-E2", academicYears: [{ label: "2026-27", status: "current" }] }, changed_by_account_id: "Aisha", created_at: "2026-08-10T05:00:00.000Z" } });
      if (request.op === "notifications.list") return json({ ok: true, value: [{ id: "n1", kind: "Notice", title: "School notice", body: null, target_reference: null, read_at: null, created_at: "2026-08-10T05:00:00.000Z" }] });
      if (request.op === "audit.list") return json({ ok: true, value: [{ reference: "AUD-1", actor_label: "Aisha", action: "Login", target_reference: "—", outcome: "Success", reason: null, created_at: "2026-08-10T05:00:00.000Z" }] });
      if (request.op === "support.list") return json({ ok: true, value: [{ id: "s1", reference: "SR-1", category: "fees", subject: "Question", status: "open", requester_name: "Parent", requester_contact: "+919000000000", created_at: "2026-08-10T05:00:00.000Z", support_messages: [{ body: "Help", is_staff: false, created_at: "2026-08-10T05:00:00.000Z" }] }] });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
    }));
    await expect(settingsService.getSettings()).resolves.toMatchObject({ resultsPolicy: { gradingScheme: "A1-E2" } });
    await expect(notificationsService.listForAccount("account")).resolves.toMatchObject([{ id: "n1", unread: true }]);
    await expect(auditService.listEvents()).resolves.toMatchObject([{ id: "AUD-1", actor: "Aisha" }]);
    await expect(supportService.getGrievance("SR-1")).resolves.toMatchObject({ ref: "SR-1", subject: "Question" });
  });

  it("fails closed for public support when the route denies intake", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, errors: [{ code: "unavailable", message: "rate limit reached", field: null }] }, 429)));
    await expect(supportService.submitGrievance({ category: "Other", subject: "Question", message: "Help", contactName: "Parent", contactPhone: "+919000000000" })).rejects.toThrow(/rate limit/);
  });
});

describe("server-hydrated careers components", () => {
  it("uses authoritative Supabase queue and detail props without duplicate reads", () => {
    const list = vi.spyOn(careersService, "listStaffRecords").mockResolvedValue([]);
    const get = vi.spyOn(careersService, "getApplication").mockResolvedValue(null);

    const queue = render(
      createElement(CareersQueue, {
        initial: [INITIAL_JOB],
        vacancyTitles: { "teacher-mathematics": "Teacher - Mathematics" },
        demoMode: false,
      }),
    );
    expect(screen.getByText("Server Candidate")).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    queue.unmount();

    render(createElement(JobReview, {
      applicationRef: JOB_REF,
      initial: INITIAL_JOB,
      vacancyTitle: "Teacher - Mathematics",
    }));
    expect(screen.getByRole("heading", { name: "Server Candidate" })).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("keeps the demo queue mount refresh", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "demo");
    const list = vi.spyOn(careersService, "listStaffRecords").mockResolvedValue([INITIAL_JOB]);

    render(createElement(CareersQueue, {
      initial: [],
      vacancyTitles: { "teacher-mathematics": "Teacher - Mathematics" },
      demoMode: true,
    }));

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Server Candidate")).toBeInTheDocument();
  });
});
