// @vitest-environment node

/**
 * Published vacancies are a deliberately public projection: RLS grants the
 * anon role, not authenticated applicants. The adapter operation must read
 * them with the anonymous client so a signed-in applicant still sees open
 * vacancies; passing the request-session client returned an empty list and
 * blocked the whole job application journey.
 */

import { describe, expect, it, vi } from "vitest";

const publicClient = { publicClient: true };

vi.mock("@/lib/supabase/public", () => ({
  createSupabasePublicClient: vi.fn(() => publicClient),
}));

vi.mock("@/lib/supabase/domain", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    jobsListPublishedVacancies: vi.fn(() => ({ ok: true as const, value: [] })),
  };
});

import { operationsModule } from "@/app/api/adapter/registry/operations";
import { jobsListPublishedVacancies } from "@/lib/supabase/domain";

describe("public vacancy projection", () => {
  it("reads jobs.vacancies anonymously, never with the applicant session", async () => {
    const operation = operationsModule.operations.find((candidate) => candidate.name === "jobs.vacancies");
    expect(operation).toBeDefined();
    const sessionClient = { sessionClient: true };
    await operation!.handle(
      { supabase: sessionClient as never, actor: null as never, selection: {} },
      {},
    );
    expect(jobsListPublishedVacancies).toHaveBeenCalledWith(publicClient);
    expect(jobsListPublishedVacancies).not.toHaveBeenCalledWith(sessionClient);
  });
});
