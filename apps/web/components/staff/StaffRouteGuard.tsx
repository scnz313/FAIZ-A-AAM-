"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canRole, workspacesForAction, type StaffAction } from "@/modules/services/staff-authorization";
import { roleLabel } from "@/modules/services/staff-context";

import styles from "./StaffRouteGuard.module.css";

/**
 * Route → required action. The marks-entry sub-route is matched separately
 * because it needs the teacher role (results.enter), not just results.view.
 * The isolated /staff/facility demonstrator stays ungated.
 */
const ROUTE_ACTIONS: ReadonlyArray<{ prefix: string; action: StaffAction }> = [
  { prefix: "/staff/admissions", action: "admissions.view" },
  { prefix: "/staff/careers", action: "careers.view" },
  { prefix: "/staff/finance", action: "finance.view" },
  { prefix: "/staff/results", action: "results.view" },
  { prefix: "/staff/timetables", action: "timetable.view" },
  { prefix: "/staff/notices", action: "content.view" },
  { prefix: "/staff/content", action: "content.view" },
  { prefix: "/staff/users", action: "users.manage" },
  { prefix: "/staff/link-requests", action: "links.verify" },
  { prefix: "/staff/audit", action: "audit.view" },
  { prefix: "/staff/settings", action: "settings.manage" },
  { prefix: "/staff/support", action: "support.view" },
];

function actionForPath(pathname: string): StaffAction | null {
  if (pathname === "/staff" || pathname.startsWith("/staff/facility")) return null;
  if (/^\/staff\/results\/[^/]+\/entry$/.test(pathname)) return "results.enter";
  const match = ROUTE_ACTIONS.find((entry) => pathname.startsWith(entry.prefix));
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

  const allowed = canRole(summary.role, action);
  if (allowed) return children;

  const switchTargets = workspacesForAction(workspaces, action);
  const switchable = switchTargets.some((workspace) => workspace.role !== summary.role);

  return (
    <div className={styles.denial} role="alert">
      <p className="eyebrow">Access control</p>
      <h1 className={styles.title}>This workspace cannot open this area</h1>
      <p className={styles.line}>
        <strong>{summary.roleLabel}</strong> does not include <span className="num">{action}</span>. UI visibility is
        not authorization — the backend adapter remains the final authority.
      </p>

      {switchable ? (
        <>
          <p className={styles.line}>
            Switch to a granted workspace to continue:
          </p>
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
          No granted workspace on this account can perform this action — contact the school office administrator.
        </p>
      )}
    </div>
  );
}

export default StaffRouteGuard;
