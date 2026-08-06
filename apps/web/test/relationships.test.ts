import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  academicYearSchema,
  enrollmentSchema,
  familyPortalContextSchema,
  gradeSectionSchema,
  guardianSchema,
  guardianStudentLinkSchema,
  personSchema,
  roleGrantSchema,
  staffAssignmentSchema,
  staffMemberSchema,
  staffWorkspaceContextSchema,
  studentSchema,
  userAccountSchema,
} from "@fass/contracts";
import {
  demoAcademicYears,
  demoEnrollments,
  demoGradeSections,
  demoGuardianStudentLinks,
  demoGuardians,
  demoPeople,
  demoRelationshipGraph,
  demoRoleGrants,
  demoStaffAssignments,
  demoStaffMembers,
  demoStudents,
  demoUserAccounts,
} from "@/modules/relationships/demo";
import { setDemoNow } from "@/modules/demo/clock";
import {
  familyContextService,
  gradeSectionLabel,
  RELATIONSHIPS_SESSION_KEY,
} from "@/modules/services/family-context";
import { sessionRemove } from "@/modules/services/session";
import { staffContextService } from "@/modules/services/staff-context";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const FIRDous_ACCOUNT_ID = "00000000-0000-4000-8000-000000000201";
const NIDA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000202";
const SANA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000203";
const AARIF_ID = "00000000-0000-4000-8000-000000000901";
const MARIAM_ID = "00000000-0000-4000-8000-000000000902";
const ZOYA_ID = "00000000-0000-4000-8000-000000000903";
const CURRENT_YEAR_ID = "00000000-0000-4000-8000-000000000602";
const HISTORICAL_YEAR_ID = "00000000-0000-4000-8000-000000000601";
const PENDING_LINK_ID = "00000000-0000-4000-8000-000000001103";
const AARIF_LINK_ID = "00000000-0000-4000-8000-000000001101";
const MARIAM_LINK_ID = "00000000-0000-4000-8000-000000001102";
const RESTRICTED_LINK_ID = "00000000-0000-4000-8000-000000001104";
const ENDED_ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000502";
const SCHEDULED_ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000503";
const TEACHER_ROLE_GRANT_ID = "00000000-0000-4000-8000-000000000302";
const FINANCE_ROLE_GRANT_ID = "00000000-0000-4000-8000-000000000304";
const PUBLISHER_ROLE_GRANT_ID = "00000000-0000-4000-8000-000000000305";
const ADMISSIONS_ROLE_GRANT_ID = "00000000-0000-4000-8000-000000000306";
const EXAM_REVIEWER_ROLE_GRANT_ID = "00000000-0000-4000-8000-000000000315";
const AISHA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000204";
const RANIA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000205";
const RANIA_ADMISSIONS_APPROVER_GRANT_ID = "00000000-0000-4000-8000-000000000311";
const RANIA_FINANCE_APPROVER_GRANT_ID = "00000000-0000-4000-8000-000000000312";
const RANIA_HR_APPROVER_GRANT_ID = "00000000-0000-4000-8000-000000000313";
const RANIA_TIMETABLE_MANAGER_GRANT_ID = "00000000-0000-4000-8000-000000000314";

beforeEach(() => {
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(PINNED);
});

afterEach(() => {
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(null);
});

