"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { Crest } from "@/components/ui/Crest";
import { identityService } from "@/modules/services/identity";
import { roleLabel } from "@/modules/services/staff-context";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { type StaffAction } from "@/modules/services/staff-authorization";
import { demoStaffNotifications } from "@/modules/notifications/demo";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import type { NotificationItem } from "@/modules/notifications/demo";
import { canonicalStaffUrl, portalPrefixForProfile, staffSubPathForPathname } from "@/lib/auth/portal-routes";

import { NotificationBell } from "./NotificationBell";
import styles from "./StaffShell.module.css";

type NavLink = { subPath: string; label: string; icon: string; exact?: boolean; action: StaffAction };
type NavGroup = { label?: string; links: ReadonlyArray<NavLink> };

const OVERVIEW: NavLink = { subPath: "", label: "Overview", icon: "space_dashboard", exact: true, action: "home.view" };
const WORK_LINKS: ReadonlyArray<NavLink> = [
  { subPath: "/admissions", label: "Admissions", icon: "edit_document", action: "admissions.view" },
  { subPath: "/careers", label: "Careers", icon: "work", action: "careers.view" },
  { subPath: "/finance", label: "Finance", icon: "payments", action: "finance.view" },
  { subPath: "/results", label: "Results", icon: "grading", action: "results.view" },
];
const CONTENT_LINKS: ReadonlyArray<NavLink> = [
  { subPath: "/notices", label: "Notices", icon: "campaign", action: "content.view" },
  { subPath: "/content", label: "Content", icon: "article", action: "content.view" },
];
const RECORD_LINKS: ReadonlyArray<NavLink> = [
  { subPath: "/documents", label: "Documents", icon: "folder_open", action: "documents.view" },
  { subPath: "/users", label: "Users", icon: "group", action: "users.manage" },
  { subPath: "/link-requests", label: "Guardian links", icon: "link", action: "links.verify" },
  { subPath: "/guardians", label: "Guardians", icon: "family_restroom", action: "links.verify" },
];
const DATA_LINKS: ReadonlyArray<NavLink> = [
  { subPath: "/data/imports", label: "Imports", icon: "upload", action: "users.manage" },
  { subPath: "/data/exports", label: "Exports", icon: "download", action: "users.manage" },
  { subPath: "/settings", label: "Settings", icon: "tune", action: "settings.manage" },
  { subPath: "/audit", label: "Audit", icon: "history", action: "audit.view" },
];
const ACADEMIC_LINKS: ReadonlyArray<NavLink> = [
  { subPath: "/timetables", label: "Timetables", icon: "calendar_month", action: "timetable.view" },
  { subPath: "/academics/teachers", label: "Teaching records", icon: "person", action: "timetable.manage" },
];
const OFFICE_LINKS: ReadonlyArray<NavLink> = [
  { subPath: "/documents", label: "Documents", icon: "folder_open", action: "documents.view" },
  { subPath: "/support", label: "Support", icon: "support_agent", action: "support.view" },
];

const ADMIN_NAV_GROUPS: ReadonlyArray<NavGroup> = [
  { links: [OVERVIEW] },
  { label: "Work", links: WORK_LINKS },
  { label: "Content", links: CONTENT_LINKS },
  { label: "Records", links: RECORD_LINKS },
  { label: "Data & control", links: DATA_LINKS },
];

const PRINCIPAL_NAV_GROUPS: ReadonlyArray<NavGroup> = [
  { links: [OVERVIEW] },
  { label: "Work", links: WORK_LINKS },
  { label: "Academics", links: ACADEMIC_LINKS },
  { label: "Content", links: CONTENT_LINKS },
  { label: "Office", links: OFFICE_LINKS },
];

const LEGACY_NAV_GROUPS: ReadonlyArray<NavGroup> = [
  { links: [OVERVIEW] },
  { label: "Work", links: [...WORK_LINKS, ...ACADEMIC_LINKS] },
  { label: "Publishing", links: CONTENT_LINKS },
  { label: "Administration", links: [...RECORD_LINKS, ...DATA_LINKS, ...OFFICE_LINKS.filter((link) => link.subPath === "/support")] },
];

function isActive(pathname: string, link: NavLink, profileCode: ReturnType<typeof portalPrefixForProfile>): boolean {
  const currentSubPath = staffSubPathForPathname(pathname);
  if (link.exact) return currentSubPath === link.subPath;
  if (link.subPath === "") return false;
  return currentSubPath.startsWith(link.subPath);
}

function resolveHref(link: NavLink, profileCode: ReturnType<typeof portalPrefixForProfile>): string {
  return canonicalStaffUrl(profileCode ?? null, link.subPath);
}

