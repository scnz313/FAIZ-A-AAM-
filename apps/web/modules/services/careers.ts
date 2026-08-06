/**
 * Careers domain service boundary.
 *
 * route/page → feature component → CareersService interface
 *   → deterministic demo adapter (this module) now
 *   → authenticated server adapter later
 *
 * Same conventions as `modules/services/admissions.ts`: session-store
 * persistence for submitted applications, withdrawals, and staff
 * decisions, deterministic references (session counter seeded 116 →
 * JOB-2026-0116, …) and the injected demo clock. Known fixture
 * references resolve via the seeded `jobApplications` rows; submitted
 * ones resolve from the session store. All data is fictional demo data.
 */

import { demoNowIso } from "@/modules/demo/clock";
import { jobApplications, vacancies, type JobApplicationRow, type Vacancy } from "@/modules/content/demo";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

export type JobDraft = {
  fullName: string;
  phone: string;
  email: string;
  qualification: string;
  subject: string;
  year: string;
  institution: string;
  experience: string;
  currentRole: string;
  documents: Record<string, string>;
  consent: boolean;
};

export type JobApplicationStatus =
  | "Submitted"
  | "Eligibility review"
  | "Shortlisted"
  | "Interview"
  | "Offered"
  | "Not selected"
  | "Withdrawn";

export type JobApplicationEvent = {
  status: JobApplicationStatus;
  atIso: string;
  actor: string;
  note: string;
};

export type JobApplicationRecord = {
  ref: string;
  vacancySlug: string;
  name: string;
  submittedAtIso: string;
  status: JobApplicationStatus;
  timeline: JobApplicationEvent[];
  /** Interview slot once the panel fixes a time; absent until then. */
  interview?: { atIso: string; note?: string };
};

/** The boundary every careers caller uses; the demo adapter is replaceable. */
export interface CareersService {
  getVacancy(slug: string): Promise<Vacancy | null>;
  /** Persist a form draft under the vacancy slug. */
  saveDraft(slug: string, draft: JobDraft): Promise<{ savedAtIso: string }>;
  /** Submit for a vacancy; resolves with the deterministic reference. */
  submitApplication(slug: string, draft: JobDraft): Promise<{ ref: string }>;
  /** The record for a reference, or null when it is not in the school's records. */
  getApplication(ref: string): Promise<JobApplicationRecord | null>;
  /** Applicant withdrawal; appends a Withdrawn event and is idempotent. */
  withdraw(ref: string, by: string): Promise<JobApplicationRecord>;
  /** Staff queue: every fixture and session-saved record, newest submitted first. */
  listStaffRecords(): Promise<JobApplicationRecord[]>;
  /** Staff decision: shortlist a candidate (from Submitted or Eligibility review). */
  staffShortlist(ref: string, note?: string): Promise<JobApplicationRecord>;
  /** Staff decision: request an interview and attach a demo slot (from Shortlisted). */
  staffRequestInterview(ref: string, note?: string): Promise<JobApplicationRecord>;
  /** Staff decision: offer the position (from Interview; a reason is required). */
  staffOffer(ref: string, note: string): Promise<JobApplicationRecord>;
  /** Staff decision: record not-selected (a reason is required). */
  staffNotSelected(ref: string, note: string): Promise<JobApplicationRecord>;
}

/* ------------------------------------------------------------------ */
/* Demo-session store                                                  */
/* ------------------------------------------------------------------ */

const RECORDS_KEY = sessionKey("careers");
const DRAFTS_KEY = sessionKey("careers-drafts");
const REF_COUNTER_KEY = sessionKey("careers-ref-counter");

/**
 * Session keys owned by this adapter, exported so tests can reset the demo
 * session deterministically. The key strings are the adapter's persistence
 * contract and must not change.
 */
export const CAREERS_SESSION_KEYS = {
  records: RECORDS_KEY,
  drafts: DRAFTS_KEY,
  counter: REF_COUNTER_KEY,
} as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Simulated network latency — fixed so demo behavior stays deterministic. */
const latencyMs = (): number => 200;

async function respond<T>(compute: () => T): Promise<T> {
  await sleep(latencyMs());
  return compute();
}

const DAY_MS = 24 * 60 * 60 * 1000;

function plusMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

function allRecords(): Record<string, JobApplicationRecord> {
  return sessionGet<Record<string, JobApplicationRecord>>(RECORDS_KEY) ?? {};
}

