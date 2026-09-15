/**
 * Teaching staff service — non-login teacher records and their class/subject
 * assignments (three-portal consolidation, Phase 3). The Principal maintains
 * these records for timetable attribution and conflict checks; creating or
 * editing them never creates an auth identity, user account, or role grant.
 *
 * Demo adapter: deterministic records in the relationship store. Supabase
 * adapter: app.teaching_* commands through the same-origin gateway.
 */

import {
  teachingAssignmentEndInputSchema,
  teachingAssignmentSchema,
  teachingStaffCreateInputSchema,
  type TeachingAssignment,
  type TeachingStaffRow,
} from "@fass/contracts";

import { demoNowIso } from "@/modules/demo/clock";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";
import {
  loadRelationshipStore,
  saveRelationshipStore,
  type RelationshipDemoStore,
} from "@/modules/services/family-context";
import { DEMO_SUBJECTS } from "@/modules/services/school-config";

export type TeachingStaffRecord = TeachingStaffRow;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nextRef(prefix: string, counter: number): string {
  return `${prefix}-2026-${String(counter).padStart(4, "0")}`;
}

function nextId(base: string, counter: number): number {
  return counter;
}

/** Non-login teaching staff: staff members without a linked login account. */
function deriveStoreTeachingStaff(store: RelationshipDemoStore): TeachingStaffRow[] {
  const accountPersonIds = new Set(store.userAccounts.map((account) => account.personId));
  const rows: TeachingStaffRow[] = [];
  for (const staff of store.staffMembers) {
    /* A non-login record has no active staff account. Historical people who
       once held a login remain listed with their legacy linkage. */
    const hasAccount = staff.personId !== null && accountPersonIds.has(staff.personId);
    if (hasAccount) continue;
    const assignments = store.staffAssignments
      .filter((assignment) => assignment.staffMemberId === staff.id)
      .map((assignment) => ({
        id: assignment.id,
        ref: assignment.ref,
        staffMemberId: assignment.staffMemberId,
        academicYearId: assignment.academicYearId,
        gradeSectionId: assignment.gradeSectionId,
        subjectId: assignment.subjectId,
        status: assignment.status,
        effectiveFromIso: assignment.effectiveFromIso,
        effectiveToIso: assignment.effectiveToIso,
        version: 1,
        provenance: "manual" as const,
        sourceRef: null,
        createdReason: "Teaching assignment",
        createdAtIso: assignment.effectiveFromIso,
        updatedByAccountId: null,
      }));
    rows.push({
      staffMemberId: staff.id,
      staffRef: staff.ref,
      displayName: staff.title,
      title: staff.title,
      status: staff.status,
      legacyAccountId: null,
      assignments,
    });
  }
  return rows;
}

function listDemoTeachingStaff(): TeachingStaffRow[] {
  return deriveStoreTeachingStaff(loadRelationshipStore());
}

export interface TeachingStaffService {
  /** Non-login teaching staff with their assignment history. */
  listTeachingStaff(): Promise<TeachingStaffRow[]>;
  /** Create a non-login teaching staff record (never an account). */
  createTeachingStaff(input: { displayName: string; title: string; reason: string }): Promise<{ staffMemberId: string; ref: string }>;
  /** Add an exact class/subject assignment for the current year. */
  createAssignment(input: {
    staffMemberId: string;
    academicYearId: string;
    gradeSectionId: string;
    subjectId: string;
    effectiveFrom?: string | null;
    reason: string;
  }): Promise<{ assignmentId: string; ref: string }>;
  /** End an assignment with reason (history preserved). */
  endAssignment(input: { assignmentId: string; reason: string; expectedVersion: number }): Promise<{ status: string; version: number }>;
}

