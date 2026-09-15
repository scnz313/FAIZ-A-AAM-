/**
 * Local test harness for the email/outbox lifecycle.
 *
 * It models only the database surface the worker and the Resend webhook route
 * touch: a small PostgREST-shaped query builder over in-memory tables plus
 * in-memory implementations of `app.claim_outbox`, `app.mark_outbox_delivered`,
 * `app.fail_outbox`, and `app.claim_provider_jobs` with the same semantics as
 * migrations `000001`/`000030`/`000085` (due-time gate, attempt accounting,
 * exponential backoff, permanent-failure retirement). Tests combine it with
 * the real `createResendSender` pointed at a local HTTP stub.
 */

import { createHash, randomUUID } from "node:crypto";

export type HarnessEvent = {
  id: string;
  event_key: string;
  kind: string;
  target_type: string;
  target_reference: string;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "delivered" | "failed";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  delivered_at: string | null;
};

type Row = Record<string, unknown>;
type FakeError = { message: string; code?: string };
type FakeResponse = { data: unknown; error: FakeError | null };

export function createOutboxHarness() {
  const tables: Record<string, Row[]> = {};
  const events: HarnessEvent[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const rowsFor = (table: string): Row[] => (tables[table] ??= []);
  const nowIso = () => new Date().toISOString();
  const minFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

  function executeTable(
    table: string,
    mode: "select" | "insert" | "update" | "upsert",
    payload: Row | Row[] | null,
    filters: Array<(row: Row) => boolean>,
    options: { conflict: string[]; ignoreDuplicates: boolean; limit: number | null },
  ): FakeResponse {
    if (mode === "insert" || mode === "upsert") {
      const incoming = Array.isArray(payload) ? payload : payload === null ? [] : [payload];
      const written: Row[] = [];
      for (const candidate of incoming) {
        const row: Row = Object.assign({}, candidate, { id: typeof candidate.id === "string" ? candidate.id : randomUUID() });
        if (mode === "upsert" && options.conflict.length > 0) {
          const existing = rowsFor(table).find((current) => options.conflict.every((key) => current[key] === row[key]));
          if (existing !== undefined) {
            if (options.ignoreDuplicates) continue;
            Object.assign(existing, row);
            written.push(existing);
            continue;
          }
        }
        rowsFor(table).push(row);
        written.push(row);
      }
      return { data: written.map((row) => ({ ...row })), error: null };
    }
    const selected = rowsFor(table).filter((row) => filters.every((filter) => filter(row)));
    if (mode === "select") {
      const limited = options.limit === null ? selected : selected.slice(0, options.limit);
      return { data: limited.map((row) => ({ ...row })), error: null };
    }
    for (const row of selected) Object.assign(row, payload ?? {});
    return { data: selected.map((row) => ({ ...row })), error: null };
  }

  function tableQuery(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    const options = { conflict: [] as string[], ignoreDuplicates: false, limit: null as number | null };
    let mode: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Row | Row[] | null = null;

    const singleton = (kind: "single" | "maybeSingle"): FakeResponse => {
      const result = executeTable(table, mode, payload, filters, options);
      const rows = Array.isArray(result.data) ? (result.data as Row[]) : [];
      if (rows.length === 1) return { data: rows[0], error: null };
      if (rows.length === 0 && kind === "maybeSingle") return { data: null, error: null };
      return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    };

    const query = {
      select() { return query; },
      eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return query; },
      in(column: string, values: readonly unknown[]) { filters.push((row) => values.includes(row[column])); return query; },
      limit(count: number) { options.limit = count; return query; },
      order() { return query; },
      insert(row: Row | Row[]) { mode = "insert"; payload = row; return query; },
      update(row: Row) { mode = "update"; payload = row; return query; },
      upsert(row: Row | Row[], config?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        mode = "upsert";
        payload = row;
        options.conflict = config?.onConflict ? config.onConflict.split(",").map((key) => key.trim()) : [];
        options.ignoreDuplicates = config?.ignoreDuplicates ?? false;
        return query;
      },
      maybeSingle: async () => singleton("maybeSingle"),
      single: async () => singleton("single"),
      then(resolve: (value: FakeResponse) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(executeTable(table, mode, payload, filters, options)).then(resolve, reject);
      },
    };
    return query;
  }

  const eventByKey = (eventKey: unknown): HarnessEvent | undefined =>
    events.find((event) => event.event_key === eventKey);

  const findEvent = (eventKey: string): HarnessEvent => {
    const event = eventByKey(eventKey);
    if (event === undefined) throw new Error(`event ${eventKey} not found in harness`);
    return event;
  };

  function claimOutbox(batchSize: number): HarnessEvent[] {
    const due = events
      .filter((event) => (event.status === "pending" || event.status === "processing") && new Date(event.next_attempt_at).getTime() <= Date.now())
      .sort((left, right) => new Date(left.next_attempt_at).getTime() - new Date(right.next_attempt_at).getTime())
      .slice(0, Math.max(1, Math.min(batchSize, 100)));
    const claimed = due.map((event) => ({ ...event }));
    for (const event of due) {
      event.status = "processing";
      event.next_attempt_at = minFromNow(5);
    }
    return claimed;
  }

  async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<FakeResponse> {
    rpcCalls.push({ fn, args });
    if (fn === "claim_outbox") return { data: claimOutbox(Number(args.p_batch_size ?? 10)), error: null };
    if (fn === "claim_provider_jobs") return { data: [], error: null };
    if (fn === "mark_outbox_delivered") {
      const event = eventByKey(args.p_event_key);
      if (event === undefined) return { data: null, error: { message: `unknown outbox event key: ${String(args.p_event_key)}` } };
      if (event.status === "failed") return { data: null, error: { message: `failed outbox event cannot be marked delivered: ${event.event_key}` } };
      event.status = "delivered";
      event.delivered_at = nowIso();
      event.last_error = null;
      return { data: { ...event }, error: null };
    }
    if (fn === "fail_outbox") {
      const event = eventByKey(args.p_event_key);
      if (event === undefined) return { data: null, error: { message: `unknown outbox event key: ${String(args.p_event_key)}` } };
      const message = String(args.p_error ?? "outbox work failed");
      const permanent = message.startsWith("Permanent:");
      event.attempts += 1;
      event.last_error = message.slice(0, 500);
      event.status = permanent || event.attempts >= event.max_attempts ? "failed" : "pending";
      const delayed = permanent || event.attempts >= event.max_attempts;
      event.next_attempt_at = new Date(Date.now() + (delayed ? 0 : 60_000 * 2 ** Math.min(event.attempts - 1, 6))).toISOString();
      return { data: { ...event }, error: null };
    }
    return { data: null, error: null };
  }

  const admin = {
    from: (table: string) => tableQuery(table),
    schema: (_schema: string) => ({ rpc }),
  };

  function seedAccount(id: string, contact: string, personId: string = `person-${id}`): void {
    /* person_id is required by the live two-step guardian resolver
       (guardians and user_accounts share people; there is no direct FK). */
    rowsFor("user_accounts").push({ id, verified_contact: contact, status: "active", person_id: personId });
  }

  function findDelivery(recipientAccountId: string): Row {
    const delivery = rowsFor("notification_deliveries").find((row) => row.recipient_account_id === recipientAccountId);
    if (delivery === undefined) throw new Error(`delivery for ${recipientAccountId} not found in harness`);
    return delivery;
  }

  return {
    admin,
    events,
    tables,
    rpcCalls,
    rowsFor,
    findEvent,
    findDelivery,
    seedEvent(input: Partial<HarnessEvent> & Pick<HarnessEvent, "event_key" | "target_type" | "target_reference">): HarnessEvent {
      const event: HarnessEvent = {
        id: randomUUID(),
        kind: "email.deliver",
        payload: {},
        status: "pending",
        attempts: 0,
        max_attempts: 10,
        next_attempt_at: nowIso(),
        last_error: null,
        delivered_at: null,
        ...input,
      };
      events.push(event);
      return event;
    },
    seedAccount,
    seedStudentWithGuardians(studentRow: { reference: string; id: string }, guardians: Array<{ accountId: string; contact: string }>): void {
      rowsFor("students").push({ ...studentRow });
      for (const guardian of guardians) {
        const personId = `person-${guardian.accountId}`;
        seedAccount(guardian.accountId, guardian.contact, personId);
        rowsFor("guardian_student_links").push({
          student_id: studentRow.id,
          status: "active",
          guardians: { person_id: personId, user_accounts: [{ id: guardian.accountId, verified_contact: guardian.contact }] },
        });
      }
    },
    seedSuppression(email: string, reason: "hard_bounce" | "complaint" | "manual"): void {
      rowsFor("email_suppressions").push({ email_hash: createHash("sha256").update(email.toLowerCase().trim()).digest("hex"), reason });
    },
    makeDue(eventKey: string): void {
      const event = findEvent(eventKey);
      event.next_attempt_at = new Date(Date.now() - 1_000).toISOString();
      for (const delivery of rowsFor("notification_deliveries")) {
        if (delivery.event_id === event.id && delivery.next_attempt_at !== null) {
          delivery.next_attempt_at = new Date(Date.now() - 1_000).toISOString();
        }
      }
    },
  };
}

export type OutboxHarness = ReturnType<typeof createOutboxHarness>;
