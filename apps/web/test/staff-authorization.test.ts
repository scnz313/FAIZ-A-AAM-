import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  loadRelationshipStore,
  RELATIONSHIPS_SESSION_KEY,
  saveRelationshipStore,
} from "@/modules/services/family-context";
import {
  assignmentsCoverClass,
  can,
  canRole,
  normalizeClassLabel,
  workspacesForAction,
} from "@/modules/services/staff-authorization";
import { staffContextService } from "@/modules/services/staff-context";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const IDENTITY_SESSION_KEY = sessionKey("identity");

const SANA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000203";
const AISHA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000204";
const RANIA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000205";
const ADMISSIONS_GRANT_ID = "00000000-0000-4000-8000-000000000306";
const SYSTEM_ADMIN_GRANT_ID = "00000000-0000-4000-8000-000000000310";
const EXAM_REVIEWER_GRANT_ID = "00000000-0000-4000-8000-000000000315";

beforeEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(PINNED);
});

afterEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(null);
});

describe("canonical role → action matrix (Phase 1 maker/checker splits)", () => {
  it("gives every role exactly its intended positive AND negative actions", () => {
    /* Content: editor drafts, publisher publishes. */
    expect(canRole("content_editor", "content.view")).toBe(true);
    expect(canRole("content_editor", "content.draft")).toBe(true);
    expect(canRole("content_editor", "content.publish")).toBe(false);
    expect(canRole("content_publisher", "content.view")).toBe(true);
    expect(canRole("content_publisher", "content.publish")).toBe(true);
    expect(canRole("content_publisher", "content.draft")).toBe(false);

    /* Admissions: officer reviews, approver decides. */
    expect(canRole("admissions_officer", "admissions.view")).toBe(true);
    expect(canRole("admissions_officer", "admissions.review")).toBe(true);
    expect(canRole("admissions_officer", "admissions.approve")).toBe(false);
    expect(canRole("admissions_approver", "admissions.view")).toBe(true);
    expect(canRole("admissions_approver", "admissions.approve")).toBe(true);
    expect(canRole("admissions_approver", "admissions.review")).toBe(false);

    /* Finance: officer operates, approver approves. */
    expect(canRole("finance_officer", "finance.view")).toBe(true);
    expect(canRole("finance_officer", "finance.operate")).toBe(true);
    expect(canRole("finance_officer", "finance.approve")).toBe(false);
    expect(canRole("finance_approver", "finance.view")).toBe(true);
    expect(canRole("finance_approver", "finance.approve")).toBe(true);
    expect(canRole("finance_approver", "finance.operate")).toBe(false);

    /* Careers: reviewer scores, approver advances/rejects/offers. */
    expect(canRole("hr_reviewer", "careers.view")).toBe(true);
    expect(canRole("hr_reviewer", "careers.review")).toBe(true);
    expect(canRole("hr_reviewer", "careers.approve")).toBe(false);
    expect(canRole("hr_approver", "careers.view")).toBe(true);
    expect(canRole("hr_approver", "careers.approve")).toBe(true);
    expect(canRole("hr_approver", "careers.review")).toBe(false);

    /* Result entry officer (Principal profile) enters marks — never
       approval or publication. Teachers are non-login school records and
       hold no login role. */
    expect(canRole("result_entry_officer", "results.view")).toBe(true);
    expect(canRole("result_entry_officer", "results.enter")).toBe(true);
    expect(canRole("result_entry_officer", "results.publish")).toBe(false);
    expect(canRole("result_entry_officer", "results.approve")).toBe(false);

    /* Results: reviewer moderates, publisher releases. */
    expect(canRole("exam_reviewer", "results.view")).toBe(true);
    expect(canRole("exam_reviewer", "results.approve")).toBe(true);
    expect(canRole("exam_reviewer", "results.publish")).toBe(false);
    expect(canRole("exam_reviewer", "results.enter")).toBe(false);
    expect(canRole("result_publisher", "results.view")).toBe(true);
    expect(canRole("result_publisher", "results.publish")).toBe(true);
    expect(canRole("result_publisher", "results.approve")).toBe(false);
    expect(canRole("result_publisher", "results.enter")).toBe(false);

    /* Timetable manager owns create/validate/publish/override and shares
       school-structure configuration with the system administrator. */
    expect(canRole("timetable_manager", "timetable.view")).toBe(true);
    expect(canRole("timetable_manager", "timetable.manage")).toBe(true);
    expect(canRole("timetable_manager", "academics.configure")).toBe(true);
    expect(canRole("result_entry_officer", "academics.configure")).toBe(false);
    expect(canRole("admissions_officer", "academics.configure")).toBe(false);

    /* Support officer responds but no longer carries links.verify —
       guardian-link activation/restriction/revocation is Administrator-only. */
    expect(canRole("support_officer", "support.view")).toBe(true);
    expect(canRole("support_officer", "support.respond")).toBe(true);
    expect(canRole("support_officer", "links.verify")).toBe(false);

    /* Auditor is read-only. */
    expect(canRole("auditor", "audit.view")).toBe(true);
    expect(canRole("auditor", "support.respond")).toBe(false);
    expect(canRole("auditor", "links.verify")).toBe(false);

    /* System administrator: configuration and access grants ONLY — no
       business approvals and no business views. */
    expect(canRole("system_administrator", "users.manage")).toBe(true);
    expect(canRole("system_administrator", "settings.manage")).toBe(true);
    expect(canRole("system_administrator", "audit.view")).toBe(true);
    expect(canRole("system_administrator", "links.verify")).toBe(true);
    expect(canRole("system_administrator", "academics.configure")).toBe(true);
    expect(canRole("system_administrator", "admissions.approve")).toBe(false);
    expect(canRole("system_administrator", "finance.approve")).toBe(false);
    expect(canRole("system_administrator", "results.publish")).toBe(false);
    expect(canRole("system_administrator", "content.publish")).toBe(false);
    expect(canRole("system_administrator", "admissions.view")).toBe(false);
  });

  it("matches the account's ACTIVE workspace, not its other grants", async () => {
    expect(await can(SANA_ACCOUNT_ID, "finance.view")).toBe(true);
    expect(await can(SANA_ACCOUNT_ID, "admissions.view")).toBe(false);

    await staffContextService.setActiveWorkspace(SANA_ACCOUNT_ID, ADMISSIONS_GRANT_ID);
    expect(await can(SANA_ACCOUNT_ID, "admissions.view")).toBe(true);
    expect(await can(SANA_ACCOUNT_ID, "admissions.review")).toBe(true);
    expect(await can(SANA_ACCOUNT_ID, "admissions.approve")).toBe(false);
    expect(await can(SANA_ACCOUNT_ID, "finance.view")).toBe(false);

    /* Sana's fourth grant is exam review — moderation but never publication. */
    await staffContextService.setActiveWorkspace(SANA_ACCOUNT_ID, EXAM_REVIEWER_GRANT_ID);
    expect(await can(SANA_ACCOUNT_ID, "results.approve")).toBe(true);
    expect(await can(SANA_ACCOUNT_ID, "results.publish")).toBe(false);

    /* Rania's result_entry_officer workspace can enter marks but not
       publish or view finance — proving active-workspace scoping. */
    await staffContextService.setActiveWorkspace(RANIA_ACCOUNT_ID, "00000000-0000-4000-8000-000000000323");
    expect(await can(RANIA_ACCOUNT_ID, "results.enter")).toBe(true);
    expect(await can(RANIA_ACCOUNT_ID, "results.publish")).toBe(false);
    expect(await can(RANIA_ACCOUNT_ID, "finance.view")).toBe(false);
    /* Aisha's default workspace is content_publisher — users.manage requires
       the system-administrator workspace, proving active-workspace scoping. */
    expect(await can(AISHA_ACCOUNT_ID, "users.manage")).toBe(false);
    expect(await can(AISHA_ACCOUNT_ID, "content.publish")).toBe(true);
    expect(await can(AISHA_ACCOUNT_ID, "content.draft")).toBe(false);
    await staffContextService.setActiveWorkspace(AISHA_ACCOUNT_ID, SYSTEM_ADMIN_GRANT_ID);
    expect(await can(AISHA_ACCOUNT_ID, "users.manage")).toBe(true);

    /* Rania's default Principal workspace is content_editor — she can draft
       but not publish. Switching to admissions_officer grants review but
       not approval. */
    await staffContextService.setActiveWorkspace(RANIA_ACCOUNT_ID, "00000000-0000-4000-8000-000000000307");
    expect(await can(RANIA_ACCOUNT_ID, "content.draft")).toBe(true);
    expect(await can(RANIA_ACCOUNT_ID, "content.publish")).toBe(false);
    expect(await can(RANIA_ACCOUNT_ID, "admissions.approve")).toBe(false);
    await staffContextService.setActiveWorkspace(RANIA_ACCOUNT_ID, "00000000-0000-4000-8000-000000000318");
    expect(await can(RANIA_ACCOUNT_ID, "admissions.review")).toBe(true);
    expect(await can(RANIA_ACCOUNT_ID, "admissions.approve")).toBe(false);
  });

  it("lists only the granted workspaces that can perform an action", async () => {
    const workspaces = await staffContextService.listGrantedWorkspaces(SANA_ACCOUNT_ID);
    const forAdmissions = workspacesForAction(workspaces, "admissions.view");
    expect(forAdmissions.map((workspace) => workspace.role)).toEqual(["admissions_officer"]);
    expect(workspacesForAction(workspaces, "users.manage")).toEqual([]);
    expect(workspacesForAction(workspaces, "results.approve").map((workspace) => workspace.role)).toEqual([
      "exam_reviewer",
    ]);
    expect(workspacesForAction(workspaces, "results.publish").map((workspace) => workspace.role)).toEqual([
      "result_publisher",
    ]);
  });

  it("fails closed when the stored active workspace was revoked", async () => {
    const store = loadRelationshipStore();
    store.activeWorkspaceByAccount[SANA_ACCOUNT_ID] = "00000000-0000-4000-8000-000000000999";
    saveRelationshipStore(store);

    await expect(staffContextService.getWorkspace(SANA_ACCOUNT_ID)).rejects.toMatchObject({
      code: "workspace-not-granted",
    });
    expect(await can(SANA_ACCOUNT_ID, "finance.view")).toBe(false);
  });
});

describe("teacher assignment class matching", () => {
  it("normalizes Class-prefixed labels and matches batch classes", () => {
    expect(normalizeClassLabel("Class 8-A")).toBe("8-A");
    expect(normalizeClassLabel("8-A")).toBe("8-A");

    const assignments = [{ gradeSection: { gradeLabel: "Class 8", sectionLabel: "A" } }];
    expect(assignmentsCoverClass(assignments, "8-A")).toBe(true);
    expect(assignmentsCoverClass(assignments, "Class 8-A")).toBe(true);
    expect(assignmentsCoverClass(assignments, "9-C")).toBe(false);
    expect(assignmentsCoverClass([], "8-A")).toBe(false);
  });

  it("resolves assignment sections through the staff service", async () => {
    /* Teaching assignments now have roleGrantId: null (non-login teacher
       records), so no staff workspace resolves active assignment sections. */
    await expect(staffContextService.getActiveAssignmentSections(RANIA_ACCOUNT_ID)).resolves.toEqual([]);
    await expect(staffContextService.getActiveAssignmentSections(SANA_ACCOUNT_ID)).resolves.toEqual([]);
  });
});
