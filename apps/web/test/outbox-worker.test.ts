// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { renderEmail, resolveRecipients, dispatchEvent, processOutboxBatch, type OutboxEventRow } from "@/lib/supabase/outbox-worker";

type FakeQueryError = { message: string };
type FakeAdminResult = {
  data: Array<Record<string, unknown>> | null;
  error: FakeQueryError | null;
};

function fakeAdmin(
  tables: Record<string, Array<Record<string, unknown>>>,
  options: { errors?: Record<string, FakeQueryError> } = {},
) {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const rows = () => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      const failure = options.errors?.[table] ?? null;
      const result = (): FakeAdminResult => failure !== null
        ? { data: null, error: { message: failure.message } }
        : { data: rows(), error: null };
      const chain = {
        select() { return chain; },
        eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return chain; },
        in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return chain; },
        upsert() { return chain; },
        update() { return chain; },
        insert() { return chain; },
        maybeSingle: async () => {
          if (failure !== null) return { data: null, error: { message: failure.message } };
          return { data: rows()[0] ?? null, error: null };
        },
        single: async () => {
          if (failure !== null) return { data: null, error: { message: failure.message } };
          return { data: rows()[0] ?? null, error: null };
        },
        then(resolve: (value: FakeAdminResult) => unknown) {
          return Promise.resolve(result()).then(resolve);
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

function fakeRpcAdmin(results: Record<string, { data: unknown; error: { message: string } | null }>) {
  return {
    schema(schema: string) {
      return {
        rpc: async (fn: string) => results[`${schema}.${fn}`] ?? { data: null, error: null },
      };
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("content schedule and expiry dispatch", () => {
  it("sweeps due publishes for content.publish events", async () => {
    const admin = fakeRpcAdmin({ "app.content_publish_due": { data: 1, error: null } });
    await expect(
      dispatchEvent(
        admin as never,
        event({ kind: "content.publish", event_key: "content.publish:NOT-1:4", target_type: "notice", target_reference: "NOT-1" }),
        undefined,
        {} as never,
        {} as never,
      ),
    ).resolves.toEqual({ kind: "delivered", providerIds: ["content.publish"] });
  });

  it("sweeps due expiries for content.expire events", async () => {
    const admin = fakeRpcAdmin({ "app.content_expire_due": { data: 2, error: null } });
    await expect(
      dispatchEvent(
        admin as never,
        event({ kind: "content.expire", event_key: "content.expire:NOT-1:2026-09-10:4", target_type: "notice", target_reference: "NOT-1" }),
        undefined,
        {} as never,
        {} as never,
      ),
    ).resolves.toEqual({ kind: "delivered", providerIds: ["content.expire"] });
  });

  it("keeps an expiry sweep failure retryable instead of reporting success", async () => {
    const admin = fakeRpcAdmin({ "app.content_expire_due": { data: null, error: { message: "database unavailable" } } });
    await expect(
      dispatchEvent(
        admin as never,
        event({ kind: "content.expire", event_key: "content.expire:NOT-1:2026-09-10:4", target_type: "notice", target_reference: "NOT-1" }),
        undefined,
        {} as never,
        {} as never,
      ),
    ).resolves.toEqual({ kind: "transient", error: "database unavailable" });
  });

  it("acknowledges an expired-notice domain event without provider work", async () => {
    const admin = fakeRpcAdmin({});
    await expect(
      dispatchEvent(
        admin as never,
        event({ kind: "content.expired", event_key: "content.expired:NOT-1:4", target_type: "notice", target_reference: "NOT-1" }),
        undefined,
        {} as never,
        {} as never,
      ),
    ).resolves.toEqual({ kind: "delivered", providerIds: ["content.expired"] });
  });
});

describe("scheduled page publication dispatch", () => {
  it("delivers a page event as skipped when no audience resolves", async () => {
    const admin = fakeAdmin({});
    await expect(
      dispatchEvent(
        admin as never,
        event({ kind: "email.deliver", event_key: "content.scheduled_published:PAGE-1:4", target_type: "content_item", target_reference: "PAGE-1" }),
        undefined,
        {} as never,
        {} as never,
      ),
    ).resolves.toEqual({ kind: "delivered", providerIds: ["skipped:content.scheduled_published:PAGE-1:4"] });
  });

  it("skips a notice event with no currently-addressable recipients", async () => {
    const admin = fakeAdmin({});
    const sender = async () => ({ providerMessageId: "test-provider-id" });
    await expect(
      dispatchEvent(
        admin as never,
        event({ kind: "email.deliver", event_key: "content.scheduled_published:NOT-1:4", target_type: "notice", target_reference: "NOT-1" }),
        sender,
        {} as never,
        {} as never,
      ),
    ).resolves.toEqual({ kind: "delivered", providerIds: ["skipped:content.scheduled_published:NOT-1:4"] });
  });
});

describe("recipient resolution failure and skip semantics", () => {
  it("returns a transient outcome when a recipient helper query fails", async () => {
    const admin = fakeAdmin(
      { user_accounts: [{ id: "00000000-0000-4000-8000-000000000001", verified_contact: "account@example.test" }] },
      { errors: { user_accounts: { message: "database unavailable" } } },
    );
    const sender = vi.fn(async () => ({ providerMessageId: "test-provider-id" }));
    await expect(
      dispatchEvent(admin as never, event({}), sender, {} as never, {} as never),
    ).resolves.toEqual({ kind: "transient", error: "recipient lookup failed: database unavailable" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("leaves the event pending with backoff when a recipient query fails during a batch", async () => {
    const base = fakeAdmin(
      { user_accounts: [{ id: "00000000-0000-4000-8000-000000000001", verified_contact: "account@example.test" }] },
      { errors: { user_accounts: { message: "database unavailable" } } },
    );
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const admin = {
      ...base,
      schema() {
        return {
          rpc: async (fn: string, args: Record<string, unknown>) => {
            rpcCalls.push({ fn, args });
            if (fn === "claim_outbox") return { data: [event({})], error: null };
            return { data: null, error: null };
          },
        };
      },
    };
    const summary = await processOutboxBatch({ admin: admin as never, sender: async () => ({ providerMessageId: "test" }) });
    expect(summary.transientFailed).toBe(1);
    expect(summary.permanentFailed).toBe(0);
    const failure = rpcCalls.find((call) => call.fn === "fail_outbox");
    expect(failure?.args.p_event_key).toBe("email.test:REF-1");
    expect(failure?.args.p_error).toBe("recipient lookup failed: database unavailable");
    expect(String(failure?.args.p_error).startsWith("Permanent:")).toBe(false);
  });

  it("skips a phone-only contact without calling the provider", async () => {
    const admin = fakeAdmin({ user_accounts: [{ id: "00000000-0000-4000-8000-000000000001", verified_contact: "+91 98765 43210" }] });
    const sender = vi.fn(async () => ({ providerMessageId: "unexpected" }));
    await expect(
      dispatchEvent(admin as never, event({}), sender, {} as never, {} as never),
    ).resolves.toEqual({ kind: "delivered", providerIds: ["skipped:email.test:REF-1"] });
    expect(sender).not.toHaveBeenCalled();
  });

  it("delivers an event with zero resolvable recipients as skipped without a provider call", async () => {
    const admin = fakeAdmin({ students: [] });
    const sender = vi.fn(async () => ({ providerMessageId: "unexpected" }));
    await expect(
      dispatchEvent(admin as never, event({ target_type: "students", target_reference: "STU-404" }), sender, {} as never, {} as never),
    ).resolves.toEqual({ kind: "delivered", providerIds: ["skipped:email.test:REF-1"] });
    expect(sender).not.toHaveBeenCalled();
  });

  it("never resolves the inviter for a staff invitation outbox event", async () => {
    const admin = fakeAdmin({
      account_invitations: [{ reference: "INV-1", account_id: "invitee", created_by_account_id: "inviter" }],
      user_accounts: [
        { id: "invitee", verified_contact: "invitee@example.test" },
        { id: "inviter", verified_contact: "inviter@example.test" },
      ],
    });
    await expect(
      resolveRecipients(admin as never, event({ event_key: "email.staff_invitation:INV-1:v2", target_type: "account_invitation", target_reference: "INV-1" })),
    ).resolves.toEqual([]);
  });

  it("resolves a guardian welcome recipient from the claim contact", async () => {
    const admin = fakeAdmin({
      guardian_claim_invitations: [{ reference: "GCL-1", guardian_contact_id: "contact-1" }],
      guardian_contacts: [{ id: "contact-1", channel: "email", value: "guardian@example.test" }],
    });
    await expect(
      resolveRecipients(admin as never, event({ event_key: "email.guardian_welcome:GCL-1", target_type: "guardian_claim_invitation", target_reference: "GCL-1" })),
    ).resolves.toEqual([{ accountId: null, email: "guardian@example.test" }]);
  });
});

describe("email delivery record integrity", () => {
  it("returns the event to pending when the suppression lookup fails", async () => {
    vi.stubEnv("APP_URL", "https://school.example.test");
    const admin = fakeAdmin(
      {
        user_accounts: [{ id: "00000000-0000-4000-8000-000000000001", verified_contact: "account@example.test" }],
        notification_deliveries: [{ id: "delivery-1", status: "pending", attempts: 0, next_attempt_at: null, failure_class: null }],
      },
      { errors: { email_suppressions: { message: "suppression store unavailable" } } },
    );
    const sender = vi.fn(async () => ({ providerMessageId: "test-provider-id" }));
    await expect(
      dispatchEvent(admin as never, event({ event_key: "email.application_submitted:APP-1" }), sender, {} as never, {} as never),
    ).resolves.toEqual({ kind: "transient", error: "suppression lookup failed: suppression store unavailable" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("returns the event to pending when the delivery record write fails", async () => {
    vi.stubEnv("APP_URL", "https://school.example.test");
    const admin = fakeAdmin(
      { user_accounts: [{ id: "00000000-0000-4000-8000-000000000001", verified_contact: "account@example.test" }] },
      { errors: { notification_deliveries: { message: "delivery store unavailable" } } },
    );
    const sender = vi.fn(async () => ({ providerMessageId: "test-provider-id" }));
    await expect(
      dispatchEvent(admin as never, event({ event_key: "email.application_submitted:APP-1" }), sender, {} as never, {} as never),
    ).resolves.toEqual({ kind: "transient", error: "delivery record lookup failed: delivery store unavailable" });
    expect(sender).not.toHaveBeenCalled();
  });
});

describe("outbox batch email provider readiness", () => {
  it("returns before claiming while email provider configuration is missing", async () => {
    vi.stubEnv("FASS_DATA_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "demo");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    let queries = 0;
    let rpcCalls = 0;
    const admin = {
      from() {
        queries += 1;
        throw new Error("no outbox query expected while email config is missing");
      },
      schema() {
        return {
          rpc: async () => {
            rpcCalls += 1;
            return { data: null, error: null };
          },
        };
      },
    };
    const summary = await processOutboxBatch({ admin: admin as never });
    expect(summary.emailConfigMissing).toBe(true);
    expect(summary.claimed).toBe(0);
    expect(queries).toBe(0);
    expect(rpcCalls).toBe(0);
  });

  it("reports zero-recipient email events as skipped in the batch summary", async () => {
    const base = fakeAdmin({});
    const rpcCalls: string[] = [];
    const admin = {
      ...base,
      schema() {
        return {
          rpc: async (fn: string) => {
            rpcCalls.push(fn);
            if (fn === "claim_outbox") {
              return {
                data: [event({ event_key: "content.scheduled_published:PAGE-1:4", target_type: "content_item", target_reference: "PAGE-1" })],
                error: null,
              };
            }
            return { data: null, error: null };
          },
        };
      },
    };
    const summary = await processOutboxBatch({ admin: admin as never, sender: async () => ({ providerMessageId: "test" }) });
    expect(summary.delivered).toBe(1);
    expect(summary.skippedNoRecipients).toBe(1);
    expect(summary.permanentFailed).toBe(0);
    expect(rpcCalls).toContain("mark_outbox_delivered");
  });
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
    expect(resultEntry?.html).toContain("/administrator/results");
  });

  it("renders the real term and subject for a sheet-native publication", async () => {
    vi.stubEnv("APP_URL", "https://school.example.test");
    const admin = fakeAdmin({
      result_publications: [{
        reference: "PUB-2026-F4ADBC",
        result_entry_sheets: { exam_definitions: { term: "midterm" }, subjects: { name: "English" } },
        result_batches: null,
      }],
    });
    const template = await renderEmail(
      admin as never,
      event({ event_key: "email.result_publication:PUB-2026-F4ADBC", target_type: "result_publication", target_reference: "PUB-2026-F4ADBC" }),
      { accountId: "account", email: "account@example.test" },
    );
    expect(template?.html).toContain("English");
    expect(template?.html).toContain("midterm");
    expect(template?.html).not.toContain("the recent term");
  });

  it("renders a report release with its real term and subject manifest", async () => {
    vi.stubEnv("APP_URL", "https://school.example.test");
    const admin = fakeAdmin({
      result_report_releases: [{
        reference: "RPR-2026-204CE7",
        term: "midterm",
        result_report_release_items: [{ subjects: { name: "English" } }],
      }],
    });
    const template = await renderEmail(
      admin as never,
      event({ event_key: "email.result_report_release:RPR-2026-204CE7", target_type: "result_report_release", target_reference: "RPR-2026-204CE7" }),
      { accountId: "account", email: "account@example.test" },
    );
    expect(template?.html).toContain("English");
    expect(template?.html).toContain("midterm");
    expect(template?.html).not.toContain("the recent term");
  });
});