describe("relationship contracts and deterministic graph", () => {
  it("parses every I0 record through its shared Zod schema", () => {
    expect(personSchema.array().parse(demoPeople)).toHaveLength(8);
    expect(userAccountSchema.array().parse(demoUserAccounts)).toHaveLength(5);
    /* 10 seeded grants + 6 Phase-1 grants (311–316: four approval/management
       grants for Rania, exam review for Sana, content publishing for Aisha). */
    expect(roleGrantSchema.array().parse(demoRoleGrants)).toHaveLength(16);
    expect(staffMemberSchema.array().parse(demoStaffMembers)).toHaveLength(4);
    expect(staffAssignmentSchema.array().parse(demoStaffAssignments)).toHaveLength(3);
    expect(guardianSchema.array().parse(demoGuardians)).toHaveLength(2);
    expect(studentSchema.array().parse(demoStudents)).toHaveLength(3);
    expect(guardianStudentLinkSchema.array().parse(demoGuardianStudentLinks)).toHaveLength(5);
    expect(academicYearSchema.array().parse(demoAcademicYears)).toHaveLength(2);
    expect(gradeSectionSchema.array().parse(demoGradeSections)).toHaveLength(3);
    expect(enrollmentSchema.array().parse(demoEnrollments)).toHaveLength(5);
    expect(demoRelationshipGraph.people.every((person) => person.id !== person.ref)).toBe(true);
  });

  it("returns cloned student records rather than exposing the fixture", async () => {
    const students = await familyContextService.listAccessibleStudents(FIRDous_ACCOUNT_ID);
    expect(students.map((student) => student.id)).toEqual([AARIF_ID, MARIAM_ID]);

    students[0]!.displayName = "Mutated caller copy";
    const reread = await familyContextService.listAccessibleStudents(FIRDous_ACCOUNT_ID);
    expect(reread[0]?.displayName).toBe("Aarif Hussain");
  });
});

describe("family context", () => {
  it("isolates two-child access and persists an explicit active-child switch", async () => {
    const firdousStudents = await familyContextService.listAccessibleStudents(FIRDous_ACCOUNT_ID);
    const nidaStudents = await familyContextService.listAccessibleStudents(NIDA_ACCOUNT_ID);

    expect(firdousStudents.map((student) => student.id)).toEqual([AARIF_ID, MARIAM_ID]);
    expect(nidaStudents).toEqual([]);

    const context = await familyContextService.setActiveStudent(FIRDous_ACCOUNT_ID, MARIAM_ID);
    expect(familyPortalContextSchema.parse(context)).toMatchObject({
      accountId: FIRDous_ACCOUNT_ID,
      activeStudentId: MARIAM_ID,
      activeEnrollmentId: "00000000-0000-4000-8000-000000001204",
      academicYearId: CURRENT_YEAR_ID,
    });
    expect(context.allowedCapabilities).toEqual(["academics", "finance", "documents", "notices", "profile"]);

    await expect(familyContextService.setActiveStudent(NIDA_ACCOUNT_ID, MARIAM_ID)).rejects.toMatchObject({
      code: "link-not-active",
    });
  });

  it("chooses the active enrollment, not the historical enrollment", async () => {
    const enrollment = await familyContextService.getActiveEnrollment(AARIF_ID, CURRENT_YEAR_ID);
    expect(enrollment).toMatchObject({
      id: "00000000-0000-4000-8000-000000001202",
      status: "active",
    });

    await expect(familyContextService.getActiveEnrollment(AARIF_ID, HISTORICAL_YEAR_ID)).rejects.toMatchObject({
      code: "enrollment-not-found",
    });

    const context = await familyContextService.getContext(FIRDous_ACCOUNT_ID);
    expect(context.activeStudentId).toBe(AARIF_ID);
    expect(context.activeEnrollmentId).toBe("00000000-0000-4000-8000-000000001202");
  });

  it("filters capabilities and denies pending, restricted, and ended relationships", async () => {
    const activeLink = demoGuardianStudentLinks.find((link) => link.id === AARIF_LINK_ID)!;
    const restrictedLink = demoGuardianStudentLinks.find((link) => link.id === RESTRICTED_LINK_ID)!;
    expect(familyContextService.getCapabilities(activeLink)).toEqual(activeLink.capabilities);
    expect(familyContextService.getCapabilities(restrictedLink)).toEqual([]);

    await expect(familyContextService.setActiveStudent(NIDA_ACCOUNT_ID, ZOYA_ID)).rejects.toMatchObject({
      code: "link-not-active",
    });
    await expect(familyContextService.setActiveStudent(NIDA_ACCOUNT_ID, AARIF_ID)).rejects.toMatchObject({
      code: "link-not-active",
    });
    await expect(familyContextService.setActiveStudent(NIDA_ACCOUNT_ID, MARIAM_ID)).rejects.toMatchObject({
      code: "link-not-active",
    });
  });

  it("supports deterministic pending-link approval and rejection", async () => {
    expect((await familyContextService.listPendingLinkRequests()).map((link) => link.id)).toEqual([PENDING_LINK_ID]);
    expect((await familyContextService.listPendingLinkRequests(NIDA_ACCOUNT_ID)).map((link) => link.id)).toEqual([
      PENDING_LINK_ID,
    ]);

    const approved = await familyContextService.approveLink(PENDING_LINK_ID);
    expect(approved.status).toBe("active");
    expect(approved.approvedAtIso).toBe(PINNED.toISOString());
    expect(await familyContextService.listAccessibleStudents(NIDA_ACCOUNT_ID)).toEqual([
      expect.objectContaining({ id: ZOYA_ID }),
    ]);
    expect((await familyContextService.getContext(NIDA_ACCOUNT_ID)).activeStudentId).toBe(ZOYA_ID);

    await expect(familyContextService.rejectLink(PENDING_LINK_ID)).rejects.toMatchObject({ code: "link-not-active" });
  });

  it("rejects a pending request and revokes a selected active link without preserving access", async () => {
    const rejected = await familyContextService.rejectLink(PENDING_LINK_ID, "Evidence did not match the school record.");
    expect(rejected).toMatchObject({ status: "rejected", rejectionReason: "Evidence did not match the school record." });
    expect(await familyContextService.listPendingLinkRequests()).toEqual([]);

    const initial = await familyContextService.getContext(FIRDous_ACCOUNT_ID);
    expect(initial.activeStudentId).toBe(AARIF_ID);
    const revoked = await familyContextService.revokeLink(AARIF_LINK_ID);
    expect(revoked.status).toBe("ended");
    expect(revoked.effectiveToIso).toBe(PINNED.toISOString());
    expect((await familyContextService.listAccessibleStudents(FIRDous_ACCOUNT_ID)).map((student) => student.id)).toEqual([
      MARIAM_ID,
    ]);
    await expect(familyContextService.getContext(FIRDous_ACCOUNT_ID)).rejects.toMatchObject({ code: "link-not-active" });

    const safeCopy = await familyContextService.revokeLink(MARIAM_LINK_ID);
    safeCopy.status = "active";
    expect((await familyContextService.listAccessibleStudents(FIRDous_ACCOUNT_ID)).map((student) => student.id)).toEqual([]);
  });
});

