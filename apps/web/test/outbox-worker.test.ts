// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { renderEmail, resolveRecipients, type OutboxEventRow } from "@/lib/supabase/outbox-worker";

function fakeAdmin(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const rows = () => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      const chain = {
        select() { return chain; },
        eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return chain; },
        in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return chain; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then(resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown) {
          return Promise.resolve({ data: rows(), error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
}

function event(input: Partial<OutboxEventRow>): OutboxEventRow {
  return {
    id: "00000000-0000-4000-8000-000000000901",
    event_key: "email.test:REF-1",
    kind: "email.deliver",
    target_type: "user_account",
    target_reference: "00000000-0000-4000-8000-000000000001",
    payload: {},
    status: "processing",
    attempts: 0,
    ...input,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("outbox recipient resolution", () => {
  it("resolves user-account events from the target UUID when payload accountId is absent", async () => {
    const admin = fakeAdmin({ user_accounts: [{ id: "00000000-0000-4000-8000-000000000001", verified_contact: "account@example.test" }] });
    await expect(resolveRecipients(admin as never, event({}))).resolves.toEqual([
      { accountId: "00000000-0000-4000-8000-000000000001", email: "account@example.test" },
    ]);
  });

  it("sends support-response email only to the requester", async () => {
    const admin = fakeAdmin({
      support_requests: [{ reference: "SR-1", requester_account_id: "requester", assignee_account_id: "assignee" }],
      user_accounts: [
        { id: "requester", verified_contact: "requester@example.test" },
        { id: "assignee", verified_contact: "assignee@example.test" },
      ],
    });
    await expect(resolveRecipients(admin as never, event({ event_key: "email.support:SR-1:v2", target_type: "support_request", target_reference: "SR-1" }))).resolves.toEqual([
      { accountId: "requester", email: "requester@example.test" },
    ]);
  });

  it("resolves internal result-entry workflow mail to reviewer and publisher accounts", async () => {
    const admin = fakeAdmin({
      role_grants: [
        { account_id: "reviewer", role_code: "exam_reviewer", status: "active" },
        { account_id: "publisher", role_code: "result_publisher", status: "active" },
      ],
      user_accounts: [
        { id: "reviewer", verified_contact: "reviewer@example.test" },
        { id: "publisher", verified_contact: "publisher@example.test" },
      ],
    });
    const recipients = await resolveRecipients(admin as never, event({ event_key: "email.result_entry_sheet_submitted:RES-1:v2", target_type: "result_entry_sheet", target_reference: "RES-1" }));
    expect(recipients.map((recipient) => recipient.accountId).sort()).toEqual(["publisher", "reviewer"]);
  });

  it("resolves refund updates through payment allocation and invoice ownership", async () => {
    const admin = fakeAdmin({
      refund_requests: [{ reference: "REF-1", payments: { payment_allocations: [{ invoices: { reference: "INV-1" } }] } }],
      invoices: [{ reference: "INV-1", student_id: null, applicant_ref: "APP-1" }],
      admission_applications: [{ reference: "APP-1", owner_account_id: "applicant", user_accounts: { verified_contact: "applicant@example.test" } }],
    });
    await expect(resolveRecipients(admin as never, event({ event_key: "email.refund_status:REF-1:v2", target_type: "refund_request", target_reference: "REF-1" }))).resolves.toEqual([
      { accountId: "applicant", email: "applicant@example.test" },
    ]);
  });
});

describe("outbox template routing", () => {
  it("renders decision and result-entry templates with authorized routes", async () => {
    vi.stubEnv("APP_URL", "https://school.example.test");
    const admin = fakeAdmin({});
    const recipient = { accountId: "account", email: "account@example.test" };
    const decision = await renderEmail(admin as never, event({ event_key: "email.application_decision:APP-1:v2", target_type: "admission_application", target_reference: "APP-1", payload: { decision: "waitlisted" } }), recipient);
    const resultEntry = await renderEmail(admin as never, event({ event_key: "email.result_entry_sheet_submitted:RES-1:v2", target_type: "result_entry_sheet", target_reference: "RES-1" }), recipient);
    expect(decision?.html).toContain("/apply/student/APP-1/status");
    expect(decision?.html).toContain("waitlist");
    expect(resultEntry?.html).toContain("/staff/results");
  });
});
