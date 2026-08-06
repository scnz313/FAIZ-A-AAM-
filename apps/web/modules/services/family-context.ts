import {
  academicYearSchema,
  familyPortalContextSchema,
  type AcademicYear,
  type FamilyCapability,
  type FamilyPortalContext,
  type GradeSection,
  type Guardian,
  type GuardianStudentLink,
  type Person,
  type Student,
  type UserAccount,
} from "@fass/contracts";

import { demoNowIso } from "@/modules/demo/clock";
import {
  DEMO_APPROVER_PERSON_ID,
  demoAcademicYears,
  demoEnrollments,
  demoGradeSections,
  demoGuardianStudentLinks,
  demoGuardians,
  demoRelationshipGraph,
  demoStudents,
} from "@/modules/relationships/demo";
import { auditService } from "@/modules/services/audit";
import { enqueueOutboxEvent } from "@/modules/services/outbox";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";
import type { Enrollment, RoleGrant } from "@fass/contracts";

export const RELATIONSHIPS_SESSION_KEY = sessionKey("relationships");

/** Demo default capability set granted to a verified family link. */
const ALL_FAMILY_CAPABILITIES = ["academics", "finance", "documents", "notices", "profile"] as const;

/** Demo guardian account used when a portal route is opened without a sign-in session. */
export const DEMO_GUARDIAN_ACCOUNT_ID = "00000000-0000-4000-8000-000000000201";

export type RelationshipContextErrorCode =
  | "account-not-found"
  | "student-not-linked"
  | "link-not-active"
  | "enrollment-not-found"
  | "workspace-not-granted"
  | "assignment-not-active"
  | "request-not-found"
  | "request-not-pending"
  | "already-linked";

export class RelationshipContextError extends Error {
  readonly code: RelationshipContextErrorCode;

  constructor(code: RelationshipContextErrorCode, message: string) {
    super(message);
    this.name = "RelationshipContextError";
    this.code = code;
  }
}

/** Mutable part of the relationship demo; the graph fixtures remain the seed. */
export type RelationshipDemoStore = {
  links: GuardianStudentLink[];
  people: Person[];
  students: Student[];
  enrollments: Enrollment[];
  activeStudentByAccount: Record<string, string>;
  activeWorkspaceByAccount: Record<string, string>;
  /** Guardian-raised link requests (plan.md Phase 3): one store for requests. */
  pendingRequests: LinkRequestRecord[];
  /** Next free link-request ref suffix — seeded 101, after the fixture refs. */
  linkRequestCounter: number;
};

/**
 * A guardian-requested student link awaiting school verification (spec
 * §6.3 path 2). The request is not an active link: staff approving it
 * creates the real `GuardianStudentLink` in the same store and records the
 * `approvedLinkId`; rejecting it is a terminal state with a visible reason.
 */
