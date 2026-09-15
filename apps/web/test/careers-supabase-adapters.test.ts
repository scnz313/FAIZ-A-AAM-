/**
 * Careers Supabase adapter contracts.
 *
 * Defect regressions: a saved job draft must resume from the live PostgREST
 * to-one embed shape (`job_application_drafts.application_id` is UNIQUE), and
 * the maker/checker business rule from `jobs_decide_v2` must map to a
 * non-retryable 409, not an `unavailable` 503.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { statusForServiceResult } from "@/app/api/adapter/registry";
import { jobsDecideV2 } from "@/lib/supabase/domain";
import type { Database } from "@/lib/supabase/database.types";
import { careersService, type JobDraft, type ServerJobDraftRow } from "@/modules/services/careers";

const VACANCY_ID = "00000000-0000-4000-8000-00000000f101";
const VERSION_ID = "00000000-0000-4000-8000-00000000f102";
const APP_ID = "00000000-0000-4000-8000-00000000f103";
const JOB_REF = "JOB-2026-0200";
const SLUG = "mathematics-teacher";

const DRAFT: JobDraft = {
  fullName: "Restored Candidate",
  phone: "+91 90000 00000",
  email: "candidate@example.test",
  qualification: "B.Sc. Mathematics · B.Ed.",
  subject: "Mathematics",
  year: "2024",
  institution: "Demo College of Education",
  experience: "3–5 years",
  currentRole: "Mathematics teacher",
  location: "Srinagar",
  message: "Available from April.",
  consent: true,
};

const SAVED_DRAFT: ServerJobDraftRow = {
  draft: DRAFT as unknown as Record<string, unknown>,
  schema_version: 1,
  expires_at: "2026-12-01T00:00:00.000Z",
  updated_at: "2026-08-10T05:10:00.000Z",
  version: 2,
};

const VACANCY = {
  vacancyId: VACANCY_ID,
  versionId: VERSION_ID,
  reference: SLUG,
  title: "Mathematics teacher — Secondary section",
  department: "Academics",
  terms: {},
};

function draftJobRow(drafts: ServerJobDraftRow | ServerJobDraftRow[] | null) {
  return {
    id: APP_ID,
    reference: JOB_REF,
    applicant_name: DRAFT.fullName,
    vacancy_id: VACANCY_ID,
    current_status: "draft",
    version: SAVED_DRAFT.version,
    created_at: "2026-08-10T05:00:00.000Z",
    job_vacancies: { title: VACANCY.title, reference: "VAC-2026-0200" },
    job_application_drafts: drafts,
    job_application_versions: [],
    job_events: [],
    job_interviews: [],
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function stubListMine(value: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "jobs.vacancies") return json({ ok: true, value: [VACANCY] });
      if (request.op === "jobs.listMine") return json({ ok: true, value });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("careersService.getDraft in Supabase adapter mode", () => {
  it("restores the saved draft when PostgREST embeds the unique draft as an object", async () => {
    stubListMine([draftJobRow(SAVED_DRAFT)]);

    const restored = await careersService.getDraft(SLUG);

    expect(restored?.ref).toBe(JOB_REF);
    expect(restored?.savedAtIso).toBe(SAVED_DRAFT.updated_at);
    expect(restored?.draft.fullName).toBe("Restored Candidate");
    expect(restored?.draft.subject).toBe("Mathematics");
  });

  it("still restores the draft when the embed arrives as an array", async () => {
    stubListMine([draftJobRow([SAVED_DRAFT])]);

    const restored = await careersService.getDraft(SLUG);

    expect(restored?.ref).toBe(JOB_REF);
    expect(restored?.draft.fullName).toBe("Restored Candidate");
  });

  it("returns null when there is no saved draft", async () => {
    stubListMine([draftJobRow(null)]);

    await expect(careersService.getDraft(SLUG)).resolves.toBeNull();
  });
});

describe("jobsDecideV2 business-rule errors", () => {
  it("maps a missing separate HR reviewer decision to a non-retryable 409", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "separate HR reviewer decision is required" } });
    const client = { schema: vi.fn().mockReturnValue({ rpc }) } as unknown as SupabaseClient<Database>;

    const result = await jobsDecideV2(client, { applicationId: APP_ID, action: "offer", reason: "Strong interview." });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("conflict");
    expect(result.errors[0]?.retryable).toBe(false);
    expect(statusForServiceResult(result)).toBe(409);
  });
});
