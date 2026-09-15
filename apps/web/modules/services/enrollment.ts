/**
 * Enrollment conversion domain (I3): turns an accepted, fee-paid admission
 * offer into the permanent student, enrollment, and guardian link — exactly
 * once. The conversion record is session-persisted, so retries return the
 * same references and never duplicate records; the admission invoice is
 * adopted into the new student's ledger at the same time.
 *
 * route/page → feature component → EnrollmentConversionService
 *   → deterministic demo adapter (this module) now
 *   → authenticated server adapter later
 *
 * This is the demo of the synchronous transactional conversion the spec
 * requires (FEATURE-INTEGRATION-SPEC.md §5.2): every write below is
 * idempotent and the result is only presented once every record exists.
 */

import { demoNowIso } from "@/modules/demo/clock";
import type { GuardianStudentLink } from "@fass/contracts";

import {
  addEnrolledChild,
  findPersonByDisplayName,
  loadRelationshipStore,
} from "@/modules/services/family-context";
import { admissionsService } from "@/modules/services/admissions";
import { demoGuardians } from "@/modules/relationships/demo";
import { financeService } from "@/modules/services/finance";
import { auditService } from "@/modules/services/audit";
import { enqueueOutboxEvent } from "@/modules/services/outbox";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type EnrollmentConversionResult = {
  applicationRef: string;
  studentId: string;
  studentRef: string;
  enrollmentId: string;
  enrollmentRef: string;
  /** Activated guardian/student link, or null when no guardian matched. */
  linkId: string | null;
  /** True when the child is immediately visible in a guardian portal. */
  portalAvailable: boolean;
  /** True when the application matched an existing student record (spec:
      conversion "creates or matches" — matches never duplicate records). */
  matchedExisting: boolean;
  createdAtIso: string;
  status?: "converted" | "manual_review_required" | "manual_review_rejected";
  manualReviewRequired?: boolean;
  duplicateReviewRef?: string;
  candidateStudentId?: string;
};

export type EnrollmentReadiness = {
  applicationRef: string;
  offered: boolean;
  accepted: boolean;
  admissionInvoiceRef: string | null;
  feePaid: boolean;
  /** Documents were required at submission — always complete here. */
  documentsComplete: boolean;
  placementAvailable: boolean;
  /** Demo policy flags — capacity and final approval read as available. */
  capacityAvailable: boolean;
  finalApproved: boolean;
  policyPending?: boolean;
  ready: boolean;
  /** Why the application is not ready yet (null when ready). */
  reason: string | null;
};

export type EnrollmentConversionErrorCode =
  | "application-not-found"
  | "not-offered"
  | "not-accepted"
  | "fee-unpaid"
  | "not-ready"
  | "no-section-for-grade";

export class EnrollmentConversionError extends Error {
  readonly code: EnrollmentConversionErrorCode;

