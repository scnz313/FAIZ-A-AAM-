/**
 * Admissions domain service boundary.
 *
 * route/page → feature component → AdmissionsService interface
 *   → deterministic demo adapter (this module) now
 *   → authenticated server adapter later
 *
 * The demo adapter reads and writes the demo-session store, so a submitted
 * application, an offer response, or a requested-change edit survives route
 * changes within the browser session and is always returned by the service —
 * never implied by a local click. References and timestamps are
 * deterministic: a session counter (seeded 424) and the injected demo clock
 * from `modules/demo/clock.ts` — no Date.now()/Math.random() in refs or
 * record timestamps. All data is fictional demo data.
 */

import { demoNowIso } from "@/modules/demo/clock";
import {
  demoApplication,
  staffApplications,
  type ApplicationEvent,
  type ApplicationStatus,
} from "@/modules/admissions/demo";
import { financeService } from "@/modules/services/finance";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";
import { schoolConfigService } from "@/modules/services/school-config";

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

export type { ApplicationEvent, ApplicationStatus };

/** The eight-step admission form values — shared by the form and the service. */
export type ApplicationDraft = {
  session: string;
  grade: string;
  studentName: string;
  dob: string;
  gender: string;
  placeOfBirth: string;
  guardianName: string;
  relation: string;
  phone: string;
  email: string;
  occupation: string;
  houseStreet: string;
  villageTown: string;
  district: string;
  pin: string;
  priorSchoolName: string;
  lastClassAttended: string;
  leavingCertificate: string;
  conditions: string[];
  documents: Record<string, string>;
  consent: boolean;
};

export type ApplicationOffer = {
  grade: string;
  session: string;
  acceptByIso: string;
  admissionFeePaise: number;
  accepted: boolean;
  declined?: boolean;
  respondedAtIso?: string;
  responseNote?: string;
  /** Admission invoice issued once through finance when the seat is accepted. */
  admissionInvoiceRef?: string;
};

export type ApplicationRecord = {
  ref: string;
  session: string;
  grade: string;
  studentName: string;
  parentName: string;
  contact: string;
  submittedAtIso: string;
  status: ApplicationStatus;
  timeline: ApplicationEvent[];
  offer?: ApplicationOffer;
  /** Permanent records created by enrollment conversion (I3). */
  studentRef?: string;
  enrollmentRef?: string;
  linkRef?: string;
  /** Server-only duplicate signal; never auto-merges on a name match. */
  duplicateReview?: boolean;
  /** Authoritative reviewer identity/reference when loaded from Supabase. */
  reviewer?: string;
  /**
   * Maker/checker (Phase 1): the account that moved this application to
   * assessment. The same account may not offer/waitlist/decline it — a
   * different approver must record the decision. Recorded on the
   * session-saved copy only; fixture rows carry no reviewer identity.
   */
  reviewedByAccountId?: string;
};

/** A staff-queue row: the application record plus queue-only fields. */
export type StaffQueueRecord = ApplicationRecord & {
  reviewer?: string;
  flagged?: boolean;
};

export type ServerAdmissionRow = {
  id: string;
  reference: string;
  academic_year_id: string;
  grade_id: string;
  current_status: string;
  student_name: string;
  parent_name: string;
  parent_contact: string | null;
  version: number;
  submitted_at: string | null;
  created_at: string;
  academic_years: { label: string; starts_on: string; ends_on: string; status: string } | null;
  grades: { label: string } | null;
  admission_drafts: Array<{ draft: Record<string, unknown>; schema_version: number; expires_at: string; updated_at: string }> | null;
  admission_application_versions: Array<{ id: string; version: number; snapshot: Record<string, unknown>; schema_version: number; created_at: string }> | null;
  admission_events: Array<{ event_type: string; visible_to_applicant: boolean; copy: string; created_at: string }> | null;
  admission_reviews?: Array<{ officer_account_id: string; created_at: string }> | null;
  admission_offers: Array<{
    id: string;
    grade_id: string;
    academic_year_id: string;
    conditions: Record<string, unknown>;
    expires_at: string;
    fee_required: boolean;
    admission_invoice_ref: string | null;
    response: string;
    responded_at: string | null;
    decided_by_account_id: string | null;
    version: number;
  }> | null;
};

