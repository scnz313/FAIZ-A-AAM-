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
import { auditService } from "@/modules/services/audit";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";

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
  /** Reviewer account id once assigned (staff projection). */
  reviewerAccountId?: string;
  /** Attributed scorecard rows (staff projection). */
  scorecards?: Array<{ score: number; notes: string | null; byAccountId: string; atIso: string }>;
  /** The latest immutable submitted snapshot (staff projection). */
  submittedSnapshot?: Record<string, unknown>;
};

/** The boundary every careers caller uses; the demo adapter is replaceable. */
export interface CareersService {
  /** Vacancy terms owned by the careers service; Supabase resolves published versions server-side. */
  listVacancies(): Promise<Vacancy[]>;
  getVacancy(slug: string): Promise<Vacancy | null>;
  /** Persist a form draft under the vacancy slug. */
  saveDraft(slug: string, draft: JobDraft, applicationRef?: string): Promise<{ savedAtIso: string; draftRef?: string }>;
  /** Recover the one owned durable draft for a vacancy on any device. */
  getDraft(slug: string): Promise<{ ref: string; draft: JobDraft; savedAtIso: string } | null>;
  /** Submit for a vacancy; resolves with the deterministic reference. */
  submitApplication(slug: string, draft: JobDraft, applicationRef?: string): Promise<{ ref: string }>;
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
  /** HR approver: assign a reviewer to an application (returns the refreshed record). */
  assignReviewer(ref: string, reviewerAccountId: string): Promise<JobApplicationRecord>;
  /** HR reviewer: record an attributed scorecard (returns the refreshed record). */
  saveScorecard(ref: string, score: number, notes?: string): Promise<JobApplicationRecord>;
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
  async listVacancies() {
    return respond(() => vacancies.map((vacancy) => ({ ...vacancy })));
  },

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

