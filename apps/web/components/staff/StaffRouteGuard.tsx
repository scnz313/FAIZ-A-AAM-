"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { canRole, workspacesForAction, type StaffAction } from "@/modules/services/staff-authorization";
import { roleLabel } from "@/modules/services/staff-context";
import { isStaffPortalPath, staffSubPathForPathname } from "@/lib/auth/portal-routes";

import styles from "./StaffRouteGuard.module.css";

/**
 * Route → required action. The marks-entry sub-route is matched separately
 * because it needs the result_entry_officer role (results.enter), not just
 * results.view. Sub-paths are expressed relative to the shared `/staff` root
 * so the same table covers `/staff/*`, `/administrator/*`, and `/principal/*`.
 */
const ROUTE_ACTIONS: ReadonlyArray<{ prefix: string; action: StaffAction }> = [
  { prefix: "/admissions", action: "admissions.view" },
  { prefix: "/careers", action: "careers.view" },
  { prefix: "/finance", action: "finance.view" },
  { prefix: "/results", action: "results.view" },
  { prefix: "/timetables", action: "timetable.view" },
  { prefix: "/academics", action: "timetable.manage" },
  { prefix: "/school", action: "academics.configure" },
  { prefix: "/notices", action: "content.view" },
  { prefix: "/content", action: "content.view" },
  { prefix: "/users", action: "users.manage" },
  { prefix: "/data", action: "users.manage" },
  { prefix: "/link-requests", action: "links.verify" },
  { prefix: "/guardians", action: "links.verify" },
  { prefix: "/deliveries", action: "deliveries.manage" },
  { prefix: "/audit", action: "audit.view" },
  { prefix: "/settings", action: "settings.manage" },
  { prefix: "/support", action: "support.view" },
  { prefix: "/facility", action: "facility.view" },
];

function actionForPath(pathname: string): StaffAction | null {
  const subPath = staffSubPathForPathname(pathname);
  if (subPath === "") return null;
  if (/^\/results\/[^/]+\/entry$/.test(subPath)) return "results.enter";
  const match = ROUTE_ACTIONS.find((entry) => subPath.startsWith(entry.prefix));
  return match?.action ?? null;
}

/**
 * Demo route guard for staff workspaces (I4): every staff route is checked
 * against the ACTIVE workspace role. When another granted workspace can do
 * the job, the denial offers a direct switch; otherwise it is a full denial
 * with the honest "UI visibility is not authorization" note. The backend
 * adapter remains the final authority.
 */
export function StaffRouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, errorMessage, summary, workspaces, switching, switchWorkspace, retry } = useStaffContext();
  const action = actionForPath(pathname);

  /* Fail closed: protected children never render before authorization
     resolves, and never while the context is unavailable (plan.md Phase 0). */
  if (action === null) return children;

  if (status === "loading" || summary === null) {
    return (
      <div className={styles.denial} role="status" aria-live="polite">
        <p className="eyebrow">Access control</p>
        <h1 className={styles.title}>Checking your workspace…</h1>
        <p className={styles.line}>Authorization is resolving before any workspace content is shown.</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={styles.denial} role="alert">
        <p className="eyebrow">Access control</p>
        <h1 className={styles.title}>Workspace unavailable</h1>
        <p className={styles.line}>{errorMessage ?? "The staff workspace could not be loaded."}</p>
        <div className={styles.actions}>
          <button type="button" className="button button--primary button--small" onClick={retry}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const allowed = summary.profileCode === null
    ? canRole(summary.role, action)
    : canAnyRole(summary.roles, action);
  if (allowed) return children;

  /* Profile accounts hold the exact profile bundle — no workspace switch is
     offered because granular switching is a legacy-only path. */
  if (summary.profileCode !== null) {
    return (
      <div className={styles.denial} role="alert">
        <p className="eyebrow">Access control</p>
        <h1 className={styles.title}>This profile cannot open this area</h1>
        <p className={styles.line}>
          <strong>{summary.profileLabel ?? summary.roleLabel}</strong> does not include{" "}
          <span className="num">{action}</span>. UI visibility is not authorization · the backend adapter remains the
          final authority.
        </p>
        <p className={styles.line}>
          No granted workspace on this account can perform this action · contact the school office administrator.
        </p>
      </div>
    );
  }

  const switchTargets = workspacesForAction(workspaces, action);
  const switchable = switchTargets.some((workspace) => workspace.role !== summary.role);

  return (
    <div className={styles.denial} role="alert">
      <p className="eyebrow">Access control</p>
      <h1 className={styles.title}>This profile cannot open this area</h1>
      <p className={styles.line}>
        <strong>{summary.profileLabel ?? summary.roleLabel}</strong> does not include{" "}
        <span className="num">{action}</span>. UI visibility is not authorization · the backend adapter remains the
        final authority.
      </p>

      {switchable ? (
        <>
          <p className={styles.line}>Switch to a granted workspace to continue:</p>
          <div className={styles.actions}>
            {switchTargets.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                className="button button--primary button--small"
                disabled={switching}
                onClick={() => void switchWorkspace(workspace.id)}
              >
                {switching ? "Switching…" : `Open as ${roleLabel(workspace.role)}`}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className={styles.line}>
          No granted workspace on this account can perform this action · contact the school office administrator.
        </p>
      )}
    </div>
  );
}

export default StaffRouteGuard;

/* Re-exported for tests that import the guard module to assert routing. */
export { isStaffPortalPath };