  constructor(code: EnrollmentConversionErrorCode, message: string) {
    super(message);
    this.name = "EnrollmentConversionError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Demo adapter state                                                   */
/* ------------------------------------------------------------------ */

const CONVERSIONS_KEY = sessionKey("enrollment-conversions");
const COUNTERS_KEY = sessionKey("enrollment-counters");

/** Exported so tests can clear the demo session deterministically. */
export const ENROLLMENT_SESSION_KEYS = { conversions: CONVERSIONS_KEY, counters: COUNTERS_KEY } as const;

/** Next free suffix per record kind, after the seeded graph records. */
const COUNTER_SEEDS = { person: 107, student: 904, enrollment: 1206, link: 1106 } as const;

/** Demo placement map — only Class 8 and Class 9 have sections in the graph. */
const GRADE_SECTION_BY_GRADE: Record<string, string> = {
  "Class 8": "00000000-0000-4000-8000-000000000702",
  "Class 9": "00000000-0000-4000-8000-000000000703",
};

const CURRENT_YEAR_ID = "00000000-0000-4000-8000-000000000602";

const ALL_FAMILY_CAPABILITIES = ["academics", "finance", "documents", "notices", "profile"] as const;

type Counters = { person: number; student: number; enrollment: number; link: number };

function nextCounters(): Counters {
  const current = sessionGet<Counters>(COUNTERS_KEY) ?? { ...COUNTER_SEEDS };
  const next: Counters = {
    person: current.person + 1,
    student: current.student + 1,
    enrollment: current.enrollment + 1,
    link: current.link + 1,
  };
  sessionSet(COUNTERS_KEY, next);
  /* The first call consumes the seed suffixes (107/904/1206/1106). */
  return current;
}

const pad4 = (value: number): string => String(value).padStart(4, "0");

function idFor(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

function loadConversions(): Record<string, EnrollmentConversionResult> {
  return sessionGet<Record<string, EnrollmentConversionResult>>(CONVERSIONS_KEY) ?? {};
}

function saveConversion(result: EnrollmentConversionResult): void {
  const conversions = loadConversions();
  conversions[result.applicationRef] = result;
  sessionSet(CONVERSIONS_KEY, conversions);
}

/** Split a display name into given/family for the new person record. */
function splitName(displayName: string): { givenName: string; familyName: string } {
  const parts = displayName.trim().split(/\s+/);
  const givenName = parts[0] ?? displayName.trim();
  const familyName = parts.length > 1 ? parts.slice(1).join(" ") : givenName;
  return { givenName, familyName };
}

/* ------------------------------------------------------------------ */
/* Service                                                              */
/* ------------------------------------------------------------------ */

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Enrollment readiness for an application: offered, accepted, fee paid,
 * documents complete, capacity available, and finally approved. The demo
 * reads capacity and final approval as available; the real policy flags
 * arrive with the backend.
 */
export async function getEnrollmentReadiness(applicationRef: string): Promise<EnrollmentReadiness> {
  if (clientAdapterMode() === "supabase") {
    const result = await adapterCall<Record<string, unknown>>("enrollment.readiness", { applicationRef });
    if (!result.ok) throw new EnrollmentConversionError("application-not-found", result.errors[0]?.message ?? "Readiness unavailable.");
    const value = result.value;
    const offered = value.offered === true;
    const accepted = value.accepted === true;
    const feePaid = value.feePaid === true;
    const documentsComplete = value.documentsComplete === true;
    const capacityAvailable = value.capacityAvailable === true;
    const finalApproved = value.finalApproved === true;
    const placementAvailable = value.placementAvailable !== false;
    const policyPending = value.policyPending === true;
    const ready = offered && accepted && feePaid && documentsComplete && placementAvailable && capacityAvailable && finalApproved && !policyPending;
    return {
      applicationRef,
      offered,
      accepted,
      admissionInvoiceRef: typeof value.admissionInvoiceRef === "string" ? value.admissionInvoiceRef : null,
      feePaid,
      documentsComplete,
      placementAvailable,
      capacityAvailable,
      finalApproved,
      ready,
      reason: !offered
        ? "There is no offered seat on this application."
        : !accepted
          ? "The offered seat has not been accepted yet."
          : !feePaid
            ? "The admission fee has not been recorded as paid."
            : !documentsComplete
              ? "Required documents are not all ready for enrollment."
              : !placementAvailable
                ? "The school has not configured a placement for this grade and year."
                : !capacityAvailable
              ? "The school has not confirmed capacity for this placement."
              : !finalApproved
                ? "Final admissions approval is still pending."
                : policyPending
                  ? "The admission policy is still pending school confirmation."
                : null,
    };
  }
  const record = await admissionsService.getApplication(applicationRef);
  if (record === null) {
    throw new EnrollmentConversionError("application-not-found", "The application was not found in the school's records.");
  }
  const offered = record.status === "Offered" || record.status === "Enrolled";
  const accepted = record.offer?.accepted === true;
  const admissionInvoiceRef = record.offer?.admissionInvoiceRef ?? null;
  const invoice = admissionInvoiceRef === null ? null : await financeService.getInvoice(admissionInvoiceRef);
  const feePaid = invoice !== null && invoice.balancePaise === 0;
  const documentsComplete = true;
  const placementAvailable = true;
  const capacityAvailable = true;
  const finalApproved = true;
  const ready = offered && accepted && feePaid && documentsComplete && placementAvailable && capacityAvailable && finalApproved;
  const reason = !offered
    ? "There is no offered seat on this application."
    : !accepted
      ? "The offered seat has not been accepted yet."
      : !feePaid
        ? "The admission fee has not been recorded as paid."
        : null;
  return {
    applicationRef,
    offered,
    accepted,
    admissionInvoiceRef,
    feePaid,
    documentsComplete,
    placementAvailable,
    capacityAvailable,
    finalApproved,
    ready,
    reason,
  };
}

/* In-process serialization for the demo store: conversion bodies chain per
   application reference so two overlapping submits cannot both pass the
   readiness gates and consume the same counters. The Supabase path relies on
   the server transaction instead. */
const conversionTails = new Map<string, Promise<void>>();

function withConversionLock<T>(applicationRef: string, task: () => Promise<T>): Promise<T> {
  const previous = conversionTails.get(applicationRef) ?? Promise.resolve();
  const result = previous.then(task);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  conversionTails.set(applicationRef, tail);
  /* Drop the chain entry once this call is the tail — keeps the map bounded. */
  void tail.then(() => {
    if (conversionTails.get(applicationRef) === tail) conversionTails.delete(applicationRef);
  });
  return result;
}

/**
 * Convert an accepted, fee-paid application into the permanent student,
 * enrollment, and (when a guardian matches) guardian link. Idempotent: the
 * first call creates the records and stores the result; every retry returns
 * the SAME references and creates nothing new.
 */
export async function convertApplication(applicationRef: string): Promise<EnrollmentConversionResult> {
  if (clientAdapterMode() === "supabase") {
    const result = await adapterCall<Record<string, unknown>>("enrollment.convert", { applicationRef });
    if (!result.ok) throw new EnrollmentConversionError("not-ready", result.errors[0]?.message ?? "Enrollment conversion failed.");
    const value = result.value;
    const manualReviewRequired = value.manualReviewRequired === true;
    return {
      applicationRef,
      studentId: typeof value.student === "string" ? value.student : "",
      studentRef: typeof value.studentRef === "string" ? value.studentRef : typeof value.student === "string" ? value.student : "",
      enrollmentId: typeof value.enrollment === "string" ? value.enrollment : "",
      enrollmentRef: typeof value.enrollmentRef === "string" ? value.enrollmentRef : typeof value.enrollment === "string" ? value.enrollment : "",
      linkId: typeof value.guardian_link === "string" ? value.guardian_link : null,
      portalAvailable: typeof value.guardian_link === "string",
      matchedExisting: value.matched_existing === true,
      createdAtIso: new Date().toISOString(),
      status: value.status === "manual_review_rejected" ? "manual_review_rejected" : manualReviewRequired ? "manual_review_required" : "converted",
      manualReviewRequired,
      duplicateReviewRef: typeof value.duplicateReviewRef === "string" ? value.duplicateReviewRef : undefined,
      candidateStudentId: typeof value.candidateStudent === "string" ? value.candidateStudent : undefined,
    };
  }
  const existing = loadConversions()[applicationRef];
  if (existing !== undefined) return clone(existing);

  /* Serialize concurrent conversions for the same application: overlapping
     submits queue behind each other, so the later call observes the first
     call's stored result instead of racing it. */
  return withConversionLock(applicationRef, () => convertApplicationDemoLocked(applicationRef));
}

/**
 * Demo conversion body — runs under the per-application lock above. The
 * re-checks stay because a retry may have stored the result while readiness
 * was being read or before the lock was acquired.
 */
async function convertApplicationDemoLocked(applicationRef: string): Promise<EnrollmentConversionResult> {
  const existing = loadConversions()[applicationRef];
  if (existing !== undefined) return clone(existing);
  const readiness = await getEnrollmentReadiness(applicationRef);
  /* Double-submit guard: a concurrent retry may have stored the result while
     readiness was being read — return it instead of creating duplicates. */
  const raced = loadConversions()[applicationRef];
  if (raced !== undefined) return clone(raced);
  if (!readiness.offered) {
    throw new EnrollmentConversionError("not-offered", "Enrollment requires an offered seat.");
  }
  if (!readiness.accepted) {
    throw new EnrollmentConversionError("not-accepted", "Enrollment requires the seat to be accepted.");
  }
  if (!readiness.feePaid) {
    throw new EnrollmentConversionError("fee-unpaid", "Enrollment requires the admission fee to be recorded as paid.");
  }
  if (!readiness.ready) {
    throw new EnrollmentConversionError("not-ready", readiness.reason ?? "The application is not ready for enrollment.");
  }

  const record = (await admissionsService.getApplication(applicationRef))!;
  const rechecked = loadConversions()[applicationRef];
  if (rechecked !== undefined) return clone(rechecked);
  const sectionId = GRADE_SECTION_BY_GRADE[record.grade];
  if (sectionId === undefined) {
    throw new EnrollmentConversionError(
      "no-section-for-grade",
      `No class/section is configured for ${record.grade} in this demo — the school office will place the child when sections open.`,
    );
  }

  const counters = nextCounters();
  const now = demoNowIso();

  /* The guardian link activates only when the applicant's parent matches a
     known person with a guardian record; otherwise the school invites them
     (portalAvailable false) — the child is enrolled regardless. */
  const parentPerson = findPersonByDisplayName(record.parentName);
  const guardian =
    parentPerson === null ? undefined : demoGuardians.find((candidate) => candidate.personId === parentPerson.id);

  /* Match path (spec: conversion "creates or matches"): an application for a
     student who is already enrolled and linked to the same guardian confirms
     the existing records instead of creating duplicates. */
  const store = loadRelationshipStore();
  if (guardian !== undefined) {
    const activeLink = store.links.find(
      (candidate) => candidate.guardianId === guardian.id && candidate.status === "active",
    );
    const matchedStudent = activeLink
      ? store.students.find(
          (candidate) =>
            candidate.id === activeLink.studentId &&
            candidate.displayName.toLowerCase() === record.studentName.trim().toLowerCase(),
        )
      : undefined;
    const matchedEnrollment = matchedStudent
      ? store.enrollments.find(
          (candidate) =>
            candidate.studentId === matchedStudent.id &&
            candidate.academicYearId === CURRENT_YEAR_ID &&
            candidate.status === "active",
        )
      : undefined;
    if (matchedStudent !== undefined && matchedEnrollment !== undefined && activeLink !== undefined) {
      await financeService.assignInvoiceToStudent(readiness.admissionInvoiceRef!, matchedStudent.id);
      await admissionsService.markEnrolled(applicationRef, {
        studentRef: matchedStudent.ref,
        enrollmentRef: matchedEnrollment.ref,
        linkRef: activeLink.id,
      });
      const matchedResult: EnrollmentConversionResult = {
        applicationRef,
        studentId: matchedStudent.id,
        studentRef: matchedStudent.ref,
        enrollmentId: matchedEnrollment.id,
        enrollmentRef: matchedEnrollment.ref,
        linkId: activeLink.id,
        portalAvailable: true,
        matchedExisting: true,
        createdAtIso: now,
      };
      saveConversion(matchedResult);
      recordConversionEffects(matchedResult);
      return clone(matchedResult);
    }
  }

  const { givenName, familyName } = splitName(record.studentName);

  const person = {
    id: idFor(counters.person),
    ref: `PER-2026-${pad4(counters.person)}`,
    givenName,
    familyName,
    displayName: record.studentName,
    status: "active" as const,
  };
  const student = {
    id: idFor(counters.student),
    ref: `STU-2026-${pad4(counters.student)}`,
    personId: person.id,
    status: "active" as const,
    displayName: record.studentName,
  };
  const enrollment = {
    id: idFor(counters.enrollment),
    ref: `ENR-2026-${pad4(counters.enrollment)}`,
    studentId: student.id,
    academicYearId: CURRENT_YEAR_ID,
    gradeSectionId: sectionId,
    status: "active" as const,
    effectiveFromIso: now,
    effectiveToIso: null,
  };

  /* Create path: a brand-new student, enrollment, and — when the applicant's
     parent matches a known guardian — an activated link. */
  let link: GuardianStudentLink | null = null;
  if (guardian !== undefined) {
    link = {
      id: idFor(counters.link),
      ref: `LINK-2026-${pad4(counters.link)}`,
      guardianId: guardian.id,
      studentId: student.id,
      relationshipLabel: "Parent",
      status: "active",
      verificationSource: "enrollment_invitation",
      approvedByPersonId: null,
      approvedAtIso: null,
      effectiveFromIso: now,
      effectiveToIso: null,
      restrictionReason: null,
      rejectionReason: null,
      contactPriority: 1,
      isEmergencyContact: true,
      isBillingContact: true,
      capabilities: [...ALL_FAMILY_CAPABILITIES],
      version: 1,
    };
  }

  addEnrolledChild({ person, student, enrollment, link });

  /* Adopt the admission invoice (and its receipts) into the new student's
     ledger so the paid admission fee appears in the portal fee view. */
  await financeService.assignInvoiceToStudent(readiness.admissionInvoiceRef!, student.id);

  await admissionsService.markEnrolled(applicationRef, {
    studentRef: student.ref,
    enrollmentRef: enrollment.ref,
    linkRef: link?.id ?? null,
  });

  const result: EnrollmentConversionResult = {
    applicationRef,
    studentId: student.id,
    studentRef: student.ref,
    enrollmentId: enrollment.id,
    enrollmentRef: enrollment.ref,
    linkId: link?.id ?? null,
    portalAvailable: link !== null,
    matchedExisting: false,
    createdAtIso: now,
  };
  saveConversion(result);
  recordConversionEffects(result);
  return clone(result);
}

/** Convenience read for the applicant acknowledgement UI. */
export async function getConversion(applicationRef: string): Promise<EnrollmentConversionResult | null> {
  const existing = loadConversions()[applicationRef];
  return existing === undefined ? null : clone(existing);
}

/**
 * One audit row + one outbox event per conversion (plan.md Phase 4). Called
 * from the conversion paths only after the records exist, so retries never
 * duplicate — `saveConversion` above is the idempotency boundary and this
 * runs exactly once per stored result.
 */
function recordConversionEffects(result: EnrollmentConversionResult): void {
  enqueueOutboxEvent({
    eventId: `enrollment.converted:${result.applicationRef}`,
    kind: "enrollment.converted",
    targetRef: result.applicationRef,
    actor: "Admissions office",
  });
  void auditService.record({
    actor: "Admissions office",
    action: "Enrollment converted",
    target: `${result.applicationRef} → ${result.studentRef}`,
    outcome: "Success",
    reason: result.matchedExisting ? "Matched the already-enrolled student record." : "Created the permanent student record.",
  });
}
