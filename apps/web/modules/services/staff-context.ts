import {
  academicYearSchema,
  staffWorkspaceContextSchema,
  type AcademicYear,
  type RoleGrant,
  type StaffAssignment,
  type StaffMember,
  type StaffWorkspaceContext,
  type UserAccount,
} from "@fass/contracts";

import { demoNowIso } from "@/modules/demo/clock";
import { demoAcademicYears, demoRelationshipGraph } from "@/modules/relationships/demo";
import {
  loadRelationshipStore,
  saveRelationshipStore,
  type RelationshipDemoStore,
  RelationshipContextError,
  type RelationshipContextErrorCode,
} from "@/modules/services/family-context";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isEffective(fromIso: string, toIso: string | null, atIso: string): boolean {
  return fromIso <= atIso && (toIso === null || atIso < toIso);
}

function accountById(accountId: string): UserAccount | undefined {
  return demoRelationshipGraph.userAccounts.find((account) => account.id === accountId);
}

function staffForAccount(accountId: string): StaffMember | undefined {
  const account = accountById(accountId);
  return account === undefined
    ? undefined
    : demoRelationshipGraph.staffMembers.find((staff) => staff.personId === account.personId);
}

function staffGrantsForAccount(accountId: string): RoleGrant[] {
  const nowIso = demoNowIso();
  return demoRelationshipGraph.roleGrants.filter(
    (grant) =>
      grant.accountId === accountId &&
      grant.status === "active" &&
      grant.role !== "guardian" &&
      grant.role !== "student" &&
      isEffective(grant.effectiveFromIso, grant.effectiveToIso, nowIso),
  );
}

function requireStaffAccount(accountId: string): { account: UserAccount; staff: StaffMember; grants: RoleGrant[] } {
  const account = accountById(accountId);
  if (account === undefined || account.status !== "active") {
    throw new RelationshipContextError("account-not-found", "The account was not found.");
  }
  const staff = staffForAccount(accountId);
  const grants = staffGrantsForAccount(accountId);
  if (staff === undefined || staff.status !== "active" || grants.length === 0) {
    throw new RelationshipContextError("workspace-not-granted", "This account has no active staff workspace.");
  }
  return { account, staff, grants };
}

function currentAcademicYear(): AcademicYear {
  const year = demoAcademicYears.find((candidate) => candidate.status === "current");
  if (year === undefined) {
    throw new RelationshipContextError("enrollment-not-found", "No current academic year is configured.");
  }
  return academicYearSchema.parse(clone(year));
}

function activeAssignmentsFor(
  staff: StaffMember,
  roleGrant: RoleGrant,
  academicYear: AcademicYear,
): StaffAssignment[] {
  const nowIso = demoNowIso();
  return demoRelationshipGraph.staffAssignments.filter(
    (assignment) =>
      assignment.staffMemberId === staff.id &&
      assignment.roleGrantId === roleGrant.id &&
      assignment.academicYearId === academicYear.id &&
      assignment.status === "active" &&
      isEffective(assignment.effectiveFromIso, assignment.effectiveToIso, nowIso),
  );
}

function resolveWorkspace(accountId: string): {
  account: UserAccount;
  staff: StaffMember;
  grants: RoleGrant[];
  roleGrant: RoleGrant;
  academicYear: AcademicYear;
  store: RelationshipDemoStore;
} {
  const { account, staff, grants } = requireStaffAccount(accountId);
  const store = loadRelationshipStore();
  const storedGrantId = store.activeWorkspaceByAccount[accountId];
  const roleGrant = storedGrantId === undefined ? grants[0] : grants.find((grant) => grant.id === storedGrantId);

  if (roleGrant === undefined) {
    throw new RelationshipContextError("workspace-not-granted", "The selected staff workspace is no longer granted.");
  }
  const academicYear = currentAcademicYear();
  return { account, staff, grants, roleGrant, academicYear, store };
}

function contextFromResolved(resolved: ReturnType<typeof resolveWorkspace>): StaffWorkspaceContext {
  const activeAssignments = activeAssignmentsFor(resolved.staff, resolved.roleGrant, resolved.academicYear);
  return staffWorkspaceContextSchema.parse({
    accountId: resolved.account.id,
    staffMemberId: resolved.staff.id,
    activeRoleGrantId: resolved.roleGrant.id,
    activeRole: resolved.roleGrant.role,
    activeAssignmentIds: activeAssignments.map((assignment) => assignment.id),
    academicYearId: resolved.academicYear.id,
  });
}

export interface StaffContextService {
  getWorkspace(accountId: string): Promise<StaffWorkspaceContext>;
  listGrantedWorkspaces(accountId: string): Promise<RoleGrant[]>;
  setActiveWorkspace(accountId: string, roleGrantId: string): Promise<StaffWorkspaceContext>;
  getActiveAssignments(accountId: string, assignmentId?: string): Promise<StaffAssignment[]>;
  /** Placement labels of the active assignments — used to scope teacher views. */
  getActiveAssignmentSections(accountId: string): Promise<Array<{ gradeLabel: string; sectionLabel: string }>>;
  getAcademicYear(accountId: string): Promise<AcademicYear>;
  /** Safe display summary for the shell — person, role, year, assignments. */
  getWorkspaceSummary(accountId: string): Promise<StaffWorkspaceSummary>;
}

/** Demo staff account used when a staff route is opened without a session. */
export const DEMO_STAFF_ACCOUNT_ID = "00000000-0000-4000-8000-000000000203";