const SERVER_STATUS_TO_APPLICATION: Record<string, ApplicationStatus> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  changes_requested: "Changes requested",
  assessment: "Assessment",
  offered: "Offered",
  waitlisted: "Waitlisted",
  declined: "Declined",
  enrolled: "Enrolled",
  withdrawn: "Declined",
  duplicate_review: "Under review",
};

const SERVER_EVENT_TO_STATUS: Record<string, ApplicationStatus> = {
  submitted: "Submitted",
  under_review: "Under review",
  assessment: "Assessment",
  changes_requested: "Changes requested",
  offered: "Offered",
  waitlisted: "Waitlisted",
  declined: "Declined",
  offer_accepted: "Offered",
  offer_declined: "Declined",
  invoice_issued: "Offered",
  enrolled: "Enrolled",
};

const serverAdmissionIds = new Map<string, { id: string; version: number; offerVersion: number }>();

export function mapServerApplication(row: ServerAdmissionRow, invoiceAmountPaise = 0): ApplicationRecord {
  const offer = row.admission_offers?.[0];
  const reviewer = [...(row.admission_reviews ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1)?.officer_account_id;
  const timeline = (row.admission_events ?? [])
    .filter((event) => event.visible_to_applicant)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((event) => ({
      status: SERVER_EVENT_TO_STATUS[event.event_type] ?? SERVER_STATUS_TO_APPLICATION[row.current_status] ?? "Submitted",
      atIso: event.created_at,
      actor: event.event_type === "submitted" ? "Applicant" : "Admissions office",
      note: event.copy,
    }));
  if (timeline.length === 0 && row.current_status !== "draft") {
    timeline.push({
      status: SERVER_STATUS_TO_APPLICATION[row.current_status] ?? "Submitted",
      atIso: row.submitted_at ?? row.created_at,
      actor: "Admissions office",
      note: "Application status recorded by the school.",
    });
  }
  const record: ApplicationRecord = {
    ref: row.reference,
    session: row.academic_years?.label ?? row.academic_year_id,
    grade: row.grades?.label ?? row.grade_id,
    studentName: row.student_name,
    parentName: row.parent_name,
    contact: row.parent_contact ?? "—",
    submittedAtIso: row.submitted_at ?? row.created_at,
    status: SERVER_STATUS_TO_APPLICATION[row.current_status] ?? "Submitted",
    timeline,
    duplicateReview: row.current_status === "duplicate_review",
    reviewer,
    reviewedByAccountId: reviewer,
    offer: offer === undefined
      ? undefined
      : {
          grade: row.grades?.label ?? row.grade_id,
          session: row.academic_years?.label ?? row.academic_year_id,
          acceptByIso: offer.expires_at,
          admissionFeePaise:
            typeof offer.conditions.admissionFeePaise === "number" ? offer.conditions.admissionFeePaise : invoiceAmountPaise,
          accepted: offer.response === "accepted",
          declined: offer.response === "declined",
          respondedAtIso: offer.responded_at ?? undefined,
          admissionInvoiceRef: offer.admission_invoice_ref ?? undefined,
        },
  };
  serverAdmissionIds.set(row.reference, { id: row.id, version: row.version, offerVersion: offer?.version ?? 1 });
  return record;
}

async function serverAdmissionRawRows(scope: "mine" | "staff"): Promise<ServerAdmissionRow[]> {
  const result = await adapterCall<ServerAdmissionRow[]>(scope === "mine" ? "admissions.listMine" : "admissions.staffQueue");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Admissions are unavailable.");
  return result.value;
}

async function serverAdmissionRows(scope: "mine" | "staff"): Promise<ApplicationRecord[]> {
  return (await serverAdmissionRawRows(scope)).map((row) => mapServerApplication(row));
}

async function serverApplicationByRef(ref: string, scope: "mine" | "staff"): Promise<ApplicationRecord | null> {
  return (await serverAdmissionRows(scope)).find((record) => record.ref === ref) ?? null;
}

export async function resolveServerApplicationId(ref: string, scope: "mine" | "staff" = "mine"): Promise<string> {
  if (!serverAdmissionIds.has(ref)) await serverAdmissionRows(scope);
  const target = serverAdmissionIds.get(ref);
  if (target === undefined) throw new Error("Application not found.");
  return target.id;
}

async function serverDraftByRef(ref: string): Promise<ApplicationDraft | null> {
  const rows = await serverAdmissionRawRows("mine");
  const row = rows.find((candidate) => candidate.reference === ref);
  if (row) mapServerApplication(row);
  return row?.admission_drafts?.[0]?.draft as ApplicationDraft | null ?? null;
}

function normalizedLabel(value: string): string {
  return value.replace(/[–—]/g, "-").replace(/\s+/g, "").toLowerCase();
}

async function serverAdmissionConfig(draft: ApplicationDraft): Promise<{ academicYearRef: string; gradeRef: string }> {
  const configuration = await schoolConfigService.getConfiguration();
  const year = configuration.academicYears.find((candidate) => normalizedLabel(candidate.label) === normalizedLabel(draft.session));
  const grade = configuration.grades.find((candidate) => normalizedLabel(candidate.label) === normalizedLabel(draft.grade));
  if (year === undefined || grade === undefined) {
    throw new Error("The selected academic year or grade is not available in the current school configuration.");
  }
  return { academicYearRef: year.ref, gradeRef: grade.code };
}

async function serverAdmissionDecision(
  ref: string,
  operation: "reviewAdvance" | "decide",
  payload: Record<string, unknown>,
): Promise<ApplicationRecord> {
  if (!serverAdmissionIds.has(ref)) await serverAdmissionRows("staff");
  const target = serverAdmissionIds.get(ref);
  if (target === undefined) throw new Error("Application not found.");
  const result = await adapterCall(
    operation === "reviewAdvance" ? "admissions.reviewAdvance" : "admissions.decide",
    { applicationRef: ref, expectedVersion: target.version, ...payload },
  );
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Admission decision failed.");
  const updated = await serverApplicationByRef(ref, "staff");
  if (updated === null) throw new Error("Admission decision was accepted but the updated application is unavailable.");
  return updated;
}

/** The boundary every admissions caller uses; the demo adapter is replaceable. */
export interface AdmissionsService {
  /** Persist a form draft under a key ("new", or an application ref when editing). */
  saveDraft(key: string, draft: ApplicationDraft): Promise<{ savedAtIso: string; draftRef?: string }>;
  getDraft(key: string): Promise<ApplicationDraft | null>;
  /** Submit the final form; resolves with the issued (or re-opened) reference. */
  submitApplication(draft: ApplicationDraft, draftRef?: string): Promise<{ ref: string }>;
  /** The record for a reference, or null when it is not in the school's records. */
  getApplication(ref: string): Promise<ApplicationRecord | null>;
  /** Applicant response to a seat offer; appends a timeline event. */
  respondToOffer(ref: string, accepted: boolean, by: string, note?: string): Promise<ApplicationRecord>;
  /**
   * Enrollment conversion handoff: mark the application Enrolled and record
   * the permanent student/enrollment/link references. Idempotent — an
   * already-enrolled application returns its record unchanged.
   */
  markEnrolled(
    ref: string,
    input: { studentRef: string; enrollmentRef: string; linkRef: string | null },
  ): Promise<ApplicationRecord>;
  /** Staff action: request changes on a submitted application. */
  requestChange(ref: string, reason: string): Promise<ApplicationRecord>;
  /** Applicant withdrawal — gated on a school policy decision. */
  withdraw(ref: string, by: string): Promise<ApplicationRecord>;
  /** Staff queue: every fixture row plus session-saved records, newest first. */
  listStaffRecords(): Promise<StaffQueueRecord[]>;
  /**
   * Staff action: send the application to the assessment panel. Records the
   * acting account as the reviewer (maker) for maker/checker separation when
   * `actorAccountId` is supplied; legacy callers may omit it.
   */
  staffMoveToAssessment(ref: string, note?: string, actorAccountId?: string): Promise<ApplicationRecord>;
  /**
   * Staff action: offer a seat after assessment; reason required; a safe
   * no-op when already Offered. Rejects when `actorAccountId` is the same
   * account that reviewed the application (maker/checker).
   */
  staffOfferSeat(ref: string, note: string, actorAccountId?: string): Promise<ApplicationRecord>;
  /**
   * Staff action: place the application on the waitlist; reason required.
   * Rejects when `actorAccountId` reviewed the application (maker/checker).
   */
  staffWaitlist(ref: string, note: string, actorAccountId?: string): Promise<ApplicationRecord>;
  /**
   * Staff action: decline the application; reason required. Rejects when
   * `actorAccountId` reviewed the application (maker/checker).
   */
  staffDecline(ref: string, note: string, actorAccountId?: string): Promise<ApplicationRecord>;
}

/* ------------------------------------------------------------------ */
/* Demo-session store                                                  */
/* ------------------------------------------------------------------ */

const RECORDS_KEY = sessionKey("admissions");
const DRAFTS_KEY = sessionKey("admissions-drafts");
const DRAFT_KEY_SLOT = sessionKey("admissions-current-draft-key");
const REF_COUNTER_KEY = sessionKey("admissions-ref-counter");

/** Exported so tests can clear the demo session deterministically. */
export const ADMISSIONS_SESSION_KEYS = {
  records: RECORDS_KEY,
  drafts: DRAFTS_KEY,
  draftSlot: DRAFT_KEY_SLOT,
  counter: REF_COUNTER_KEY,
} as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Fixed simulated network latency — deterministic demo timing (Phase 1). */
const LATENCY_MS = 200;

async function respond<T>(compute: () => T): Promise<T> {
  await sleep(LATENCY_MS);
  return compute();
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

function plusMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

function allRecords(): Record<string, ApplicationRecord> {
  return sessionGet<Record<string, ApplicationRecord>>(RECORDS_KEY) ?? {};
}

function saveRecord(record: ApplicationRecord): void {
  const records = allRecords();
  records[record.ref] = record;
  sessionSet(RECORDS_KEY, records);
}

/** Session store first (so mutated fixture records persist), then fixtures. */
function loadRecord(ref: string): ApplicationRecord | null {
  return allRecords()[ref] ?? fixtureApplicationRecord(ref);
}

/* ------------------------------------------------------------------ */
/* Fixture-derived records                                             */
/* ------------------------------------------------------------------ */

/** Second known reference (from the staff queue fixture) in the
    "Changes requested" state, so the requested-change editing journey is
    reviewable in the demo. Timestamps derive from the fixture's submittedAt. */
const CHANGES_REQUESTED_REF = "APP-2026-0420";

function changesRequestedFixtureRecord(): ApplicationRecord | null {
  const row = staffApplications.find((a) => a.ref === CHANGES_REQUESTED_REF);
  if (!row) return null;
  const submittedAt = row.submittedAtIso;
  return {
    ref: row.ref,
    session: "2026-27",
    grade: row.grade,
    studentName: row.studentName,
    parentName: "Rashida Koul",
    contact: "+91 90000 00000",
    submittedAtIso: submittedAt,
    status: "Changes requested",
    timeline: [
      { status: "Submitted", atIso: submittedAt, actor: "Applicant", note: "Application submitted with all required documents." },
      { status: "Under review", atIso: plusMs(submittedAt, DAY_MS), actor: "Admissions office", note: "Documents verified; eligibility confirmed." },
      { status: "Changes requested", atIso: plusMs(submittedAt, 2 * DAY_MS), actor: "Admissions office", note: "Previous-school report card was unreadable — re-upload requested." },
    ],
  };
}

/* Ordered pre-decision stages used to derive a fixture timeline: one event
   per stage, one day apart from the row's submittedAt — the same pattern
   the careers service uses for its seeded records. */
const STAGE_ORDER: readonly ApplicationStatus[] = ["Submitted", "Under review", "Assessment"];

const STAGE_NOTES: Record<ApplicationStatus, string> = {
  Draft: "Draft in progress — not yet submitted.",
  Submitted: "Application submitted with all required documents.",
  "Under review": "Documents verified; eligibility confirmed.",
  "Changes requested": "The applicant was asked to correct or re-upload information.",
  Assessment: "Interaction with the student and guardian completed.",
  Offered: "Seat offered for the requested grade and session.",
  Waitlisted: "Placed on the waitlist pending seat availability.",
  Declined: "Application declined by the admissions office.",
  Enrolled: "Applicant enrolled for the session.",
};

const TERMINAL_STATUSES: readonly ApplicationStatus[] = ["Offered", "Waitlisted", "Declined", "Enrolled"];

/**
 * The record behind any staff queue reference. The two rich demo fixtures
 * (APP-2026-0417 with its authored timeline and offer, APP-2026-0420 with
 * its requested-change note) keep their written history; every other queue
 * row derives a small deterministic timeline — one event per stage, one day
 * apart from the row's submittedAtIso, reviewer as actor. Shared by the
 * server page and the demo adapter so both derive identical records.
 */
export function fixtureApplicationRecord(ref: string): ApplicationRecord | null {
  if (ref === demoApplication.ref) {
    const app = demoApplication;
    return {
      ref: app.ref,
      session: app.session,
      grade: app.grade,
      studentName: app.studentName,
      parentName: app.parentName,
      contact: app.contact,
      submittedAtIso: app.submittedAtIso,
      status: app.currentStatus,
      timeline: app.timeline,
      offer: app.offer ? { ...app.offer } : undefined,
    };
  }
  if (ref === CHANGES_REQUESTED_REF) return changesRequestedFixtureRecord();

  const row = staffApplications.find((a) => a.ref === ref);
  if (!row) return null;

  const stageIndex = STAGE_ORDER.indexOf(row.status);
  const reached = stageIndex >= 0 ? STAGE_ORDER.slice(0, stageIndex + 1) : TERMINAL_STATUSES.includes(row.status) ? [...STAGE_ORDER, row.status] : [row.status];
  const reviewer = row.reviewer === "—" ? "Admissions office" : row.reviewer;
  const timeline: ApplicationEvent[] = reached.map((status, index) => ({
    status,
    atIso: plusMs(row.submittedAtIso, index * DAY_MS),
    actor: status === "Submitted" ? "Applicant" : reviewer,
    note: STAGE_NOTES[status],
  }));
  return {
    ref: row.ref,
    session: "2026-27",
    grade: row.grade,
    studentName: row.studentName,
    parentName: "Not recorded",
    contact: "—",
    submittedAtIso: row.submittedAtIso,
    status: row.status,
    timeline,
    offer:
      row.status === "Offered"
        ? {
            grade: row.grade,
            session: "2026-27",
            acceptByIso: plusMs(row.submittedAtIso, 44 * DAY_MS),
            admissionFeePaise: 200000,
            accepted: false,
          }
        : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Staff decision helpers                                               */
/* ------------------------------------------------------------------ */

/** Consequential staff actions always record a reason on the timeline. */
function requiredReason(action: string, note?: string): string {
  const reason = note?.trim() ?? "";
  if (!reason) throw new Error(`${action} requires a reason.`);
  return reason;
}

const MOVE_TO_ASSESSMENT_FROM: readonly ApplicationStatus[] = ["Submitted", "Under review", "Changes requested"];
const WAITLIST_FROM: readonly ApplicationStatus[] = ["Assessment", "Submitted", "Under review"];
const DECLINE_FROM: readonly ApplicationStatus[] = ["Submitted", "Under review", "Changes requested", "Assessment", "Waitlisted"];

/**
 * Maker/checker (Phase 1): an approver may not decide on an application they
 * reviewed. Only enforced when an actor account is supplied — legacy
 * callers/tests that omit it keep the previous behavior.
 */
function requireDifferentApprover(record: ApplicationRecord, actorAccountId?: string): void {
  if (
    actorAccountId !== undefined &&
    record.reviewedByAccountId !== undefined &&
    actorAccountId === record.reviewedByAccountId
  ) {
    throw new Error(
      "Maker/checker separation — this account reviewed the application and cannot approve its own review; another approver must record the decision.",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic references                                            */
/* ------------------------------------------------------------------ */

/** Session counter seeded at 424 → APP-2026-0424, APP-2026-0425, … */
function nextReference(): string {
  const last = sessionGet<number>(REF_COUNTER_KEY) ?? 424;
  sessionSet(REF_COUNTER_KEY, last + 1);
  return `APP-2026-0${String(last).padStart(3, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Demo adapter                                                        */
/* ------------------------------------------------------------------ */

export const admissionsService: AdmissionsService = {
  async saveDraft(key, draft) {
    if (clientAdapterMode() === "supabase") {
      const configuration = await serverAdmissionConfig(draft);
      const existing = key === "new" ? undefined : serverAdmissionIds.get(key);
      const result = await adapterCall<{
        id: string;
        reference: string;
        version: number;
        status: string;
        updatedAt: string;
      }>("admissions.saveDraft", {
        applicationRef: existing === undefined ? undefined : key,
        academicYearRef: configuration.academicYearRef,
        gradeRef: configuration.gradeRef,
        studentName: draft.studentName,
        parentName: draft.guardianName,
        parentContact: draft.phone,
        draft: { ...draft },
        schemaVersion: 1,
        expectedVersion: existing?.version ?? null,
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Draft could not be saved.");
      serverAdmissionIds.set(result.value.reference, { id: result.value.id, version: result.value.version, offerVersion: 1 });
      return { savedAtIso: result.value.updatedAt, draftRef: result.value.reference };
    }
    return respond(() => {
      const drafts = sessionGet<Record<string, ApplicationDraft>>(DRAFTS_KEY) ?? {};
      drafts[key] = draft;
      sessionSet(DRAFTS_KEY, drafts);
      sessionSet(DRAFT_KEY_SLOT, key);
      return { savedAtIso: demoNowIso() };
    });
  },

  async getDraft(key) {
    if (clientAdapterMode() === "supabase") return serverDraftByRef(key);
    return respond(() => sessionGet<Record<string, ApplicationDraft>>(DRAFTS_KEY)?.[key] ?? null);
  },

  async submitApplication(draft, draftRef) {
    if (clientAdapterMode() === "supabase") {
      const targetRef = draftRef;
      const target = targetRef === undefined ? undefined : serverAdmissionIds.get(targetRef);
      if (targetRef === undefined || target === undefined) {
        throw new Error("Save the application draft before submitting it.");
      }
      const result = await adapterCall<{ versionId: string }>("admissions.submit", {
        applicationRef: targetRef,
        snapshot: { ...draft },
        expectedVersion: target.version,
        schemaVersion: 1,
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Application submission failed.");
      return { ref: targetRef };
    }
    return respond(() => {
      /* An edit session (the last draft was saved under an application ref)
         updates that application in place, appending to its timeline; every
         other submission issues a new deterministic reference. */
      const editRef = sessionGet<string>(DRAFT_KEY_SLOT);
      const existing = editRef ? loadRecord(editRef) : null;
      if (existing) {
        const now = demoNowIso();
        const updated: ApplicationRecord = {
          ...existing,
          status: "Submitted",
          timeline: [
            ...existing.timeline,
            { status: "Submitted", atIso: now, actor: "Applicant", note: "Updated application submitted after the requested changes." },
            { status: "Under review", atIso: plusMs(now, 30 * MIN_MS), actor: "Admissions office", note: "Documents received. The admissions office is verifying eligibility." },
          ],
        };
        saveRecord(updated);
        return { ref: updated.ref };
      }

      const ref = nextReference();
      const now = demoNowIso();
      const record: ApplicationRecord = {
        ref,
        session: draft.session,
        grade: draft.grade,
        studentName: draft.studentName,
        parentName: draft.guardianName,
        contact: draft.phone,
        submittedAtIso: now,
        status: "Submitted",
        timeline: [
          { status: "Submitted", atIso: now, actor: "Applicant", note: "Application submitted with all required documents." },
          { status: "Under review", atIso: plusMs(now, 30 * MIN_MS), actor: "Admissions office", note: "Documents received. The admissions office is verifying eligibility." },
        ],
      };
      saveRecord(record);
      return { ref };
    });
  },

  async getApplication(ref) {
    if (clientAdapterMode() === "supabase") {
      return (await serverApplicationByRef(ref, "mine")) ?? (await serverApplicationByRef(ref, "staff"));
    }
    return respond(() => loadRecord(ref));
  },

  async respondToOffer(ref, accepted, by, note) {
    if (clientAdapterMode() === "supabase") {
      const target = serverAdmissionIds.get(ref);
      const current = await serverApplicationByRef(ref, "mine");
      if (target === undefined || current === null || current.offer === undefined) throw new Error("Application offer not found.");
      const result = await adapterCall<{ invoiceRef: string | null }>("admissions.respondOffer", {
        applicationRef: ref,
        response: accepted ? "accepted" : "declined",
        offerVersion: target.offerVersion,
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Offer response failed.");
      return (await serverApplicationByRef(ref, "mine")) ?? current;
    }
    const updated = await respond(() => {
      const record = loadRecord(ref);
      if (!record) throw new Error("Application not found.");
      if (!record.offer) throw new Error("There is no outstanding offer on this application.");
      if (record.offer.accepted || record.offer.declined) throw new Error("This offer has already been responded to.");
      const now = demoNowIso();
      const reason = note?.trim();
      const next: ApplicationRecord = {
        ...record,
        status: accepted ? "Offered" : "Declined",
        timeline: [
          ...record.timeline,
          accepted
            ? { status: "Offered", atIso: now, actor: by, note: reason || "Seat accepted — the admission fee is now due." }
            : { status: "Declined", atIso: now, actor: by, note: reason || "Offer declined — the seat is released to the next candidate." },
        ],
        offer: {
          ...record.offer,
          accepted: accepted ? true : record.offer.accepted,
          declined: accepted ? false : true,
          respondedAtIso: now,
          responseNote: reason || undefined,
        },
      };
      saveRecord(next);
      return next;
    });

    /* An accepted seat issues its admission invoice exactly once through the
       finance ledger; the payment that follows posts to that invoice. */
    if (accepted && updated.offer?.admissionInvoiceRef === undefined) {
      const invoice = await financeService.createAdmissionInvoice({
        applicantRef: updated.ref,
        grade: updated.grade,
        session: updated.session,
        amountPaise: updated.offer!.admissionFeePaise,
        acceptByIso: updated.offer!.acceptByIso,
      });
      const withInvoice: ApplicationRecord = {
        ...updated,
        offer: { ...updated.offer!, admissionInvoiceRef: invoice.invoice.ref },
        timeline: updated.timeline.map((event, index) =>
          index === updated.timeline.length - 1
            ? { ...event, note: `Seat accepted — admission invoice ${invoice.invoice.ref} issued.` }
            : event,
        ),
      };
      saveRecord(withInvoice);
      return withInvoice;
    }
    return updated;
  },

  async markEnrolled(ref, input) {
    return respond(() => {
      const record = loadRecord(ref);
      if (!record) throw new Error("Application not found.");
      /* Idempotent: a retried conversion never re-appends the event. */
      if (record.status === "Enrolled" && record.studentRef !== undefined) return record;
      const next: ApplicationRecord = {
        ...record,
        status: "Enrolled",
        studentRef: input.studentRef,
        enrollmentRef: input.enrollmentRef,
        linkRef: input.linkRef ?? undefined,
        timeline: [
          ...record.timeline,
          {
            status: "Enrolled",
            atIso: demoNowIso(),
            actor: "School office",
            note: `Enrollment completed — permanent student record ${input.studentRef} is on the school register; guardian link ${input.linkRef === null ? "pending invitation" : "activated"}.`,
          },
        ],
      };
      saveRecord(next);
      return next;
    });
  },

  async requestChange(ref, reason) {
    if (clientAdapterMode() === "supabase") {
      const target = serverAdmissionIds.get(ref);
      if (target === undefined) {
        await serverAdmissionRows("staff");
      }
      const current = serverAdmissionIds.get(ref);
      if (current === undefined) throw new Error("Application not found.");
      const result = await adapterCall("admissions.requestChanges", {
        applicationRef: ref,
        expectedVersion: current.version,
        visibleReason: reason.trim(),
        privateNote: null,
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Request for changes failed.");
      const updated = (await serverApplicationByRef(ref, "staff")) ?? (await serverApplicationByRef(ref, "mine"));
      if (updated === null) throw new Error("Application was updated but could not be reloaded.");
      return updated;
    }
    /* Staff side — kept behind the same boundary so the staff workspace can
       call it later; no page calls it in this phase. */
    return respond(() => {
      const record = loadRecord(ref);
      if (!record) throw new Error("Application not found.");
      const updated: ApplicationRecord = {
        ...record,
        status: "Changes requested",
        timeline: [
          ...record.timeline,
          { status: "Changes requested", atIso: demoNowIso(), actor: "Admissions office", note: reason },
        ],
      };
      saveRecord(updated);
      return updated;
    });
  },

  async withdraw() {
    /* Applicant withdrawal is gated on a school policy decision; the status
       view shows the control with an honest "(policy pending)" note. */
    return respond(() => {
      throw new Error("Applicant withdrawal is pending school policy and is not available in this demo.");
    });
  },

  async listStaffRecords() {
    if (clientAdapterMode() === "supabase") {
      return (await serverAdmissionRows("staff")).map((record) => ({ ...record }));
    }
    return respond(() => {
      const fixtureRows: StaffQueueRecord[] = staffApplications
        .map((row): StaffQueueRecord | null => {
          const record = fixtureApplicationRecord(row.ref);
          return record ? { ...record, reviewer: row.reviewer, flagged: row.flagged } : null;
        })
        .filter((record): record is StaffQueueRecord => record !== null);
      /* Session-saved records win over fixtures (they carry later decisions)
         and new submissions join the queue; newest submission first. */
      const byRef = new Map<string, StaffQueueRecord>();
      for (const row of [...fixtureRows, ...Object.values(allRecords())]) byRef.set(row.ref, row);
      return [...byRef.values()].sort((a, b) => b.submittedAtIso.localeCompare(a.submittedAtIso));
    });
  },

  async staffMoveToAssessment(ref, note, actorAccountId) {
    if (clientAdapterMode() === "supabase") {
      return serverAdmissionDecision(ref, "reviewAdvance", { action: "assessment", visibleReason: note ?? null, privateNote: null });
    }
    return respond(() => {
      const record = loadRecord(ref);
      if (!record) throw new Error("Application not found.");
      if (!MOVE_TO_ASSESSMENT_FROM.includes(record.status)) {
        throw new Error(`Cannot move an application in "${record.status}" to assessment — it must be Submitted, Under review, or Changes requested.`);
      }
      const updated: ApplicationRecord = {
        ...record,
        status: "Assessment",
        /* Maker/checker: remember who reviewed this application so the same
           account cannot approve its own review later. */
        reviewedByAccountId: actorAccountId ?? record.reviewedByAccountId,
        timeline: [
          ...record.timeline,
          { status: "Assessment", atIso: demoNowIso(), actor: "Admissions office", note: note?.trim() || "Moved to the assessment panel." },
        ],
      };
      saveRecord(updated);
      return updated;
    });
  },

  async staffOfferSeat(ref, note, actorAccountId) {
    if (clientAdapterMode() === "supabase") {
      return serverAdmissionDecision(ref, "decide", { action: "offer", visibleReason: note, privateNote: null, conditions: {}, expiresAt: null });
    }
    return respond(() => {
      const record = loadRecord(ref);
      if (!record) throw new Error("Application not found.");
      /* Retry-safe: an outstanding offer is never overwritten or duplicated. */
      if (record.status === "Offered") return record;
      if (record.status !== "Assessment") {
        throw new Error(`A seat can only be offered after assessment — this application is "${record.status}".`);
      }
      requireDifferentApprover(record, actorAccountId);
      const reason = requiredReason("Offering a seat", note);
      const now = demoNowIso();
      const updated: ApplicationRecord = {
        ...record,
        status: "Offered",
        timeline: [...record.timeline, { status: "Offered", atIso: now, actor: "Admissions office", note: reason }],
        offer: {
          grade: record.grade,
          session: record.session,
          acceptByIso: plusMs(now, 15 * DAY_MS),
          admissionFeePaise: 200000,
          accepted: false,
        },
      };
      saveRecord(updated);
      return updated;
    });
  },

  async staffWaitlist(ref, note, actorAccountId) {
    if (clientAdapterMode() === "supabase") {
      return serverAdmissionDecision(ref, "decide", { action: "waitlist", visibleReason: note, privateNote: null, conditions: {}, expiresAt: null });
    }
    return respond(() => {
      const record = loadRecord(ref);
      if (!record) throw new Error("Application not found.");
      if (!WAITLIST_FROM.includes(record.status)) {
        throw new Error(`An application in "${record.status}" cannot be waitlisted.`);
      }
      requireDifferentApprover(record, actorAccountId);
      const reason = requiredReason("Waitlisting", note);
      const updated: ApplicationRecord = {
        ...record,
        status: "Waitlisted",
        timeline: [...record.timeline, { status: "Waitlisted", atIso: demoNowIso(), actor: "Admissions office", note: reason }],
      };
      saveRecord(updated);
      return updated;
    });
  },

  async staffDecline(ref, note, actorAccountId) {
    if (clientAdapterMode() === "supabase") {
      return serverAdmissionDecision(ref, "decide", { action: "decline", visibleReason: note, privateNote: null, conditions: {}, expiresAt: null });
    }
    return respond(() => {
      const record = loadRecord(ref);
      if (!record) throw new Error("Application not found.");
      if (!DECLINE_FROM.includes(record.status)) {
        throw new Error(`An application in "${record.status}" cannot be declined.`);
      }
      requireDifferentApprover(record, actorAccountId);
      const reason = requiredReason("Declining", note);
      const updated: ApplicationRecord = {
        ...record,
        status: "Declined",
        timeline: [...record.timeline, { status: "Declined", atIso: demoNowIso(), actor: "Admissions office", note: reason }],
      };
      saveRecord(updated);
      return updated;
    });
  },
};