function saveRecord(record: JobApplicationRecord): void {
  const records = allRecords();
  records[record.ref] = record;
  sessionSet(RECORDS_KEY, records);
}

/** Session store first (so mutated fixture records persist), then fixtures. */
function loadRecord(ref: string): JobApplicationRecord | null {
  return allRecords()[ref] ?? fixtureApplicationRecord(ref);
}

/* ------------------------------------------------------------------ */
/* Fixture-derived records                                             */
/* ------------------------------------------------------------------ */

const STAGE_ORDER: readonly JobApplicationStatus[] = [
  "Submitted",
  "Eligibility review",
  "Shortlisted",
  "Interview",
];

const STAGE_NOTES: Record<JobApplicationStatus, string> = {
  Submitted: "Application received by the school.",
  "Eligibility review": "Qualifications and documents are checked against the vacancy.",
  Shortlisted: "The candidate has been shortlisted for the next stage.",
  Interview: "Interview and, where relevant, a demonstration.",
  Offered: "An offer has been made to the candidate.",
  "Not selected": "The vacancy has been filled by another candidate.",
  Withdrawn: "The applicant withdrew this application.",
};

/**
 * The shared fixture-derived record for a seeded job-application row:
 * one stage per day from the fixture's submittedAt, reviewer as actor.
 * Server pages and client components use this same helper so their
 * starting records always agree. Returns null for unknown references.
 */
