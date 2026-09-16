/**
 * Demo staff authorization evaluator (I4): which staff actions a role (or a
 * workspace/account) may perform. This is the UI-facing projection of the
 * role-plus-scope model — the backend adapter is the final authority and
 * this module exists so navigation, route guards, and action controls agree
 * with the service contract. UI visibility is never authorization.
 */

import { staffContextService } from "@/modules/services/staff-context";

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export type StaffAction =
  | "home.view"
  | "admissions.view"
  | "admissions.review"
  | "admissions.approve"
  | "careers.view"
  | "careers.review"
  | "careers.approve"
  | "documents.view"
  | "finance.view"
  | "finance.operate"
  | "finance.approve"
  | "results.view"
  | "results.enter"
  | "results.approve"
  | "results.publish"
  | "academics.configure"
  | "timetable.view"
  | "timetable.manage"
  | "content.view"
  | "content.draft"
  | "content.publish"
  | "links.verify"
  | "users.manage"
  | "audit.view"
  | "settings.manage"
  | "support.view"
  | "support.respond"
  | "facility.view"
  | "facility.manage";

/**
 * Canonical Phase-1 grant model: every role gets exactly its maker/checker
 * actions. Data-entry/review roles (`*.review`, `*.operate`, `*.draft`,
 * `*.enter`) never carry the approval of the same stage, and the system
 * administrator holds configuration and access grants only — no business
 * approvals. `links.verify` is limited to the identity/support grant
 * (support_officer) and system_administrator, not every staff role.
 */
const ROLE_ACTIONS: Record<string, ReadonlySet<StaffAction>> = {
  /* Content: editor drafts, publisher reviews and publishes. */
  content_editor: new Set(["home.view", "content.view", "content.draft"]),
  content_publisher: new Set(["home.view", "content.view", "content.publish"]),
  /* Admissions: officer reviews, approver decides. */
  admissions_officer: new Set(["home.view", "admissions.view", "admissions.review", "documents.view"]),
  admissions_approver: new Set(["home.view", "admissions.view", "admissions.approve", "documents.view"]),
  /* Finance: officer operates, approver approves. */
  finance_officer: new Set(["home.view", "finance.view", "finance.operate", "documents.view"]),
  finance_approver: new Set(["home.view", "finance.view", "finance.approve", "documents.view"]),
  /* Careers: reviewer scores, approver advances/rejects/offers. */
  hr_reviewer: new Set(["home.view", "careers.view", "careers.review", "documents.view"]),
  hr_approver: new Set(["home.view", "careers.view", "careers.approve", "documents.view"]),
  /* Results: result_entry_officer enters/import marks (Principal), reviewer
     moderates, publisher releases. Teachers are non-login school records and
     hold no login role or workspace. */
  result_entry_officer: new Set(["home.view", "results.view", "results.enter", "documents.view"]),
  exam_reviewer: new Set(["home.view", "results.view", "results.approve", "documents.view"]),
  result_publisher: new Set(["home.view", "results.view", "results.publish", "documents.view"]),
  /* Timetable: manager creates, validates, publishes, overrides, and builds
     the school structure (classes, subjects, exam terms) it schedules. */
  timetable_manager: new Set(["home.view", "timetable.view", "timetable.manage", "academics.configure"]),
  /* Support: officer responds. Guardian-link activation/restriction/revocation
     is an Administrator-only decision; support_officer no longer carries
     links.verify. */
  support_officer: new Set(["home.view", "support.view", "support.respond", "facility.view"]),
  /* Auditor: read-only audit and owning-record document evidence permitted by database policy. */
  auditor: new Set(["home.view", "audit.view", "documents.view"]),
  /* System administrator: configuration and access grants ONLY. */
  system_administrator: new Set(["home.view", "users.manage", "settings.manage", "audit.view", "links.verify", "facility.view", "facility.manage", "academics.configure"]),
};

/** Sync check: can a role perform an action? */
export function canRole(role: string, action: StaffAction): boolean {
  return ROLE_ACTIONS[role]?.has(action) ?? false;
}

/** Sync check for a granted workspace record. */
export function canWorkspace(role: string | undefined, action: StaffAction): boolean {
  return role === undefined ? false : canRole(role, action);
}

/**
 * The granted workspaces that CAN perform an action — used by route guards
 * to offer a direct workspace switch instead of a dead end. The grant id is
 * preserved so the switch can select it.
 */
export function workspacesForAction(
  workspaces: ReadonlyArray<{ id: string; role: string }>,
  action: StaffAction,
): Array<{ id: string; role: string }> {
  return workspaces.filter((workspace) => canRole(workspace.role, action));
}

/**
 * Async check against the ACCOUNT's active workspace (the demo adapter's
 * stand-in for server authorization of the current session).
 */
export async function can(accountId: string, action: StaffAction): Promise<boolean> {
  try {
    const workspace = await staffContextService.getWorkspace(accountId);
    return canRole(workspace.activeRole, action);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Demo staff identities (staff sign-in arrives with the backend)      */
/* ------------------------------------------------------------------ */

export type DemoStaffIdentity = {
  accountId: string;
  displayName: string;
  /** Short role summary for the identity picker, e.g. "Finance · Results · Admissions". */
  summaryLabel: string;
};

/**
 * The fictional staff accounts the demo shell can switch between, standing
 * in for staff sign-in. Two persistent personas map to the canonical
 * access profiles:
 * - Aisha Lone — Administrator (account management + final approvals).
 * - Rania Mir — Principal (daily operations + result entry).
 * Legacy multi-role personas remain available for negative-scope tests but
 * are not shown in the primary picker. Teachers are non-login school records
 * and have no login persona, workspace, or role in the picker.
 */
export const DEMO_STAFF_IDENTITIES: ReadonlyArray<DemoStaffIdentity> = [
  {
    accountId: "00000000-0000-4000-8000-000000000204",
    displayName: "Aisha Lone",
    summaryLabel: "Administrator",
  },
  {
    accountId: "00000000-0000-4000-8000-000000000205",
    displayName: "Rania Mir",
    summaryLabel: "Principal",
  },
  {
    accountId: "00000000-0000-4000-8000-000000000203",
    displayName: "Sana Wani",
    summaryLabel: "Legacy multi-role (tests)",
  },
];

/**
 * Normalized class/section comparison: "Class 8-A" and "8-A" both become
 * "8-A" so teacher assignments can be matched against batch class names.
 */
export function normalizeClassLabel(label: string): string {
  return label.replace(/^Class\s+/i, "").trim();
}

/**
 * Whether a teacher's active assignments cover a batch's class. Pass the
 * assignment grade sections as `gradeLabel`/`sectionLabel` pairs.
 */
export function assignmentsCoverClass(
  assignments: ReadonlyArray<{ gradeSection: { gradeLabel: string; sectionLabel: string } | null }>,
  className: string,
): boolean {
  const target = normalizeClassLabel(className);
  return assignments.some(
    (assignment) =>
      assignment.gradeSection !== null &&
      normalizeClassLabel(`${assignment.gradeSection.gradeLabel}-${assignment.gradeSection.sectionLabel}`) === target,
  );
}