export const teachingStaffService: TeachingStaffService = {
  async listTeachingStaff() {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<TeachingStaffRow[]>("teachingStaff.list", {});
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Teaching staff are unavailable.");
      return result.value;
    }
    return clone(listDemoTeachingStaff());
  },

  async createTeachingStaff(input) {
    const parsed = teachingStaffCreateInputSchema.parse(input);
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<{ staffMemberId: string; reference: string }>("teachingStaff.create", {
        displayName: parsed.displayName,
        title: parsed.title,
        reason: parsed.reason,
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The teaching record could not be created.");
      return { staffMemberId: result.value.staffMemberId, ref: result.value.reference };
    }
    const store = loadRelationshipStore();
    const staffId = `00000000-0000-4000-8000-${String(400 + store.staffCounter).padStart(12, "0")}`;
    const ref = nextRef("STF", store.staffCounter);
    store.staffMembers.push({
      id: staffId,
      ref,
      personId: null as unknown as string,
      status: "active",
      title: parsed.title,
      accessProfileCode: null,
      accessProfileVersion: null,
    });
    /* Non-login records have no person/account linkage; the demo store's
       StaffMember type requires a personId, so a sentinel is stored and the
       derivation treats it as absent. */
    const created = store.staffMembers[store.staffMembers.length - 1];
    if (created !== undefined) created.personId = null as unknown as string;
    store.staffCounter += 1;
    saveRelationshipStore(store);
    return { staffMemberId: staffId, ref };
  },

  async createAssignment(input) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<{ assignmentId: string; reference: string }>("teachingStaff.assign", input);
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The assignment could not be created.");
      return { assignmentId: result.value.assignmentId, ref: result.value.reference };
    }
    if (!input.reason?.trim()) throw new Error("A reason is required — it becomes part of the assignment history.");
    if (!input.academicYearId?.trim() || !input.gradeSectionId?.trim() || !input.subjectId?.trim()) {
      throw new Error("An assignment needs an academic year, a class, and a subject.");
    }
    const store = loadRelationshipStore();
    const staff = store.staffMembers.find((candidate) => candidate.id === input.staffMemberId);
    if (!staff) throw new Error("Teaching staff record not found.");
    const subject = DEMO_SUBJECTS.find((candidate) => candidate.id === input.subjectId);
    const assignmentId = `00000000-0000-4000-8000-${String(500 + store.grantCounter).padStart(12, "0")}`;
    const ref = nextRef("TAS", store.grantCounter);
    /* Teaching assignments are independent of logins: roleGrantId stays null
       and this path never touches userAccounts or role_grants. Teachers hold
       no accounts/grants by construction. */
    store.staffAssignments.push({
      id: assignmentId,
      ref,
      staffMemberId: input.staffMemberId,
      roleGrantId: null,
      academicYearId: input.academicYearId,
      gradeSectionId: input.gradeSectionId,
      subjectId: input.subjectId,
      subjectRef: subject?.code ?? "",
      subjectName: subject?.name ?? "Assigned subject",
      status: "active",
      effectiveFromIso: input.effectiveFrom ?? demoNowIso(),
      effectiveToIso: null,
    });
    store.grantCounter += 1;
    saveRelationshipStore(store);
    return { assignmentId, ref };
  },

  async endAssignment(input) {
    const parsed = teachingAssignmentEndInputSchema.parse(input);
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<{ status: string; version: number }>("teachingStaff.endAssignment", {
        assignmentId: parsed.assignmentId,
        reason: parsed.reason,
        expectedVersion: parsed.expectedVersion,
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The assignment could not be ended.");
      return result.value;
    }
    const store = loadRelationshipStore();
    const assignment = store.staffAssignments.find((candidate) => candidate.id === parsed.assignmentId);
    if (assignment === undefined) throw new Error("Teaching assignment not found.");
    if (assignment.status === "ended") throw new Error("This assignment is already ended.");
    /* Demo optimistic concurrency: active teaching assignments are version 1
       (see deriveStoreTeachingStaff). A stale expectedVersion never ends history. */
    if (parsed.expectedVersion !== 1) {
      throw new Error(`Teaching assignment version mismatch (expected 1, found ${parsed.expectedVersion}).`);
    }
    assignment.status = "ended";
    assignment.effectiveToIso = demoNowIso();
    saveRelationshipStore(store);
    return { status: "ended", version: 2 };
  },
};