/** Presentation labels for staff roles — display-only, never an access check. */
const ROLE_LABELS: Record<string, string> = {
  content_editor: "Content editor",
  content_publisher: "Content publisher",
  admissions_officer: "Admissions officer",
  admissions_approver: "Admissions approver",
  finance_officer: "Finance officer",
  finance_approver: "Finance approver",
  teacher: "Teacher",
  exam_reviewer: "Exam reviewer",
  result_publisher: "Result publisher",
  timetable_manager: "Timetable manager",
  hr_reviewer: "HR reviewer",
  hr_approver: "HR approver",
  support_officer: "Support officer",
  auditor: "Auditor",
  system_administrator: "System administrator",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export type StaffWorkspaceSummary = {
  accountId: string;
  staffMemberId: string;
  personId: string;
  displayName: string;
  title: string;
  /** The ACTIVE role grant id — workspace switching must send this, never the role name. */
  activeRoleGrantId: string;
  role: string;
  roleLabel: string;
  academicYearLabel: string;
  /** e.g. "Class 8-A · Mathematics"; null when the role has no assignments. */
  assignmentLabel: string | null;
  grantedWorkspaceCount: number;
};

export const staffContextService: StaffContextService = {
  async getWorkspace(accountId) {
    const resolved = resolveWorkspace(accountId);
    if (resolved.store.activeWorkspaceByAccount[accountId] === undefined) {
      resolved.store.activeWorkspaceByAccount[accountId] = resolved.roleGrant.id;
      saveRelationshipStore(resolved.store);
    }
    return clone(contextFromResolved(resolved));
  },

  async listGrantedWorkspaces(accountId) {
    requireStaffAccount(accountId);
    return staffGrantsForAccount(accountId).map((grant) => clone(grant));
  },

  async setActiveWorkspace(accountId, roleGrantId) {
    const resolved = resolveWorkspace(accountId);
    const selected = resolved.grants.find((grant) => grant.id === roleGrantId);
    if (selected === undefined) {
      throw new RelationshipContextError("workspace-not-granted", "That workspace is not granted to this account.");
    }
    resolved.store.activeWorkspaceByAccount[accountId] = selected.id;
    saveRelationshipStore(resolved.store);
    return clone(contextFromResolved({ ...resolved, roleGrant: selected }));
  },

  async getActiveAssignments(accountId, assignmentId) {
    const resolved = resolveWorkspace(accountId);
    const activeAssignments = activeAssignmentsFor(resolved.staff, resolved.roleGrant, resolved.academicYear);
    if (assignmentId !== undefined) {
      const selected = demoRelationshipGraph.staffAssignments.find(
        (assignment) =>
          assignment.id === assignmentId &&
          assignment.staffMemberId === resolved.staff.id &&
          assignment.roleGrantId === resolved.roleGrant.id,
      );
      if (selected === undefined || !activeAssignments.some((assignment) => assignment.id === assignmentId)) {
        throw new RelationshipContextError("assignment-not-active", "That assignment is not active in this workspace.");
      }
      return [clone(selected)];
    }
    return activeAssignments.map((assignment) => clone(assignment));
  },

  async getAcademicYear(accountId) {
    requireStaffAccount(accountId);
    return clone(currentAcademicYear());
  },

  async getActiveAssignmentSections(accountId) {
    const resolved = resolveWorkspace(accountId);
    return activeAssignmentsFor(resolved.staff, resolved.roleGrant, resolved.academicYear)
      .map((assignment) => {
        const section = demoRelationshipGraph.gradeSections.find(
          (candidate) => candidate.id === assignment.gradeSectionId,
        );
        return section === undefined
          ? null
          : { gradeLabel: section.gradeLabel, sectionLabel: section.sectionLabel };
      })
      .filter((section): section is { gradeLabel: string; sectionLabel: string } => section !== null);
  },

  async getWorkspaceSummary(accountId) {
    const resolved = resolveWorkspace(accountId);
    if (resolved.store.activeWorkspaceByAccount[accountId] === undefined) {
      resolved.store.activeWorkspaceByAccount[accountId] = resolved.roleGrant.id;
      saveRelationshipStore(resolved.store);
    }
    const person = demoRelationshipGraph.people.find((candidate) => candidate.id === resolved.account.personId);
    const activeAssignments = activeAssignmentsFor(resolved.staff, resolved.roleGrant, resolved.academicYear);
    const assignmentLabel =
      activeAssignments
        .map((assignment) => {
          const section = demoRelationshipGraph.gradeSections.find(
            (candidate) => candidate.id === assignment.gradeSectionId,
          );
          return `${section ? `${section.gradeLabel}-${section.sectionLabel}` : "—"} · ${assignment.subjectName}`;
        })
        .join(", ") || null;
    return {
      accountId: resolved.account.id,
      staffMemberId: resolved.staff.id,
      personId: resolved.account.personId,
      displayName: person?.displayName ?? "Staff member",
      title: resolved.staff.title,
      activeRoleGrantId: resolved.roleGrant.id,
      role: resolved.roleGrant.role,
      roleLabel: roleLabel(resolved.roleGrant.role),
      academicYearLabel: resolved.academicYear.label,
      assignmentLabel,
      grantedWorkspaceCount: resolved.grants.length,
    };
  },
};

/** Named demo-only export for callers that prefer a factory-shaped service. */
export const createStaffContextService = (): StaffContextService => staffContextService;

export type StaffContextErrorCode = RelationshipContextErrorCode;
