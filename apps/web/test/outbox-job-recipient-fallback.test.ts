// @vitest-environment node
/**
 * Job application email recipient resolution (owner requirement, 15
 * September 2026). Public applications resolve their contact from
 * `applicant_email`; until migration 000105 is applied the column is absent,
 * so the worker must fall back to the account-bound projection instead of
 * failing every job status email.
 */
import { describe, expect, it } from "vitest";

import { resolveRecipients } from "@/lib/supabase/outbox-worker";

const EVENT = {
  id: "00000000-0000-4000-8000-000000000001",
  event_key: "email.job_status:JOB-1:v2",
  kind: "email.deliver",
  target_type: "job_application",
  target_reference: "JOB-1",
  payload: { channel: "email", status: "not_selected" },
  status: "pending",
  attempts: 0,
  max_attempts: 10,
  next_attempt_at: "2026-01-01T00:00:00.000Z",
  last_error: null,
  delivered_at: null,
};

type Response = { data: unknown; error: { message: string } | null };

/** Minimal PostgREST-shaped fake for the two reads the resolver performs. */
function fakeAdmin(script: { jobApplications: Response[]; accounts?: Response }) {
  const jobQueue = [...script.jobApplications];
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      chain.select = passthrough;
      chain.eq = passthrough;
      chain.in = passthrough;
      if (table === "job_applications") {
        chain.maybeSingle = async () => jobQueue.shift() ?? { data: null, error: null };
      } else if (table === "user_accounts") {
        chain.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve(script.accounts ?? { data: [], error: null }).then(resolve);
      } else {
        chain.maybeSingle = async () => ({ data: null, error: null });
        chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      }
      return chain;
    },
  } as never;
}

describe("job application recipient resolution", () => {
  it("falls back to the owner account when applicant_email is not applied yet", async () => {
    const admin = fakeAdmin({
      jobApplications: [
        { data: null, error: { message: "column job_applications.applicant_email does not exist" } },
        { data: { owner_account_id: "00000000-0000-4000-8000-000000000201" }, error: null },
      ],
      accounts: { data: [{ id: "00000000-0000-4000-8000-000000000201", verified_contact: "owner@example.test" }], error: null },
    });

    const recipients = await resolveRecipients(admin, EVENT as never);

    expect(recipients).toEqual([{ accountId: "00000000-0000-4000-8000-000000000201", email: "owner@example.test" }]);
  });

  it("resolves an accountless public applicant from applicant_email", async () => {
    const admin = fakeAdmin({
      jobApplications: [{ data: { owner_account_id: null, applicant_email: "Candidate@Example.test" }, error: null }],
    });

    const recipients = await resolveRecipients(admin, { ...EVENT, event_key: "email.job_submitted:JOB-1" } as never);

    expect(recipients).toEqual([{ accountId: null, email: "Candidate@Example.test" }]);
  });

  it("keeps other lookup errors fatal", async () => {
    const admin = fakeAdmin({
      jobApplications: [{ data: null, error: { message: "connection reset" } }],
    });

    await expect(resolveRecipients(admin, EVENT as never)).rejects.toThrow(/recipient lookup failed: connection reset/);
  });
});