export type LinkRequestRecord = {
  id: string;
  ref: string;
  /** The signed-in guardian account that raised the request. */
  guardianAccountId: string;
  guardianName: string;
  /** School reference the guardian supplied (admission/student ref). */
  childAdmissionRef: string;
  relation: string;
  requestedAtIso: string;
  status: "pending" | "approved" | "rejected";
  approvedLinkId: string | null;
  rejectedReason: string | null;
  /** School staff who decided; null while pending. */
  decidedByPersonId: string | null;
  decidedAtIso: string | null;
  version: number;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function loadRelationshipStore(): RelationshipDemoStore {
  const existing = sessionGet<RelationshipDemoStore>(RELATIONSHIPS_SESSION_KEY);
  if (existing !== null) return existing;

  const seeded: RelationshipDemoStore = {
    links: clone(demoGuardianStudentLinks),
    people: clone(demoRelationshipGraph.people),
    students: clone(demoStudents),
    enrollments: clone(demoEnrollments),
    activeStudentByAccount: {},
    activeWorkspaceByAccount: {},
    pendingRequests: [],
    linkRequestCounter: 101,
  };
  sessionSet(RELATIONSHIPS_SESSION_KEY, seeded);
  return seeded;
}

export function saveRelationshipStore(store: RelationshipDemoStore): void {
  sessionSet(RELATIONSHIPS_SESSION_KEY, store);
}

function accountById(accountId: string): UserAccount | undefined {
  return demoRelationshipGraph.userAccounts.find((account) => account.id === accountId);
}

function guardianForAccount(accountId: string): Guardian | undefined {
  const account = accountById(accountId);
  return account === undefined
    ? undefined
    : demoGuardians.find((guardian) => guardian.personId === account.personId);
}

function activeGuardianRole(accountId: string): RoleGrant | undefined {
  return demoRelationshipGraph.roleGrants.find(
    (grant) => grant.accountId === accountId && grant.role === "guardian" && grant.status === "active",
  );
}

function requireFamilyAccount(accountId: string): { account: UserAccount; guardian: Guardian } {
  const account = accountById(accountId);
  if (account === undefined || account.status !== "active") {
    throw new RelationshipContextError("account-not-found", "The account was not found.");
  }

  const guardian = guardianForAccount(accountId);
  if (guardian === undefined || guardian.status !== "active" || activeGuardianRole(accountId) === undefined) {
    throw new RelationshipContextError("workspace-not-granted", "This account has no active family workspace.");
  }
  return { account, guardian };
}

function currentAcademicYear(): AcademicYear {
  const year = demoAcademicYears.find((candidate) => candidate.status === "current");
  if (year === undefined) {
    throw new RelationshipContextError("enrollment-not-found", "No current academic year is configured.");
  }
  return academicYearSchema.parse(clone(year));
}

function isEffective(fromIso: string, toIso: string | null, atIso: string): boolean {
  return fromIso <= atIso && (toIso === null || atIso < toIso);
}

function activeLinkFor(
  store: RelationshipDemoStore,
  guardianId: string,
  studentId: string,
): GuardianStudentLink | undefined {
  return store.links.find((link) => link.guardianId === guardianId && link.studentId === studentId);
}

function requireStudentLink(
  store: RelationshipDemoStore,
  guardianId: string,
  studentId: string,
): GuardianStudentLink {
  const link = activeLinkFor(store, guardianId, studentId);
  if (link === undefined) {
    throw new RelationshipContextError("student-not-linked", "That student is not linked to this family account.");
  }
  return link;
}

function requireActiveLink(
  store: RelationshipDemoStore,
  guardianId: string,
  studentId: string,
): GuardianStudentLink {
  const link = requireStudentLink(store, guardianId, studentId);
  if (link.status !== "active") {
    throw new RelationshipContextError("link-not-active", "This guardian/student link is no longer active.");
  }
  return link;
}

function currentEnrollmentFor(studentId: string, academicYearId: string): Enrollment {
  const nowIso = demoNowIso();
  const enrollment = loadRelationshipStore().enrollments.find(
    (candidate) =>
      candidate.studentId === studentId &&
      candidate.academicYearId === academicYearId &&
      candidate.status === "active" &&
      isEffective(candidate.effectiveFromIso, candidate.effectiveToIso, nowIso),
  );
  if (enrollment === undefined) {
    throw new RelationshipContextError("enrollment-not-found", "No active enrollment was found for this student and year.");
  }
  return clone(enrollment);
}

function contextFor(
  accountId: string,
  guardianId: string,
  link: GuardianStudentLink,
  academicYear: AcademicYear,
): FamilyPortalContext {
  const enrollment = currentEnrollmentFor(link.studentId, academicYear.id);
  return familyPortalContextSchema.parse({
    accountId,
    guardianId,
    activeStudentId: link.studentId,
    activeEnrollmentId: enrollment.id,
    academicYearId: academicYear.id,
    allowedCapabilities: getCapabilities(link),
    relationshipVersion: link.version,
  });
}

/** Capabilities are never granted by a non-active relationship. */
export function getCapabilities(link: GuardianStudentLink): FamilyCapability[] {
  return link.status === "active" ? clone(link.capabilities) : [];
}

/** Presentation label for a class/section record, e.g. "Class 8-A". */
export function gradeSectionLabel(section: GradeSection): string {
  return `${section.gradeLabel}-${section.sectionLabel}`;
}

/**
 * Service-owned presentation summary for one accessible student: the
 * student record plus the active link, current enrollment, placement, and
 * year. UI components must not resolve these from fixtures themselves.
 */
export type AccessibleStudentContext = {
  student: Student;
  link: GuardianStudentLink;
  enrollment: Enrollment;
  gradeSection: GradeSection;
  academicYear: AcademicYear;
};

/** Safe display identity for the account behind a family workspace. */
export type AccountSummary = {
  accountId: string;
  personId: string;
  displayName: string;
  guardianId: string | null;
};

/** Staff-facing row for a guardian/student link request awaiting verification. */
export type LinkRequestSummary = {
  link: GuardianStudentLink;
  guardianName: string;
  studentName: string;
};

/**
 * One guardian-raised request for the staff review screen, with the student
 * record resolved from the supplied reference when one exists (unresolvable
 * references stay honest — the school office asks for the correct one).
 */
export type LinkRequestRow = {
  request: LinkRequestRecord;
  student: Student | null;
};

/** Scope of a record's owning student for the active family account. */
export type StudentAccessScope = "current" | "other" | "none";

function gradeSectionFor(id: string): GradeSection {
  const section = demoGradeSections.find((candidate) => candidate.id === id);
  if (section === undefined) {
    throw new RelationshipContextError("enrollment-not-found", "The enrollment references an unknown class or section.");
  }
  return clone(section);
}

export interface FamilyContextService {
  listAccessibleStudents(accountId: string): Promise<Student[]>;
  /** Presentation summaries for every child linked through an active link. */
  listAccessibleStudentContexts(accountId: string): Promise<AccessibleStudentContext[]>;
  getContext(accountId: string): Promise<FamilyPortalContext>;
  setActiveStudent(accountId: string, studentId: string): Promise<FamilyPortalContext>;
  getActiveEnrollment(studentId: string, academicYearId: string): Promise<Enrollment>;
  getCapabilities(link: GuardianStudentLink): FamilyCapability[];
  /** Safe display identity for the account behind a family workspace. */
  getAccountSummary(accountId: string): Promise<AccountSummary>;
  listPendingLinkRequests(accountId?: string): Promise<GuardianStudentLink[]>;
  /** Pending requests with guardian/student names for the staff review screen. */
  listLinkRequestSummaries(): Promise<LinkRequestSummary[]>;
  /** Every active link with guardian/student names for the revocation view. */
  listActiveLinkSummaries(): Promise<LinkRequestSummary[]>;
  approveLink(linkId: string): Promise<GuardianStudentLink>;
  rejectLink(linkId: string, reason?: string): Promise<GuardianStudentLink>;
  revokeLink(linkId: string): Promise<GuardianStudentLink>;
  /** One store for guardian-raised requests (plan.md Phase 3). */
  createPendingLinkRequest(
    accountId: string,
    guardianName: string,
    childAdmissionRef: string,
    relation: string,
  ): Promise<LinkRequestRecord>;
  /** All guardian-raised requests, oldest first, with resolved student rows. */
  listLinkRequests(): Promise<LinkRequestRow[]>;
  /** Approve a request: creates the real active link exactly once. */
  approvePendingLinkRequest(requestId: string, byPersonId?: string): Promise<LinkRequestRecord>;
  /** Reject a request with a visible reason; terminal. */
  rejectPendingLinkRequest(requestId: string, reason: string, byPersonId?: string): Promise<LinkRequestRecord>;
  /**
   * Scope of a record's owning student for the account: "current" (the
   * active child), "other" (linked but not active — offer a child switch),
   * or "none" (not linked — neutral denial). Null owners (e.g. an admission
   * invoice before conversion) classify as "current".
   */
  classifyStudentAccess(accountId: string, studentId: string | null): Promise<StudentAccessScope>;
}

export const familyContextService: FamilyContextService = {
  async listAccessibleStudents(accountId) {
    const { guardian } = requireFamilyAccount(accountId);
    const store = loadRelationshipStore();
    const studentIds = new Set(
      store.links
        .filter((link) => link.guardianId === guardian.id && link.status === "active")
        .map((link) => link.studentId),
    );
    return store.students.filter((student) => studentIds.has(student.id)).map((student) => clone(student));
  },

  async listAccessibleStudentContexts(accountId) {
    const { guardian } = requireFamilyAccount(accountId);
    const store = loadRelationshipStore();
    const academicYear = currentAcademicYear();
    const contexts: AccessibleStudentContext[] = [];

    for (const link of store.links.filter(
      (candidate) => candidate.guardianId === guardian.id && candidate.status === "active",
    )) {
      const student = store.students.find((candidate) => candidate.id === link.studentId);
      if (student === undefined) continue;
      let enrollment: Enrollment;
      try {
        enrollment = currentEnrollmentFor(link.studentId, academicYear.id);
      } catch (error) {
        if (error instanceof RelationshipContextError && error.code === "enrollment-not-found") continue;
        throw error;
      }
      contexts.push({
        student: clone(student),
        link: clone(link),
        enrollment,
        gradeSection: gradeSectionFor(enrollment.gradeSectionId),
        academicYear: clone(academicYear),
      });
    }
    return contexts;
  },

  async getContext(accountId) {
    const { guardian } = requireFamilyAccount(accountId);
    const store = loadRelationshipStore();
    const academicYear = currentAcademicYear();
    const storedStudentId = store.activeStudentByAccount[accountId];

    if (storedStudentId !== undefined) {
      const link = requireActiveLink(store, guardian.id, storedStudentId);
      return clone(contextFor(accountId, guardian.id, link, academicYear));
    }

    const activeLinks = store.links.filter((link) => link.guardianId === guardian.id && link.status === "active");
    if (activeLinks.length === 0) {
      throw new RelationshipContextError("student-not-linked", "No active student link was found for this family account.");
    }

    const firstLinkWithEnrollment = activeLinks.find((link) => {
      try {
        currentEnrollmentFor(link.studentId, academicYear.id);
        return true;
      } catch (error) {
        if (error instanceof RelationshipContextError && error.code === "enrollment-not-found") return false;
        throw error;
      }
    });

    if (firstLinkWithEnrollment === undefined) {
      throw new RelationshipContextError("enrollment-not-found", "No accessible student has an active enrollment.");
    }
    store.activeStudentByAccount[accountId] = firstLinkWithEnrollment.studentId;
    saveRelationshipStore(store);
    return clone(contextFor(accountId, guardian.id, firstLinkWithEnrollment, academicYear));
  },

  async setActiveStudent(accountId, studentId) {
    const { guardian } = requireFamilyAccount(accountId);
    const store = loadRelationshipStore();
    const link = requireActiveLink(store, guardian.id, studentId);
    const academicYear = currentAcademicYear();
    const context = contextFor(accountId, guardian.id, link, academicYear);
    store.activeStudentByAccount[accountId] = studentId;
    saveRelationshipStore(store);
    return clone(context);
  },

  async getActiveEnrollment(studentId, academicYearId) {
    return currentEnrollmentFor(studentId, academicYearId);
  },

  getCapabilities,

  async getAccountSummary(accountId) {
    const { account, guardian } = requireFamilyAccount(accountId);
    const person = loadRelationshipStore().people.find((candidate) => candidate.id === account.personId);
    return {
      accountId: account.id,
      personId: account.personId,
      displayName: person?.displayName ?? "Guardian",
      guardianId: guardian.id,
    };
  },

  async listPendingLinkRequests(accountId) {
    const store = loadRelationshipStore();
    let guardianId: string | undefined;
    if (accountId !== undefined) guardianId = requireFamilyAccount(accountId).guardian.id;
    return store.links
      .filter((link) => link.status === "pending_verification" && (guardianId === undefined || link.guardianId === guardianId))
      .map((link) => clone(link));
  },

  async listLinkRequestSummaries() {
    const store = loadRelationshipStore();
    return store.links
      .filter((link) => link.status === "pending_verification")
      .map((link) => {
        const guardian = demoGuardians.find((candidate) => candidate.id === link.guardianId);
        const guardianPerson = guardian
          ? store.people.find((candidate) => candidate.id === guardian.personId)
          : undefined;
        const student = store.students.find((candidate) => candidate.id === link.studentId);
        return {
          link: clone(link),
          guardianName: guardianPerson?.displayName ?? "Unknown guardian",
          studentName: student?.displayName ?? "Unknown student",
        };
      });
  },

  /** Every ACTIVE link with resolved names — the staff revocation view. */
  async listActiveLinkSummaries() {
    const store = loadRelationshipStore();
    return store.links
      .filter((link) => link.status === "active")
      .map((link) => {
        const guardian = demoGuardians.find((candidate) => candidate.id === link.guardianId);
        const guardianPerson = guardian
          ? store.people.find((candidate) => candidate.id === guardian.personId)
          : undefined;
        const student = store.students.find((candidate) => candidate.id === link.studentId);
        return {
          link: clone(link),
          guardianName: guardianPerson?.displayName ?? "Unknown guardian",
          studentName: student?.displayName ?? "Unknown student",
        };
      })
      .sort((a, b) => a.guardianName.localeCompare(b.guardianName));
  },

  async approveLink(linkId) {
    const store = loadRelationshipStore();
    const link = store.links.find((candidate) => candidate.id === linkId);
    if (link === undefined) {
      throw new RelationshipContextError("student-not-linked", "The link request was not found.");
    }
    if (link.status === "active") return clone(link);
    if (link.status !== "pending_verification") {
      throw new RelationshipContextError("link-not-active", "Only a pending link request can be approved.");
    }
    link.status = "active";
    link.approvedByPersonId = DEMO_APPROVER_PERSON_ID;
    link.approvedAtIso = demoNowIso();
    link.effectiveFromIso = demoNowIso();
    link.rejectionReason = null;
    link.version += 1;
    saveRelationshipStore(store);
    void auditService.record({
      actor: "School office",
      action: "Link approved",
      target: link.ref,
      outcome: "Success",
    });
    enqueueOutboxEvent({ eventId: `link.approved:${link.id}`, kind: "link.approved", targetRef: link.ref, actor: "School office" });
    return clone(link);
  },

  async rejectLink(linkId, reason = "The school could not verify this relationship.") {
    const store = loadRelationshipStore();
    const link = store.links.find((candidate) => candidate.id === linkId);
    if (link === undefined) {
      throw new RelationshipContextError("student-not-linked", "The link request was not found.");
    }
    if (link.status === "rejected") return clone(link);
    if (link.status !== "pending_verification") {
      throw new RelationshipContextError("link-not-active", "Only a pending link request can be rejected.");
    }
    const cleanReason = reason.trim();
    if (cleanReason === "") {
      throw new RelationshipContextError("link-not-active", "A rejection reason is required.");
    }
    link.status = "rejected";
    link.rejectionReason = cleanReason;
    link.effectiveToIso = demoNowIso();
    link.version += 1;
    saveRelationshipStore(store);
    void auditService.record({
      actor: "School office",
      action: "Link rejected",
      target: link.ref,
      outcome: "Success",
      reason: cleanReason,
    });
    enqueueOutboxEvent({ eventId: `link.rejected:${link.id}`, kind: "link.rejected", targetRef: link.ref, actor: "School office" });
    return clone(link);
  },

  async revokeLink(linkId) {
    const store = loadRelationshipStore();
    const link = store.links.find((candidate) => candidate.id === linkId);
    if (link === undefined) {
      throw new RelationshipContextError("student-not-linked", "The link was not found.");
    }
    if (link.status === "ended") return clone(link);
    if (link.status !== "active" && link.status !== "restricted") {
      throw new RelationshipContextError("link-not-active", "Only an active link can be revoked.");
    }
    link.status = "ended";
    link.effectiveToIso = demoNowIso();
    link.version += 1;
    saveRelationshipStore(store);
    void auditService.record({
      actor: "School office",
      action: "Link revoked",
      target: link.ref,
      outcome: "Success",
    });
    enqueueOutboxEvent({ eventId: `link.revoked:${link.id}`, kind: "link.revoked", targetRef: link.ref, actor: "School office" });
    return clone(link);
  },

  /* --- Guardian-raised link requests (plan.md Phase 3) ---------------- */

  async createPendingLinkRequest(accountId, guardianName, childAdmissionRef, relation) {
    const { guardian, account } = requireFamilyAccount(accountId);
    const store = loadRelationshipStore();
    const cleanRef = childAdmissionRef.trim().toUpperCase();
    const cleanName = guardianName.trim();
    const cleanRelation = relation.trim();
    if (cleanRef === "" || cleanName === "" || cleanRelation === "") {
      throw new RelationshipContextError(
        "request-not-pending",
        "The guardian name, child reference, and relation are required.",
      );
    }

    /* Already linked to this student? No request is needed — the link is live. */
    const existingLink = store.links.find(
      (candidate) =>
        candidate.guardianId === guardian.id &&
        candidate.studentId === (store.students.find((student) => student.ref === cleanRef)?.id ?? ""),
    );
    const studentByRef = store.students.find((student) => student.ref.toUpperCase() === cleanRef);
    if (
      studentByRef !== undefined &&
      store.links.some((candidate) => candidate.guardianId === guardian.id && candidate.studentId === studentByRef.id && candidate.status === "active")
    ) {
      throw new RelationshipContextError("already-linked", "This child is already linked to your family account.");
    }
    void existingLink;

    /* Idempotent: the same pending request returns the same reference. */
    const existingRequest = store.pendingRequests.find(
      (candidate) =>
        candidate.guardianAccountId === account.id &&
        candidate.childAdmissionRef.toUpperCase() === cleanRef &&
        candidate.relation === cleanRelation &&
        candidate.status === "pending",
    );
    if (existingRequest !== undefined) return clone(existingRequest);

    const counter = store.linkRequestCounter;
    store.linkRequestCounter += 1;
    const idSuffix = 1300 + counter;
    const request: LinkRequestRecord = {
      id: `00000000-0000-4000-8000-${String(idSuffix).padStart(12, "0")}`,
      ref: `LR-2026-${String(counter).padStart(4, "0")}`,
      guardianAccountId: account.id,
      guardianName: cleanName,
      childAdmissionRef: cleanRef,
      relation: cleanRelation,
      requestedAtIso: demoNowIso(),
      status: "pending",
      approvedLinkId: null,
      rejectedReason: null,
      decidedByPersonId: null,
      decidedAtIso: null,
      version: 1,
    };
    store.pendingRequests.push(request);
    saveRelationshipStore(store);
    void auditService.record({
      actor: cleanName,
      action: "Link requested",
      target: request.ref,
      outcome: "Success",
    });
    enqueueOutboxEvent({
      eventId: `link.requested:${request.id}`,
      kind: "link.requested",
      targetRef: request.ref,
      actor: cleanName,
    });
    return clone(request);
  },

  async listLinkRequests() {
    const store = loadRelationshipStore();
    return store.pendingRequests
      .map((request) => {
        const normalized = request.childAdmissionRef.toUpperCase();
        const student = store.students.find((candidate) => candidate.ref.toUpperCase() === normalized) ?? null;
        return { request: clone(request), student: student === null ? null : clone(student) };
      })
      .sort((a, b) => a.request.requestedAtIso.localeCompare(b.request.requestedAtIso));
  },

  async approvePendingLinkRequest(requestId, byPersonId = DEMO_APPROVER_PERSON_ID) {
    const store = loadRelationshipStore();
    const request = store.pendingRequests.find((candidate) => candidate.id === requestId);
    if (request === undefined) {
      throw new RelationshipContextError("request-not-found", "The link request was not found.");
    }
    if (request.status === "approved") return clone(request);
    if (request.status !== "pending") {
      throw new RelationshipContextError("request-not-pending", "Only a pending request can be approved.");
    }

    const normalized = request.childAdmissionRef.toUpperCase();
    const student = store.students.find((candidate) => candidate.ref.toUpperCase() === normalized);
    if (student === undefined) {
      throw new RelationshipContextError(
        "student-not-linked",
        `No student record matches the reference ${request.childAdmissionRef} — reject the request or ask the guardian for the correct reference.`,
      );
    }
    const guardian = guardianForAccount(request.guardianAccountId);
    if (guardian === undefined) {
      throw new RelationshipContextError("account-not-found", "The guardian account behind this request no longer exists.");
    }

    /* Duplicate active links collapse safely (spec §6.3): approving a
       request for an already-active link records the existing link. */
    const existingLink = store.links.find(
      (candidate) =>
        candidate.guardianId === guardian.id && candidate.studentId === student.id && candidate.status === "active",
    );

    const now = demoNowIso();
    let link: GuardianStudentLink;
    if (existingLink !== undefined) {
      link = existingLink;
    } else {
      const counter = store.linkRequestCounter;
      store.linkRequestCounter += 1;
      const idSuffix = 1300 + counter;
      link = {
        id: `00000000-0000-4000-8000-${String(idSuffix).padStart(12, "0")}`,
        ref: `LINK-2026-${String(idSuffix).padStart(4, "0")}`,
        guardianId: guardian.id,
        studentId: student.id,
        relationshipLabel: request.relation,
        status: "active",
        verificationSource: "guardian_request",
        approvedByPersonId: byPersonId,
        approvedAtIso: now,
        effectiveFromIso: now,
        effectiveToIso: null,
        restrictionReason: null,
        rejectionReason: null,
        contactPriority: 3,
        isEmergencyContact: false,
        isBillingContact: false,
        capabilities: [...ALL_FAMILY_CAPABILITIES],
        version: 1,
      };
      store.links.push(link);
    }

    request.status = "approved";
    request.approvedLinkId = link.id;
    request.decidedByPersonId = byPersonId;
    request.decidedAtIso = now;
    request.version += 1;
    saveRelationshipStore(store);
    void auditService.record({
      actor: "School office",
      action: "Link approved",
      target: request.ref,
      outcome: "Success",
      reason: `Approved via guardian request for ${student.displayName}.`,
    });
    enqueueOutboxEvent({
      eventId: `link.approved:${request.id}`,
      kind: "link.approved",
      targetRef: link.ref,
      actor: "School office",
    });
    return clone(request);
  },

  async rejectPendingLinkRequest(requestId, reason, byPersonId = DEMO_APPROVER_PERSON_ID) {
    const store = loadRelationshipStore();
    const request = store.pendingRequests.find((candidate) => candidate.id === requestId);
    if (request === undefined) {
      throw new RelationshipContextError("request-not-found", "The link request was not found.");
    }
    if (request.status === "rejected") return clone(request);
    if (request.status !== "pending") {
      throw new RelationshipContextError("request-not-pending", "Only a pending request can be rejected.");
    }
    const cleanReason = reason.trim();
    if (cleanReason === "") {
      throw new RelationshipContextError("request-not-pending", "A rejection reason is required.");
    }
    request.status = "rejected";
    request.rejectedReason = cleanReason;
    request.decidedByPersonId = byPersonId;
    request.decidedAtIso = demoNowIso();
    request.version += 1;
    saveRelationshipStore(store);
    void auditService.record({
      actor: "School office",
      action: "Link rejected",
      target: request.ref,
      outcome: "Success",
      reason: cleanReason,
    });
    enqueueOutboxEvent({
      eventId: `link.rejected:${request.id}`,
      kind: "link.rejected",
      targetRef: request.ref,
      actor: "School office",
    });
    return clone(request);
  },

  async classifyStudentAccess(accountId, studentId) {
    if (studentId === null) return "current";
    try {
      const context = await familyContextService.getContext(accountId);
      if (studentId === context.activeStudentId) return "current";
      const accessible = await familyContextService.listAccessibleStudents(accountId);
      return accessible.some((student) => student.id === studentId) ? "other" : "none";
    } catch {
      return "none";
    }
  },
};

/** Named demo-only export for callers that prefer a factory-shaped service. */
export const createFamilyContextService = (): FamilyContextService => familyContextService;

/**
 * Append an enrolled child (person + student + enrollment + optional link)
 * to the relationship demo store. Used by the enrollment conversion domain;
 * the records are cloned in and out so callers never hold store references.
 * Records are keyed by id — a repeated call with the same id is a no-op.
 */
export function addEnrolledChild(input: {
  person: Person;
  student: Student;
  enrollment: Enrollment;
  link: GuardianStudentLink | null;
}): {
  person: Person;
  student: Student;
  enrollment: Enrollment;
  link: GuardianStudentLink | null;
} {
  const store = loadRelationshipStore();
  if (!store.people.some((candidate) => candidate.id === input.person.id)) {
    store.people.push(clone(input.person));
  }
  if (!store.students.some((candidate) => candidate.id === input.student.id)) {
    store.students.push(clone(input.student));
  }
  if (!store.enrollments.some((candidate) => candidate.id === input.enrollment.id)) {
    store.enrollments.push(clone(input.enrollment));
  }
  if (input.link !== null && !store.links.some((candidate) => candidate.id === input.link!.id)) {
    store.links.push(clone(input.link));
  }
  saveRelationshipStore(store);
  return {
    person: clone(input.person),
    student: clone(input.student),
    enrollment: clone(input.enrollment),
    link: input.link === null ? null : clone(input.link),
  };
}

/** Resolve a store person by display name (guardian matching for conversion). */
export function findPersonByDisplayName(displayName: string): Person | null {
  const person = loadRelationshipStore().people.find(
    (candidate) => candidate.displayName.toLowerCase() === displayName.trim().toLowerCase(),
  );
  return person === undefined ? null : clone(person);
}

