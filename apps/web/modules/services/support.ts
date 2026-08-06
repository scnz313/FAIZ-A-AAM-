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
};

export type GrievanceInput = {
  category: GrievanceCategory;
  subject: string;
  message: string;
  contactName: string;
  contactPhone?: string;
};

export interface SupportService {
  submitGrievance(input: GrievanceInput): Promise<{ ref: string }>;
  /** The requester-safe record; null when the reference is unknown. */
  getGrievance(ref: string): Promise<Grievance | null>;
  listGrievances(): Promise<Grievance[]>;
  /** Appends a response event; without `resolve` the status moves to "In progress", with it to "Resolved". */
  respond(ref: string, text: string, by: string, resolve: boolean): Promise<Grievance>;
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
  return { ...grievance, thread: [...grievance.thread] };
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