/* Below this width the sidebar becomes an off-canvas drawer. */
const DRAWER_BREAKPOINT = "(max-width: 1023px)";
const DRAWER_ID = "shell-nav";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Staff workspace frame: chalk sidebar grouped by area (main operations,
 * publishing, administration), a demo-session banner, a topbar eyebrow and
 * folio rule. Identity and the active role/assignment/year come from
 * StaffContextProvider, so multi-role accounts can switch workspace and the
 * shell context updates together. Pages render their own h1 below.
 * Below 1000px the sidebar becomes a keyboard-operable drawer opened from
 * the topbar Menu button.
 */
export function StaffShell({
  children,
  initialNotifications,
  developmentAuth = false,
}: {
  children: ReactNode;
  initialNotifications?: NotificationItem[];
  developmentAuth?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    status,
    summary,
    workspaces,
    identityId,
    demoIdentities,
    switching,
    switchError,
    switchWorkspace,
    switchIdentity,
    retry,
    errorMessage,
    announcement,
  } = useStaffContext();
  const activeRole = summary?.role ?? "";
  const navigationRoles = summary?.profileCode === null ? (activeRole ? [activeRole] : []) : summary?.roles ?? [];
  const profileCode = summary?.profileCode ?? null;
  const portalPrefix = portalPrefixForProfile(profileCode);
  const navGroups = profileCode === "administrator"
    ? ADMIN_NAV_GROUPS
    : profileCode === "principal"
      ? PRINCIPAL_NAV_GROUPS
      : LEGACY_NAV_GROUPS;
  const homeHref = canonicalStaffUrl(profileCode, "");
  const [navOpen, setNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const supabaseMode = clientAdapterMode() === "supabase";
  /* Hydration-safe gate: attribute-bearing drawer state (inert, tabIndex,
     role) stays absent from the SSR DOM and appears only after mount. */
  const [mounted, setMounted] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  /* Track the drawer layout; leaving it forces the drawer closed. */
  useEffect(() => {
    const query = window.matchMedia(DRAWER_BREAKPOINT);
    const sync = () => {
      setIsMobile(query.matches);
      if (!query.matches) setNavOpen(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  /* A route change closes the drawer. */
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  /* While open: lock body scroll, focus the first nav link (not the
     panel itself, so Shift+Tab wraps inside the trap), trap Tab, close
     on Escape. Focus returns to the Menu button on close. */
  useEffect(() => {
    if (!isMobile || !navOpen) return;

    const menuButton = menuButtonRef.current;
    const drawer = drawerRef.current;
    const firstLink = drawer
      ?.querySelector("nav")
      ?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstLink ?? drawer)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      const drawer = drawerRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        setNavOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      menuButton?.focus();
    };
  }, [isMobile, navOpen]);

  /* A link click inside the drawer closes it even when the route is unchanged. */
  const handleNavClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a")) setNavOpen(false);
  };

  async function handleSignOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      if (supabaseMode) {
        const response = await fetch("/api/auth/sign-out", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "local" }),
        });
        if (!response.ok) throw new Error("sign out failed");
      } else {
        await identityService.clear();
      }
      router.push("/sign-in/staff");
      router.refresh();
    } catch {
      setSignOutError("Sign out could not be completed. Check your connection and try again.");
    } finally {
      setSigningOut(false);
    }
  }

  const staffInitial = (status === "ready" && summary ? summary.displayName : "S").charAt(0).toUpperCase();
  const roleLabelStr = status === "ready" && summary
    ? `${summary.profileLabel ?? summary.roleLabel}${supabaseMode ? "" : " · demo session"}`
    : supabaseMode ? "Staff account" : "Demo session";

  return (
    <div className="app-shell">
      <aside
        ref={drawerRef}
        id={DRAWER_ID}
        className={`side${navOpen ? " open" : ""}`}
        aria-label="Staff navigation panel"
        tabIndex={mounted && isMobile ? -1 : undefined}
        {...(mounted && isMobile && navOpen
          ? { role: "dialog", "aria-modal": "true" }
          : {})}
        inert={mounted && isMobile && !navOpen}
        onClick={handleNavClick}
      >
        <div className="side-head">
          <div className="profile">
            <span className="avatar" aria-hidden="true">{staffInitial}</span>
            <span className="who">
              <span className="nm">{status === "ready" && summary ? summary.displayName : "Staff member"}</span>
              <span className="rl">{portalPrefix === "/administrator" ? "Administrator" : portalPrefix === "/principal" ? "Principal" : "Staff"}</span>
            </span>
          </div>
        </div>

        <nav className="side-nav">
          {!supabaseMode ? (
            <div className={styles.identitySwitcher}>
              <label htmlFor="staff-identity">Demo identity</label>
              <select
                id="staff-identity"
                className="select"
                value={identityId ?? ""}
                onChange={(event) => void switchIdentity(event.target.value)}
                disabled={switching}
                aria-describedby="staff-identity-note"
              >
                {demoIdentities.map((identity) => (
                  <option key={identity.accountId} value={identity.accountId}>
                    {identity.displayName} · {identity.summaryLabel}
                  </option>
                ))}
              </select>
              <p id="staff-identity-note" className={styles.identityNote}>
                Demo stand-in for staff sign-in · the backend issues real sessions.
              </p>
              {switchError ? (
                <p className={styles.switcherError} role="alert">
                  {switchError}
                </p>
              ) : null}
            </div>
          ) : null}

          {status === "ready" && summary ? (
            <div className={styles.workspaceSwitcher}>
              {summary.profileCode === null && workspaces.length > 1 ? (
                <>
                  <label htmlFor="staff-workspace">Access profile</label>
                  <select
                    id="staff-workspace"
                    className="select"
                    value={summary.activeRoleGrantId}
                    onChange={(event) => void switchWorkspace(event.target.value)}
                    disabled={switching}
                    aria-describedby={switchError ? "staff-workspace-error" : undefined}
                  >
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {roleLabel(workspace.role)}
                      </option>
                    ))}
                  </select>
                  {switchError ? (
                    <p id="staff-workspace-error" className={styles.switcherError} role="alert">
                      {switchError}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : status === "error" ? (
            <div className={styles.workspaceSwitcher}>
              <p className={styles.switcherError} role="alert">
                {errorMessage}{" "}
                <button type="button" className="button button--quiet button--small" onClick={retry}>
                  Try again
                </button>
              </p>
            </div>
          ) : (
            <div className={styles.workspaceSwitcher}>
              <p className={styles.workspaceNote} role="status" aria-live="polite">
                Loading workspace…
              </p>
            </div>
          )}

          {navGroups.map((group, index) => {
            const visibleLinks = group.links.filter((link) => canAnyRole(navigationRoles, link.action));
            if (visibleLinks.length === 0) return null;
            return (
              <div className="nav-group" key={group.label ?? `primary-${index}`}>
                {group.label ? <div className="ng-label">{group.label}</div> : null}
                {visibleLinks.map((link) => {
                  const active = isActive(pathname, link, portalPrefix);
                  const href = resolveHref(link, portalPrefix);
                  return (
                    <Link
                      key={link.subPath}
                      href={href}
                      prefetch={false}
                      className={active ? "on" : undefined}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="msym" aria-hidden="true">{link.icon}</span>
                      <span>{link.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="side-foot">
          <span>Faiz Aam · Bandipora</span>
          <button
            type="button"
            className="btn btn-quiet btn-sm no-print"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            title={supabaseMode ? "Sign out of this device" : "Back to sign in · demo sessions are not real"}
          >
            <span className="msym" aria-hidden="true">logout</span>
            {signingOut ? "…" : "Exit"}
          </button>
        </div>
      </aside>

      {navOpen ? (
        <div
          className="nav-scrim is-open"
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <div className="app-main">
        <header className="ctx-bar" aria-label="Staff context">
          <div className="wrap-x">
            <button
              ref={menuButtonRef}
              type="button"
              className="ctx-burger"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              aria-controls={DRAWER_ID}
              onClick={() => setNavOpen((open) => !open)}
            >
              <span className="msym" aria-hidden="true">menu</span>
            </button>
            <Link className="cb-school" href={homeHref} prefetch={false} aria-label="Faiz Aam Secondary School · Staff home">
              <Crest size="xs" tone="chalk" />
              <span className="hide-s">Faiz Aam Secondary School</span>
            </Link>
            <div className="ctx-child">
              <div className="cc-meta hide-s">
                <strong>{roleLabelStr}</strong>
                {status === "ready" && summary ? `${summary.academicYearLabel}${summary.assignmentLabel ? ` · ${summary.assignmentLabel}` : ""}` : ""}
                {switching ? " · Updating…" : ""}
              </div>
              <NotificationBell items={initialNotifications ?? (supabaseMode ? [] : demoStaffNotifications())} accountId={identityId ?? undefined} audience="staff" />
              {developmentAuth ? (
                <Link className="link-arrow" href="/sign-in/staff" prefetch={false} style={{ color: "#D8CFBB" }}>
                  Switch account
                </Link>
              ) : null}
              {signOutError ? <span className={styles.switcherError} role="alert">{signOutError}</span> : null}
            </div>
          </div>
        </header>

        {!supabaseMode ? (
          <p className="alert-strip demo-strip">
            Demo session · all data shown is fictional concept data. Real records appear once the backend and staff
            accounts are connected.
          </p>
        ) : null}

        <div className="page">
          <main id="main" tabIndex={-1}>{children}</main>
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    </div>
  );
}

export default StaffShell;
