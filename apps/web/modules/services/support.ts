/**
 * Typed support-service boundary: the one interface the public, portal, and
 * staff grievance views consume. The current implementation is a
 * deterministic demo adapter; the backend phase replaces it behind the same
 * signatures (see UI-COMPLETION-PLAN.md §4 and §5.9).
 *
 * Shared thread model: every grievance carries one submission event plus
 * zero or more response events. There are no staff-only notes in the model,
 * so the requester view (public/portal) can never leak one — the thread is
 * the applicant-safe shared model by construction.
 *
 * Determinism: references come from a session counter (seeded after the
 * fixture refs) and timestamps from the injected demo clock — never the wall
 * clock or Math.random().
 */

import { demoNowIso } from "@/modules/demo/clock";
import { grievances as grievanceFixtures } from "@/modules/support/demo";
import type { GrievanceCategory, GrievanceStatus } from "@/modules/support/demo";
import { getDemoPolicy } from "@/modules/services/demo-policy";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";

export type { GrievanceCategory, GrievanceStatus };

/** One entry in the applicant-safe thread: the original submission or a staff response. */
export type GrievanceEvent = {
  kind: "submission" | "response";
  atIso: string;
  by: string;
  text: string;
};

export type Grievance = {
  ref: string;
  category: GrievanceCategory;
  subject: string;
  message: string;
  contactName: string;
  contactPhone?: string;
  raisedAtIso: string;
  status: GrievanceStatus;
  thread: GrievanceEvent[];
  privateNotes?: Array<{ atIso: string; by: string; text: string }>;
  /** Support-officer assignment (fictional demo policy). */
  assignee?: { by: string; atIso: string };
};

export type GrievanceInput = {
  category: GrievanceCategory;
  subject: string;
  message: string;
  contactName: string;
  contactPhone?: string;
};

export interface SupportService {
  /** Public (anonymous) grievance submission through the CAPTCHA-protected route. */
  submitGrievance(input: GrievanceInput): Promise<{ ref: string }>;
  /** Authenticated grievance submission through the adapter (portal users). */
  submitAuthenticatedGrievance(input: GrievanceInput): Promise<{ ref: string }>;
  /** The requester-safe record; null when the reference is unknown. */
  getGrievance(ref: string): Promise<Grievance | null>;
  listGrievances(): Promise<Grievance[]>;
  /** Appends a response event; without `resolve` the status moves to "In progress", with it to "Resolved". */
  respond(ref: string, text: string, by: string, resolve: boolean): Promise<Grievance>;
  /** Staff-only note; never included in the requester-safe projection. */
  addPrivateNote(ref: string, text: string, by: string): Promise<Grievance>;
  /** Assign the request to a support officer (fictional demo policy). */
  assign(ref: string, by: string): Promise<Grievance>;
  /** Returns a resolved grievance to "New" (no thread event — only responses append). */
  reopen(ref: string, by: string): Promise<Grievance>;
}

/* ------------------------------------------------------------------ */
/* Demo adapter                                                        */
/* ------------------------------------------------------------------ */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Session-store shape: next free counter + the merged fixture/submission list. */
type SupportStore = {
  /** Next free ref suffix — seeded 107, after the fixtures' 0101–0106. */
  counter: number;
  /** Newest first, matching the fixture arrival order. */
  grievances: Grievance[];
};

const SUPPORT_SESSION_KEY = sessionKey("support");
const INITIAL_COUNTER = 107;

/** Map a fixture grievance (with its single optional response) into the shared thread model. */
function fixtureToGrievance(fixture: (typeof grievanceFixtures)[number]): Grievance {
  const thread: GrievanceEvent[] = [
    { kind: "submission", atIso: fixture.raisedAtIso, by: fixture.contactName, text: fixture.message },
  ];
  if (fixture.response) {
    thread.push({
      kind: "response",
      atIso: fixture.response.atIso,
      by: fixture.response.by,
      text: fixture.response.text,
    });
  }
  return {
    ref: fixture.ref,
    category: fixture.category,
    subject: fixture.subject,
    message: fixture.message,
    contactName: fixture.contactName,
    contactPhone: fixture.contactPhone,
    raisedAtIso: fixture.raisedAtIso,
    status: fixture.status,
    thread,
  };
}