  async getDraft(slug) {
    return respond(() => {
      const draft = sessionGet<Record<string, JobDraft>>(DRAFTS_KEY)?.[slug];
      return draft ? { ref: `demo:${slug}`, draft, savedAtIso: demoNowIso() } : null;
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
    const result = await respond(() =>
      applyStaffDecision(
        ref,
        ["Submitted", "Eligibility review"],
        "Shortlisted",
        "Shortlisting",
        note?.trim() || "Candidate shortlisted for the next stage.",
      ),
    );
    void auditService.record({ actor: "HR office", action: "Application reviewed", target: ref, outcome: "Success", reason: "Candidate shortlisted" });
    return result;
  },

  async staffRequestInterview(ref, note) {
    const now = demoNowIso();
    const reason = note?.trim();
    const result = await respond(() =>
      applyStaffDecision(ref, ["Shortlisted"], "Interview", "Requesting an interview", reason || "Interview requested — the panel will confirm the slot.", {
        interview: { atIso: plusMs(now, 3 * DAY_MS), note: reason || undefined },
      }),
    );
    void auditService.record({ actor: "HR office", action: "Application reviewed", target: ref, outcome: "Success", reason: "Interview requested" });
    return result;
  },

  async staffOffer(ref, note) {
    const result = await respond(() =>
      applyStaffDecision(ref, ["Interview"], "Offered", "Offering the position", requireReason(note, "Offering the position")),
    );
    void auditService.record({ actor: "HR office", action: "Application reviewed", target: ref, outcome: "Success", reason: "Position offered" });
    return result;
  },

  async staffNotSelected(ref, note) {
    const result = await respond(() =>
      applyStaffDecision(
        ref,
        ["Submitted", "Eligibility review", "Shortlisted", "Interview"],
        "Not selected",
        "Recording the candidate as not selected",
        requireReason(note, "Recording the candidate as not selected"),
      ),
    );
    void auditService.record({ actor: "HR office", action: "Application reviewed", target: ref, outcome: "Success", reason: "Candidate not selected" });
    return result;
  },

  async assignReviewer(ref, reviewerAccountId) {
    /* Demo mode keeps the assignment in the session record for UI parity. */
    const result = await respond(() => {
      const record = loadRecord(ref);
      if (!record) throw new Error("Application not found.");
      const updated = { ...record, reviewerAccountId };
      saveRecord(updated);
      return updated;
    });
    void auditService.record({ actor: "HR office", action: "Reviewer assigned", target: ref, outcome: "Success", reason: "Reviewer assignment recorded" });
    return result;
  },

  async saveScorecard(ref, score, notes) {
    const result = await respond(() => {
      const record = loadRecord(ref);
      if (!record) throw new Error("Application not found.");
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        throw new Error("Score must be a whole number from 1 to 5.");
      }
      const updated = {
        ...record,
        scorecards: [...(record.scorecards ?? []), { score, notes: notes?.trim() || null, byAccountId: "demo-reviewer", atIso: demoNowIso() }],
      };
      saveRecord(updated);
      return updated;
    });
    void auditService.record({ actor: "HR office", action: "Scorecard saved", target: ref, outcome: "Success", reason: `Score ${score} recorded` });
    return result;
  },
};

/* ------------------------------------------------------------------ */
/* Supabase adapter (server rows → the same domain shapes)              */
/* ------------------------------------------------------------------ */

export type ServerJobRow = {
  id: string;
  reference: string;
  applicant_name?: string;
  owner_account_id?: string;
  vacancy_id?: string;
  current_status: string;
  version: number;
  created_at: string;
  job_vacancies?: { title?: string; reference?: string } | null;
  job_application_drafts?: Array<{ draft: Record<string, unknown>; schema_version: number; expires_at: string; updated_at: string; version?: number }> | null;
  job_interviews?: Array<{ scheduled_at: string; notes: string | null; outcome: string | null }> | null;
  job_application_versions: Array<{ version: number; snapshot: Record<string, unknown> }> | null;
  job_events: Array<{ event_type: string; visible_to_applicant: boolean; copy: string; created_at: string }> | null;
  job_review_assignments?: Array<{ reviewer_account_id: string; status: string; assigned_at: string }> | null;
  job_scorecards?: Array<{ score: number; notes: string | null; created_by_account_id: string; created_at: string }> | null;
};

const SERVER_STATUS_TO_DEMO: Record<string, JobApplicationStatus> = {
  draft: "Submitted",
  submitted: "Submitted",
  eligibility_review: "Eligibility review",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offered: "Offered",
  not_selected: "Not selected",
  withdrawn: "Withdrawn",
};

function isServerCareers(): boolean {
  return clientAdapterMode() === "supabase";
}

function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

type ServerVacancy = {
  vacancyId: string;
  versionId: string;
  reference: string;
  title: string;
  department: string | null;
  terms: Record<string, unknown>;
};

export function mapServerJob(row: ServerJobRow): JobApplicationRecord {
  const events = (row.job_events ?? [])
    .filter((event) => event.visible_to_applicant)
    .map((event) => ({
      status: SERVER_STATUS_TO_DEMO[event.event_type] ?? "Submitted",
      atIso: event.created_at,
      actor: event.event_type === "submitted" ? "Applicant" : "HR office",
      note: event.copy,
    }));
  const latestSnapshot = (row.job_application_versions ?? []).slice(-1)[0]?.snapshot ?? {};
  const name =
    typeof row.applicant_name === "string"
      ? row.applicant_name
      : typeof latestSnapshot.fullName === "string"
      ? latestSnapshot.fullName
      : typeof latestSnapshot.name === "string"
        ? latestSnapshot.name
        : row.reference;
  const interviewEvent = (row.job_events ?? []).find((event) => event.event_type === "interview");
  const reviewer = [...(row.job_review_assignments ?? [])]
    .sort((left, right) => left.assigned_at.localeCompare(right.assigned_at))
    .at(-1);
  return {
    ref: row.reference,
    vacancySlug: slugifyTitle(row.job_vacancies?.title ?? row.job_vacancies?.reference ?? "vacancy"),
    name,
    submittedAtIso: row.created_at,
    status: SERVER_STATUS_TO_DEMO[row.current_status] ?? "Submitted",
    timeline: events,
    interview: row.job_interviews?.[0]
      ? { atIso: row.job_interviews[0].scheduled_at, note: row.job_interviews[0].notes ?? undefined }
      : interviewEvent !== undefined && typeof (latestSnapshot.interviewAtIso as unknown) === "string"
        ? { atIso: String(latestSnapshot.interviewAtIso), note: undefined }
        : undefined,
    reviewerAccountId: reviewer?.status !== "revoked" ? reviewer?.reviewer_account_id : undefined,
    scorecards: (row.job_scorecards ?? []).map((card) => ({
      score: card.score,
      notes: card.notes,
      byAccountId: card.created_by_account_id,
      atIso: card.created_at,
    })),
    submittedSnapshot: latestSnapshot,
  };
}

const serverJobIds = new Map<string, string>();
const serverJobVersions = new Map<string, number>();

async function serverJobs(scope: "mine" | "staff"): Promise<JobApplicationRecord[]> {
  const result = await adapterCall<ServerJobRow[]>(scope === "mine" ? "jobs.listMine" : "jobs.staffQueue");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Applications unavailable.");
  for (const row of result.value) {
    serverJobIds.set(row.reference, row.id);
    serverJobVersions.set(row.reference, row.version);
  }
  return result.value.map(mapServerJob);
}

async function serverJobByRef(ref: string, scope: "mine" | "staff"): Promise<JobApplicationRecord | null> {
  const rows = await serverJobs(scope);
  return rows.find((row) => row.ref === ref) ?? null;
}

const originalSubmitApplication = careersService.submitApplication.bind(careersService);
const originalSaveDraft = careersService.saveDraft.bind(careersService);
const originalGetDraft = careersService.getDraft.bind(careersService);
const originalListVacancies = careersService.listVacancies.bind(careersService);
const originalGetApplication = careersService.getApplication.bind(careersService);
const originalGetVacancy = careersService.getVacancy.bind(careersService);
const originalWithdraw = careersService.withdraw.bind(careersService);
const originalListStaffRecords = careersService.listStaffRecords.bind(careersService);
const originalStaffShortlist = careersService.staffShortlist.bind(careersService);
const originalStaffRequestInterview = careersService.staffRequestInterview.bind(careersService);
const originalStaffOffer = careersService.staffOffer.bind(careersService);
const originalStaffNotSelected = careersService.staffNotSelected.bind(careersService);
const originalAssignReviewer = careersService.assignReviewer.bind(careersService);
const originalSaveScorecard = careersService.saveScorecard.bind(careersService);

/** Submit through the live pipeline: resolve the vacancy, create the draft
    application, then append the immutable submitted version. */
careersService.submitApplication = async (slug, draft, applicationRef) => {
  if (!isServerCareers()) return originalSubmitApplication(slug, draft);
  const vacanciesResult = await adapterCall<ServerVacancy[]>("jobs.vacancies");
  if (!vacanciesResult.ok) throw new Error(vacanciesResult.errors[0]?.message ?? "Vacancies unavailable.");
  const vacancy =
    vacanciesResult.value.find(
      (candidate) => candidate.reference === slug || slugifyTitle(candidate.title) === slug,
    ) ?? null;
  if (vacancy === null) throw new Error("This vacancy is not open for applications right now.");
  const existingRows = await adapterCall<ServerJobRow[]>("jobs.listMine");
  const existing = existingRows.ok
    ? existingRows.value.find((candidate) => applicationRef !== undefined ? candidate.reference === applicationRef : candidate.vacancy_id === vacancy.vacancyId && candidate.current_status === "draft")
    : undefined;
  const draftResult = existing
    ? { ok: true as const, value: { id: existing.id, ref: existing.reference, version: existing.version } }
    : await adapterCall<{ id: string; ref: string; version: number }>("jobs.createDraft", {
      vacancyRef: vacancy.reference,
      applicantName: draft.fullName,
    });
  if (!draftResult.ok) throw new Error(draftResult.errors[0]?.message ?? "Application could not be created.");
  const submitResult = await adapterCall<{ versionId: string }>("jobs.submit", {
    applicationRef: draftResult.value.ref,
    snapshot: { ...draft },
    expectedVersion: draftResult.value.version,
  });
  if (!submitResult.ok) throw new Error(submitResult.errors[0]?.message ?? "Submission failed — try again.");
  return { ref: draftResult.value.ref };
};

careersService.getVacancy = async (slug) => {
  if (!isServerCareers()) return originalGetVacancy(slug);
  const vacanciesResult = await adapterCall<ServerVacancy[]>("jobs.vacancies");
  if (!vacanciesResult.ok) throw new Error(vacanciesResult.errors[0]?.message ?? "Vacancies unavailable.");
  const vacancy = vacanciesResult.value.find((candidate) => candidate.reference === slug || slugifyTitle(candidate.title) === slug);
  if (!vacancy) return null;
  const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return { slug, title: vacancy.title, department: vacancy.department ?? "School office", location: typeof vacancy.terms.location === "string" ? vacancy.terms.location : "Faiz Aam School", type: vacancy.terms.type === "Non-teaching" ? "Non-teaching" : "Teaching", qualifications: stringArray(vacancy.terms.qualifications), documents: stringArray(vacancy.terms.documents), deadlineIso: typeof vacancy.terms.deadlineIso === "string" ? vacancy.terms.deadlineIso : new Date().toISOString(), status: "open", description: typeof vacancy.terms.description === "string" ? vacancy.terms.description : "Published vacancy details." };
};

careersService.listVacancies = async () => {
  if (!isServerCareers()) return originalListVacancies();
  const vacanciesResult = await adapterCall<ServerVacancy[]>("jobs.vacancies");
  if (!vacanciesResult.ok) throw new Error(vacanciesResult.errors[0]?.message ?? "Vacancies unavailable.");
  const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return vacanciesResult.value.map((vacancy) => ({
    slug: slugifyTitle(vacancy.title),
    title: vacancy.title,
    department: vacancy.department ?? "School office",
    location: typeof vacancy.terms.location === "string" ? vacancy.terms.location : "School office",
    type: vacancy.terms.type === "Non-teaching" ? "Non-teaching" : "Teaching",
    qualifications: stringArray(vacancy.terms.qualifications),
    documents: stringArray(vacancy.terms.documents),
    deadlineIso: typeof vacancy.terms.deadlineIso === "string" ? vacancy.terms.deadlineIso : new Date().toISOString(),
    status: "open",
    description: typeof vacancy.terms.description === "string" ? vacancy.terms.description : "Published vacancy details.",
  }));
};

careersService.getDraft = async (slug) => {
  if (!isServerCareers()) return originalGetDraft(slug);
  const vacanciesResult = await adapterCall<ServerVacancy[]>("jobs.vacancies");
  if (!vacanciesResult.ok) throw new Error(vacanciesResult.errors[0]?.message ?? "Vacancies unavailable.");
  const vacancy = vacanciesResult.value.find((candidate) => candidate.reference === slug || slugifyTitle(candidate.title) === slug);
  if (!vacancy) return null;
  const listed = await adapterCall<ServerJobRow[]>("jobs.listMine");
  if (!listed.ok) throw new Error(listed.errors[0]?.message ?? "Applications unavailable.");
  const row = listed.value.find((candidate) => candidate.vacancy_id === vacancy.vacancyId && candidate.current_status === "draft");
  const saved = row?.job_application_drafts?.[0];
  if (!row || !saved) return null;
  return { ref: row.reference, draft: saved.draft as unknown as JobDraft, savedAtIso: saved.updated_at };
};

careersService.saveDraft = async (slug, draft, applicationRef) => {
  if (!isServerCareers()) return originalSaveDraft(slug, draft);
  const vacanciesResult = await adapterCall<ServerVacancy[]>("jobs.vacancies");
  if (!vacanciesResult.ok) throw new Error(vacanciesResult.errors[0]?.message ?? "Vacancies unavailable.");
  const vacancy = vacanciesResult.value.find((candidate) => candidate.reference === slug || slugifyTitle(candidate.title) === slug);
  if (!vacancy) throw new Error("This vacancy is not open for applications right now.");
  const listed = await adapterCall<ServerJobRow[]>("jobs.listMine");
  let row = listed.ok ? listed.value.find((candidate) => (applicationRef !== undefined ? candidate.reference === applicationRef : candidate.vacancy_id === vacancy.vacancyId && candidate.current_status === "draft")) : undefined;
  if (!row) {
    const created = await adapterCall<{ id: string; ref: string; version: number }>("jobs.createDraft", { vacancyRef: vacancy.reference, applicantName: draft.fullName });
    if (!created.ok) throw new Error(created.errors[0]?.message ?? "Application could not be created.");
    const reread = await adapterCall<ServerJobRow[]>("jobs.listMine");
    row = reread.ok ? reread.value.find((candidate) => candidate.id === created.value.id) : undefined;
  }
  if (!row) throw new Error("Job application could not be resumed.");
  const saved = await adapterCall<{ updatedAt: string }>("jobs.saveDraft", { applicationRef: row.reference, draft, expectedVersion: row.version });
  if (!saved.ok) throw new Error(saved.errors[0]?.message ?? "Unable to save job draft.");
  return { savedAtIso: saved.value.updatedAt, draftRef: row.reference };
};

careersService.getApplication = async (ref) =>
  isServerCareers() ? (await serverJobByRef(ref, "mine")) ?? serverJobByRef(ref, "staff") : originalGetApplication(ref);
careersService.listStaffRecords = async () =>
  isServerCareers() ? serverJobs("staff") : originalListStaffRecords();

careersService.withdraw = async (ref, by) => {
  if (!isServerCareers()) return originalWithdraw(ref, by);
  const applicationId = serverJobIds.get(ref) ?? (await serverJobs("mine"), serverJobIds.get(ref));
  if (!applicationId) throw new Error("Application not found.");
  const result = await adapterCall<unknown>("jobs.withdraw", { applicationRef: ref, expectedVersion: serverJobVersions.get(ref) ?? null });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Unable to withdraw application.");
  return (await serverJobByRef(ref, "mine")) ?? { ref, vacancySlug: "", name: by, submittedAtIso: new Date().toISOString(), status: "Withdrawn", timeline: [] };
};

async function serverDecide(
  ref: string,
  action: "shortlist" | "interview" | "offer" | "not_selected",
  note?: string,
): Promise<JobApplicationRecord> {
  const applicationId = serverJobIds.get(ref);
  if (applicationId === undefined) throw new Error("Application not found in the queue.");
  const result = await adapterCall<unknown>("jobs.decideV2", {
    applicationRef: ref,
    action,
    reason: note?.trim() || null,
    expectedVersion: serverJobVersions.get(ref) ?? null,
    scheduledAt: action === "interview" ? new Date(Date.now() + 3 * DAY_MS).toISOString() : null,
  });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Decision failed.");
  await serverJobs("staff");
  return serverJobByRef(ref, "staff") as Promise<JobApplicationRecord>;
}

careersService.staffShortlist = async (ref, note) => {
  if (!isServerCareers()) return originalStaffShortlist(ref, note);
  return serverDecide(ref, "shortlist", note);
};
careersService.staffRequestInterview = async (ref, note) => {
  if (!isServerCareers()) return originalStaffRequestInterview(ref, note);
  return serverDecide(ref, "interview", note);
};
careersService.staffOffer = async (ref, note) => {
  if (!isServerCareers()) return originalStaffOffer(ref, note);
  return serverDecide(ref, "offer", note);
};
careersService.staffNotSelected = async (ref, note) => {
  if (!isServerCareers()) return originalStaffNotSelected(ref, note);
  return serverDecide(ref, "not_selected", note);
};
careersService.assignReviewer = async (ref, reviewerAccountId) => {
  if (!isServerCareers()) return originalAssignReviewer(ref, reviewerAccountId);
  const applicationId = serverJobIds.get(ref);
  if (applicationId === undefined) throw new Error("Application not found in the queue.");
  const result = await adapterCall<unknown>("jobs.assignReviewer", { applicationRef: ref, reviewerAccountId });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Reviewer assignment failed.");
  return (await serverJobs("staff")).find((candidate) => candidate.ref === ref) as JobApplicationRecord;
};
careersService.saveScorecard = async (ref, score, notes) => {
  if (!isServerCareers()) return originalSaveScorecard(ref, score, notes);
  const applicationId = serverJobIds.get(ref);
  if (applicationId === undefined) throw new Error("Application not found in the queue.");
  const result = await adapterCall<unknown>("jobs.saveScorecard", { applicationRef: ref, score, notes: notes?.trim() || null });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Scorecard could not be saved.");
  return (await serverJobs("staff")).find((candidate) => candidate.ref === ref) as JobApplicationRecord;
};