describe("staff context and shared identity", () => {
  it("scopes the teacher workspace to its active assignment and role", async () => {
    const workspaces = await staffContextService.listGrantedWorkspaces(FIRDous_ACCOUNT_ID);
    expect(workspaces.map((grant) => grant.id)).toEqual([TEACHER_ROLE_GRANT_ID]);

    const workspace = await staffContextService.getWorkspace(FIRDous_ACCOUNT_ID);
    expect(staffWorkspaceContextSchema.parse(workspace)).toMatchObject({
      accountId: FIRDous_ACCOUNT_ID,
      activeRoleGrantId: TEACHER_ROLE_GRANT_ID,
      activeRole: "teacher",
      academicYearId: CURRENT_YEAR_ID,
      activeAssignmentIds: ["00000000-0000-4000-8000-000000000501"],
    });

    const assignments = await staffContextService.getActiveAssignments(FIRDous_ACCOUNT_ID);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ subjectName: "Mathematics", gradeSectionId: "00000000-0000-4000-8000-000000000702" });
    await expect(staffContextService.getActiveAssignments(FIRDous_ACCOUNT_ID, ENDED_ASSIGNMENT_ID)).rejects.toMatchObject({
      code: "assignment-not-active",
    });
    await expect(staffContextService.getActiveAssignments(FIRDous_ACCOUNT_ID, SCHEDULED_ASSIGNMENT_ID)).rejects.toMatchObject({
      code: "assignment-not-active",
    });
  });

  it("supports additive role switching without granting a guardian role as staff scope", async () => {
    const granted = await staffContextService.listGrantedWorkspaces(SANA_ACCOUNT_ID);
    expect(granted.map((grant) => grant.id)).toEqual([
      FINANCE_ROLE_GRANT_ID,
      PUBLISHER_ROLE_GRANT_ID,
      ADMISSIONS_ROLE_GRANT_ID,
      EXAM_REVIEWER_ROLE_GRANT_ID,
    ]);
    expect((await staffContextService.getWorkspace(SANA_ACCOUNT_ID)).activeRole).toBe("finance_officer");

    const publisher = await staffContextService.setActiveWorkspace(SANA_ACCOUNT_ID, PUBLISHER_ROLE_GRANT_ID);
    expect(publisher.activeRole).toBe("result_publisher");
    expect(publisher.activeAssignmentIds).toEqual([]);
    const reviewer = await staffContextService.setActiveWorkspace(SANA_ACCOUNT_ID, EXAM_REVIEWER_ROLE_GRANT_ID);
    expect(reviewer.activeRole).toBe("exam_reviewer");
    await expect(staffContextService.setActiveWorkspace(SANA_ACCOUNT_ID, TEACHER_ROLE_GRANT_ID)).rejects.toMatchObject({
      code: "workspace-not-granted",
    });
    expect((await staffContextService.getAcademicYear(SANA_ACCOUNT_ID)).id).toBe(CURRENT_YEAR_ID);

    /* Aisha Lone (account 204) holds the office roles; the Phase-1
       content_publisher grant sits between content_editor and support. */
    const aishaGrants = await staffContextService.listGrantedWorkspaces(AISHA_ACCOUNT_ID);
    expect(aishaGrants.map((grant) => grant.role)).toEqual([
      "content_editor",
      "content_publisher",
      "support_officer",
      "auditor",
      "system_administrator",
    ]);
    expect((await staffContextService.getWorkspaceSummary(AISHA_ACCOUNT_ID)).roleLabel).toBe("Content editor");
  });

  it("gives Rania Mir the approval and timetable workspaces with admissions approver active", async () => {
    const granted = await staffContextService.listGrantedWorkspaces(RANIA_ACCOUNT_ID);
    expect(granted.map((grant) => grant.id)).toEqual([
      RANIA_ADMISSIONS_APPROVER_GRANT_ID,
      RANIA_FINANCE_APPROVER_GRANT_ID,
      RANIA_HR_APPROVER_GRANT_ID,
      RANIA_TIMETABLE_MANAGER_GRANT_ID,
    ]);
    expect(granted.map((grant) => grant.role)).toEqual([
      "admissions_approver",
      "finance_approver",
      "hr_approver",
      "timetable_manager",
    ]);

    const workspace = await staffContextService.getWorkspace(RANIA_ACCOUNT_ID);
    expect(workspace.activeRole).toBe("admissions_approver");
    expect(workspace.activeRoleGrantId).toBe(RANIA_ADMISSIONS_APPROVER_GRANT_ID);

    const summary = await staffContextService.getWorkspaceSummary(RANIA_ACCOUNT_ID);
    expect(summary).toMatchObject({
      accountId: RANIA_ACCOUNT_ID,
      displayName: "Rania Mir",
      title: "Admissions and finance approver",
      role: "admissions_approver",
      roleLabel: "Admissions approver",
      grantedWorkspaceCount: 4,
    });
  });

  it("keeps the multi-role person/account usable in separate family and staff contexts", async () => {
    const person = demoPeople.find((candidate) => candidate.displayName === "Firdous Ahmad")!;
    const account = demoUserAccounts.find((candidate) => candidate.id === FIRDous_ACCOUNT_ID)!;
    const roles = demoRoleGrants.filter((grant) => grant.accountId === account.id).map((grant) => grant.role);
    expect(person.id).toBe(account.personId);
    expect(roles).toEqual(["guardian", "teacher"]);
    expect((await familyContextService.getContext(FIRDous_ACCOUNT_ID)).guardianId).toBe(
      "00000000-0000-4000-8000-000000001001",
    );
    expect((await staffContextService.getWorkspace(FIRDous_ACCOUNT_ID)).activeRole).toBe("teacher");
  });
});