/** Read the session store, seeding it with the fixtures on first access. */
function readStore(): SupportStore {
  const existing = sessionGet<SupportStore>(SUPPORT_SESSION_KEY);
  if (existing !== null) return existing;
  const seeded: SupportStore = {
    counter: INITIAL_COUNTER,
    grievances: grievanceFixtures.map(fixtureToGrievance),
  };
  sessionSet(SUPPORT_SESSION_KEY, seeded);
  return seeded;
}

function writeStore(store: SupportStore): void {
  sessionSet(SUPPORT_SESSION_KEY, store);
}

function nextRef(counter: number): string {
  return `GRV-2026-${String(counter).padStart(4, "0")}`;
}

/** Copy so callers can never mutate the stored record. */
function copyGrievance(grievance: Grievance): Grievance {
  return {
    ...grievance,
    thread: [...grievance.thread],
    privateNotes: grievance.privateNotes ? [...grievance.privateNotes] : undefined,
    assignee: grievance.assignee ? { ...grievance.assignee } : undefined,
  };
}

function requireGrievance(store: SupportStore, ref: string): Grievance {
  const grievance = store.grievances.find((item) => item.ref === ref);
  if (!grievance) throw new Error(`Unknown grievance reference: ${ref}`);
  return grievance;
}

/**
 * Deterministic demo adapter. Submissions persist in the browser session
 * store (sessionKey("support")), so a submitted grievance is always returned
 * by the same adapter on later reads — never implied by a local click.
 * Nothing is sent anywhere; the real support backend replaces this wholesale.
 */
export function createDemoSupportService(latencyMs = 200): SupportService {
  return {
    async submitGrievance(input) {
      await sleep(latencyMs);
      const store = readStore();
      const ref = nextRef(store.counter);
      const atIso = demoNowIso();
      const grievance: Grievance = {
        ref,
        category: input.category,
        subject: input.subject,
        message: input.message,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        raisedAtIso: atIso,
        status: "New",
        thread: [{ kind: "submission", atIso, by: input.contactName, text: input.message }],
      };
      store.grievances.unshift(grievance);
      store.counter += 1;
      writeStore(store);
      return { ref };
    },

    async submitAuthenticatedGrievance(input) {
      /* In demo mode, authenticated submission behaves the same as public. */
      return this.submitGrievance(input);
    },

    async getGrievance(ref) {
      await sleep(latencyMs);
      const found = readStore().grievances.find((item) => item.ref === ref);
      return found ? copyGrievance(found) : null;
    },

    async listGrievances() {
      await sleep(latencyMs);
      return readStore().grievances.map(copyGrievance);
    },

    async respond(ref, text, by, resolve) {
      await sleep(latencyMs);
      const store = readStore();
      const grievance = requireGrievance(store, ref);
      grievance.status = resolve ? "Resolved" : "In progress";
      grievance.thread = [
        ...grievance.thread,
        { kind: "response", atIso: demoNowIso(), by, text },
      ];
      writeStore(store);
      return copyGrievance(grievance);
    },

    async addPrivateNote(ref, text, by) {
      await sleep(latencyMs);
      const store = readStore();
      const grievance = requireGrievance(store, ref);
      grievance.privateNotes = [
        ...(grievance.privateNotes ?? []),
        { atIso: demoNowIso(), by, text: text.trim() },
      ];
      writeStore(store);
      return copyGrievance(grievance);
    },

    async assign(ref, by) {
      await sleep(latencyMs);
      if (!getDemoPolicy()["support.assignment"]) {
        throw new Error("Support assignment is pending school policy in this demo.");
      }
      const store = readStore();
      const grievance = requireGrievance(store, ref);
      grievance.assignee = { by, atIso: demoNowIso() };
      writeStore(store);
      return copyGrievance(grievance);
    },

    async reopen(ref, _by) {
      await sleep(latencyMs);
      const store = readStore();
      const grievance = requireGrievance(store, ref);
      grievance.status = "New";
      writeStore(store);
      return copyGrievance(grievance);
    },
  };
}