export function fixtureApplicationRecord(ref: string): JobApplicationRecord | null {
  const row = jobApplications.find((a) => a.ref === ref);
  if (!row) return null;
  const terminal = row.status === "Offered" || row.status === "Not selected";
  const reached = terminal
    ? [...STAGE_ORDER, row.status]
    : STAGE_ORDER.slice(0, Math.max(1, STAGE_ORDER.indexOf(row.status) + 1));
  const reviewer = row.reviewer === "—" ? "Recruitment panel" : row.reviewer;
  const timeline: JobApplicationEvent[] = reached.map((status, index) => ({
    status,
    atIso: plusMs(row.submittedAtIso, index * DAY_MS),
    actor: status === "Submitted" ? "Applicant" : reviewer,
    note: STAGE_NOTES[status],
  }));
  return {
    ref: row.ref,
    vacancySlug: row.vacancySlug,
    name: row.name,
    submittedAtIso: row.submittedAtIso,
    status: row.status,
    timeline,
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic references                                            */
/* ------------------------------------------------------------------ */

/** Session counter seeded at 116 → JOB-2026-0116, JOB-2026-0117, … */
function nextReference(): string {
  const last = sessionGet<number>(REF_COUNTER_KEY) ?? 116;
  sessionSet(REF_COUNTER_KEY, last + 1);
  return `JOB-2026-${String(last).padStart(4, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Staff decisions                                                      */
/* ------------------------------------------------------------------ */

const PANEL_ACTOR = "Recruitment panel";

/** The reviewer who last acted on a record, or null before any staff event. */
export function applicationReviewer(record: JobApplicationRecord): string | null {
  const lastStaffEvent = [...record.timeline].reverse().find((event) => event.actor !== "Applicant");
  return lastStaffEvent ? lastStaffEvent.actor : null;
}

/** The named fixture reviewer when the row has one; otherwise the panel. */
function reviewerFor(ref: string): string {
  const reviewer = jobApplications.find((row) => row.ref === ref)?.reviewer;
  return reviewer && reviewer !== "—" ? reviewer : PANEL_ACTOR;
}

function allowedPhrase(statuses: readonly JobApplicationStatus[]): string {
  return statuses.map((status) => `"${status}"`).join(" or ");
}

function requireReason(note: string | undefined, actionLabel: string): string {
  const reason = note?.trim();
  if (!reason) {
    throw new Error(`${actionLabel} requires a reason — record why this decision is being made.`);
  }
  return reason;
}

/**
 * Shared staff-decision write: validates the transition, appends the
 * timestamped event with the actor and note, persists, and returns the
 * updated record. Retries are safe: an already-terminal record fails the
 * transition check instead of appending a duplicate event.
 */
function applyStaffDecision(
  ref: string,
  from: readonly JobApplicationStatus[],
  to: JobApplicationStatus,
  actionLabel: string,
  note: string,
  patch: Partial<JobApplicationRecord> = {},
): JobApplicationRecord {
  const record = loadRecord(ref);
  if (!record) throw new Error(`Application ${ref} was not found.`);
  if (!from.includes(record.status)) {
    throw new Error(
      `${actionLabel} is not allowed for ${ref}: the application is "${record.status}" — it must be ${allowedPhrase(from)}.`,
    );
  }
  const updated: JobApplicationRecord = {
    ...record,
    ...patch,
    status: to,
    timeline: [...record.timeline, { status: to, atIso: demoNowIso(), actor: reviewerFor(ref), note }],
  };
  saveRecord(updated);
  return updated;
}

/* ------------------------------------------------------------------ */
/* Demo adapter                                                        */
/* ------------------------------------------------------------------ */

export const careersService: CareersService = {
  async getVacancy(slug) {
    return respond(() => vacancies.find((v) => v.slug === slug) ?? null);
  },

  async saveDraft(slug, draft) {
    return respond(() => {
      const drafts = sessionGet<Record<string, JobDraft>>(DRAFTS_KEY) ?? {};
      drafts[slug] = draft;
      sessionSet(DRAFTS_KEY, drafts);
      return { savedAtIso: demoNowIso() };
    });
  },

  async submitApplication(slug, draft) {
    return respond(() => {
      const ref = nextReference();
      const now = demoNowIso();
      const record: JobApplicationRecord = {
        ref,
        vacancySlug: slug,
        name: draft.fullName,
        submittedAtIso: now,
        status: "Submitted",
        timeline: [
          { status: "Submitted", atIso: now, actor: "Applicant", note: "Application received by the school." },
        ],
      };
      saveRecord(record);
      return { ref };
    });
  },

  async getApplication(ref) {
    return respond(() => loadRecord(ref));
  },

  async withdraw(ref, by) {
    return respond(() => {
      const record = loadRecord(ref);
      if (!record) throw new Error("Application not found.");
      /* Idempotent: retries never append a duplicate Withdrawn event. */
      if (record.status === "Withdrawn") return record;
      const updated: JobApplicationRecord = {
        ...record,
        status: "Withdrawn",
        timeline: [
          ...record.timeline,
          { status: "Withdrawn", atIso: demoNowIso(), actor: by, note: "Application withdrawn by the applicant." },
        ],
      };
      saveRecord(updated);
      return updated;
    });
  },

  async listStaffRecords() {
    return respond(() => {
      const sessionRecords = allRecords();
      const records = [
        /* Every fixture row, minus any whose ref is already in the session
           (the session copy carries the mutated status and timeline). */
        ...jobApplications
          .map((row) => fixtureApplicationRecord(row.ref))
          .filter((record): record is JobApplicationRecord => record !== null)
          .filter((record) => !(record.ref in sessionRecords)),
        ...Object.values(sessionRecords),
      ];
      return records.sort((a, b) => b.submittedAtIso.localeCompare(a.submittedAtIso));
    });
  },

  async staffShortlist(ref, note) {
    return respond(() =>
      applyStaffDecision(
        ref,
        ["Submitted", "Eligibility review"],
        "Shortlisted",
        "Shortlisting",
        note?.trim() || "Candidate shortlisted for the next stage.",
      ),
    );
  },

  async staffRequestInterview(ref, note) {
    const now = demoNowIso();
    const reason = note?.trim();
    return respond(() =>
      applyStaffDecision(ref, ["Shortlisted"], "Interview", "Requesting an interview", reason || "Interview requested — the panel will confirm the slot.", {
        /* A demo slot three days from the decision instant; the applicant
           status view renders it once the panel fixes the time. */
        interview: { atIso: plusMs(now, 3 * DAY_MS), note: reason || undefined },
      }),
    );
  },

  async staffOffer(ref, note) {
    return respond(() =>
      applyStaffDecision(ref, ["Interview"], "Offered", "Offering the position", requireReason(note, "Offering the position")),
    );
  },

  async staffNotSelected(ref, note) {
    return respond(() =>
      applyStaffDecision(
        ref,
        ["Submitted", "Eligibility review", "Shortlisted", "Interview"],
        "Not selected",
        "Recording the candidate as not selected",
        requireReason(note, "Recording the candidate as not selected"),
      ),
    );
  },
};