describe("family context presentation summaries", () => {
  it("resolves service-owned student contexts with placement and year", async () => {
    const contexts = await familyContextService.listAccessibleStudentContexts(FIRDous_ACCOUNT_ID);
    expect(contexts.map((item) => item.student.id)).toEqual([AARIF_ID, MARIAM_ID]);
    expect(contexts[0]).toMatchObject({
      enrollment: expect.objectContaining({ status: "active", academicYearId: CURRENT_YEAR_ID }),
      gradeSection: expect.objectContaining({ gradeLabel: "Class 8", sectionLabel: "A" }),
      academicYear: expect.objectContaining({ label: "2026–27", status: "current" }),
    });
    expect(gradeSectionLabel(contexts[0]!.gradeSection)).toBe("Class 8-A");
    expect(contexts[1]!.academicYear.id).toBe(CURRENT_YEAR_ID);

    contexts[0]!.student.displayName = "Mutated caller copy";
    const reread = await familyContextService.listAccessibleStudentContexts(FIRDous_ACCOUNT_ID);
    expect(reread[0]?.student.displayName).toBe("Aarif Hussain");
  });

  it("returns a safe account summary for the shell identity", async () => {
    const summary = await familyContextService.getAccountSummary(FIRDous_ACCOUNT_ID);
    expect(summary).toEqual({
      accountId: FIRDous_ACCOUNT_ID,
      personId: "00000000-0000-4000-8000-000000000101",
      displayName: "Firdous Ahmad",
      guardianId: "00000000-0000-4000-8000-000000001001",
    });
    await expect(familyContextService.getAccountSummary("00000000-0000-4000-8000-000000009999")).rejects.toMatchObject({
      code: "account-not-found",
    });
  });

  it("summarizes the pending link request with guardian and student names", async () => {
    const summaries = await familyContextService.listLinkRequestSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      guardianName: "Nida Bhat",
      studentName: "Zoya Khan",
      link: expect.objectContaining({ id: PENDING_LINK_ID, status: "pending_verification" }),
    });
  });

  it("resolves the staff workspace summary from role, year, and assignments", async () => {
    const finance = await staffContextService.getWorkspaceSummary(SANA_ACCOUNT_ID);
    expect(finance).toMatchObject({
      accountId: SANA_ACCOUNT_ID,
      displayName: "Sana Wani",
      role: "finance_officer",
      roleLabel: "Finance officer",
      academicYearLabel: "2026–27",
      assignmentLabel: null,
      grantedWorkspaceCount: 4,
    });

    const teacher = await staffContextService.getWorkspaceSummary(FIRDous_ACCOUNT_ID);
    expect(teacher).toMatchObject({
      role: "teacher",
      roleLabel: "Teacher",
      assignmentLabel: "Class 8-A · Mathematics",
    });

    await staffContextService.setActiveWorkspace(SANA_ACCOUNT_ID, PUBLISHER_ROLE_GRANT_ID);
    expect((await staffContextService.getWorkspaceSummary(SANA_ACCOUNT_ID)).role).toBe("result_publisher");
  });
});

describe("typed context errors", () => {
  it("distinguishes unknown accounts from missing family and staff workspaces", async () => {
    await expect(familyContextService.listAccessibleStudents("00000000-0000-4000-8000-000000009999")).rejects.toMatchObject({
      code: "account-not-found",
    });
    await expect(staffContextService.getWorkspace(NIDA_ACCOUNT_ID)).rejects.toMatchObject({
      code: "workspace-not-granted",
    });
    await expect(familyContextService.getContext(NIDA_ACCOUNT_ID)).rejects.toMatchObject({
      code: "student-not-linked",
    });
    await expect(familyContextService.setActiveStudent(FIRDous_ACCOUNT_ID, "00000000-0000-4000-8000-000000009999")).rejects.toMatchObject({
      code: "student-not-linked",
    });
  });
});