/** Default singleton consumed by the public/portal/staff views. */
export const supportService: SupportService = createDemoSupportService();

import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";

export type ServerSupportRow = {
  id: string;
  reference: string;
  category: string;
  subject: string;
  requester_name?: string | null;
  requester_contact?: string | null;
  status: string;
  version?: number;
  created_at: string;
  support_messages?: Array<{ body: string; is_staff: boolean; created_at: string }>;
  support_private_notes?: Array<{ body: string; author_account_id: string; created_at: string }>;
};

function mapSupportStatus(status: string): GrievanceStatus {
  if (status === "resolved" || status === "closed") return "Resolved";
  if (status === "in_progress" || status === "assigned") return "In progress";
  return "New";
}

export function mapServerSupportRow(row: ServerSupportRow): Grievance {
  const name = row.requester_name ?? "Requester";
  return { ref: row.reference, category: row.category as GrievanceCategory, subject: row.subject, message: row.support_messages?.[0]?.body ?? "", contactName: name, contactPhone: row.requester_contact ?? undefined, raisedAtIso: row.created_at, status: mapSupportStatus(row.status), thread: (row.support_messages ?? []).map((message) => ({ kind: message.is_staff ? "response" : "submission", atIso: message.created_at, by: message.is_staff ? "School support" : name, text: message.body })), privateNotes: (row.support_private_notes ?? []).map((note) => ({ atIso: note.created_at, by: note.author_account_id, text: note.body })) };
}

const originalSupport = createDemoSupportService();
supportService.submitGrievance = async (input) => {
  if (clientAdapterMode() !== "supabase") return originalSupport.submitGrievance(input);
  const response = await fetch("/api/support/public", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: input.category, subject: input.subject, body: input.message, contact: input.contactPhone ?? input.contactName, requesterName: input.contactName }) });
  const value = (await response.json().catch(() => null)) as { value?: { reference?: string }; errors?: Array<{ message: string }> } | null;
  if (!response.ok || !value?.value?.reference) throw new Error(value?.errors?.[0]?.message ?? "Support intake is unavailable.");
  return { ref: value.value.reference };
};
supportService.submitAuthenticatedGrievance = async (input) => {
  if (clientAdapterMode() !== "supabase") return originalSupport.submitAuthenticatedGrievance(input);
  const result = await adapterCall<{ reference: string }>("support.create", { category: input.category, subject: input.subject, body: input.message, priority: "normal" });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Support intake is unavailable.");
  return { ref: result.value.reference };
};
supportService.getGrievance = async (ref) => {
  if (clientAdapterMode() !== "supabase") return originalSupport.getGrievance(ref);
  const response = await adapterCall<ServerSupportRow[]>("support.list", { scope: "mine" });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "Support is unavailable.");
  const row = response.value.find((candidate) => candidate.reference === ref);
  return row ? mapServerSupportRow(row) : null;
};
supportService.listGrievances = async () => {
  if (clientAdapterMode() !== "supabase") return originalSupport.listGrievances();
  const response = await adapterCall<ServerSupportRow[]>("support.list", { scope: "staff" });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "Support is unavailable.");
  return response.value.map(mapServerSupportRow);
};
supportService.respond = async (ref, text, _by, resolve) => {
  if (clientAdapterMode() !== "supabase") return originalSupport.respond(ref, text, _by, resolve);
  const rows = await adapterCall<ServerSupportRow[]>("support.list", { scope: "staff" });
  if (!rows.ok) throw new Error(rows.errors[0]?.message ?? "Support is unavailable.");
  const row = rows.value.find((candidate) => candidate.reference === ref);
  if (!row) throw new Error("Support request not found.");
  const response = await adapterCall<{ version?: number }>("support.respond", { requestId: row.id, body: text, isPrivate: false, expectedVersion: row.version ?? 1, idempotencyKey: `support-response:${row.reference}:${row.version ?? 1}:${text}` });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "Support response failed.");
  if (resolve) {
    const status = await adapterCall("support.setStatus", { requestId: row.id, status: "resolved", expectedVersion: response.value.version ?? (row.version ?? 1) + 1, reason: "Response resolved the requester concern." });
    if (!status.ok) throw new Error(status.errors[0]?.message ?? "Support could not be resolved.");
  }
  const refreshed = await adapterCall<ServerSupportRow[]>("support.list", { scope: "staff" });
  if (refreshed.ok) {
    const updated = refreshed.value.find((candidate) => candidate.reference === ref);
    if (updated) return mapServerSupportRow(updated);
  }
  return mapServerSupportRow(row);
};
supportService.addPrivateNote = async (ref, text, _by) => {
  if (clientAdapterMode() !== "supabase") return originalSupport.addPrivateNote(ref, text, _by);
  const rows = await adapterCall<ServerSupportRow[]>("support.list", { scope: "staff" });
  if (!rows.ok) throw new Error(rows.errors[0]?.message ?? "Support is unavailable.");
  const row = rows.value.find((candidate) => candidate.reference === ref);
  if (!row) throw new Error("Support request not found.");
  const response = await adapterCall("support.respond", { requestId: row.id, body: text, isPrivate: true, expectedVersion: row.version ?? 1, idempotencyKey: `support-note:${row.reference}:${row.version ?? 1}:${text}` });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "Private note failed.");
  const refreshed = await adapterCall<ServerSupportRow[]>("support.list", { scope: "staff" });
  if (refreshed.ok) {
    const updated = refreshed.value.find((candidate) => candidate.reference === ref);
    if (updated) return mapServerSupportRow(updated);
  }
  return mapServerSupportRow(row);
};
supportService.reopen = async (ref, by) => {
  if (clientAdapterMode() !== "supabase") return originalSupport.reopen(ref, by);
  const rows = await adapterCall<ServerSupportRow[]>("support.list", { scope: "staff" });
  if (!rows.ok) throw new Error(rows.errors[0]?.message ?? "Support is unavailable.");
  const row = rows.value.find((candidate) => candidate.reference === ref);
  if (!row) throw new Error("Support request not found.");
  const response = await adapterCall<unknown>("support.reopen", { requestId: row.id, expectedVersion: (row as ServerSupportRow & { version?: number }).version ?? 1 });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "Support reopen failed.");
  const refreshed = await adapterCall<ServerSupportRow[]>("support.list", { scope: "staff" });
  if (refreshed.ok) {
    const updated = refreshed.value.find((candidate) => candidate.reference === ref);
    if (updated) return mapServerSupportRow(updated);
  }
  return mapServerSupportRow(row);
};
supportService.assign = async (ref, by) => {
  if (clientAdapterMode() !== "supabase") return originalSupport.assign(ref, by);
  const rows = await adapterCall<ServerSupportRow[]>("support.list", { scope: "staff" });
  if (!rows.ok) throw new Error(rows.errors[0]?.message ?? "Support is unavailable.");
  const row = rows.value.find((candidate) => candidate.reference === ref);
  if (!row) throw new Error("Support request not found.");
  const response = await adapterCall<unknown>("support.assign", { requestId: row.id, assigneeAccountId: by, expectedVersion: (row as ServerSupportRow & { version?: number }).version ?? 1 });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "Support assignment failed.");
  const refreshed = await adapterCall<ServerSupportRow[]>("support.list", { scope: "staff" });
  if (refreshed.ok) {
    const updated = refreshed.value.find((candidate) => candidate.reference === ref);
    if (updated) return mapServerSupportRow(updated);
  }
  return mapServerSupportRow(row);
};
