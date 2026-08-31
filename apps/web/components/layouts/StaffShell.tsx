"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { Crest } from "@/components/ui/Crest";
import { demoTodayLabel } from "@/modules/demo/clock";
import { identityService } from "@/modules/services/identity";
import { roleLabel } from "@/modules/services/staff-context";
import { canRole, type StaffAction } from "@/modules/services/staff-authorization";
import { demoStaffNotifications } from "@/modules/notifications/demo";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import type { NotificationItem } from "@/modules/notifications/demo";

import { NotificationBell } from "./NotificationBell";
import styles from "./StaffShell.module.css";

type NavLink = { href: string; label: string; exact?: boolean; action: StaffAction };
type NavGroup = { label: string; links: ReadonlyArray<NavLink> };

const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    label: "Main",
    links: [
      { href: "/staff", label: "Home", exact: true, action: "home.view" },
      { href: "/staff/admissions", label: "Admissions", action: "admissions.view" },
      { href: "/staff/careers", label: "Careers", action: "careers.view" },
      { href: "/staff/finance", label: "Finance", action: "finance.view" },
      { href: "/staff/results", label: "Results", action: "results.view" },
      { href: "/staff/timetables", label: "Timetables", action: "timetable.view" },
      { href: "/staff/documents", label: "Documents", action: "documents.view" },
    ],
  },
  {
    label: "Publishing",
    links: [
      { href: "/staff/notices", label: "Notices", action: "content.view" },
      { href: "/staff/content", label: "Content", action: "content.view" },
    ],
  },
  {
    label: "Administration",
    links: [
      { href: "/staff/users", label: "Users", action: "users.manage" },
      { href: "/staff/link-requests", label: "Link requests", action: "links.verify" },
      { href: "/staff/audit", label: "Audit", action: "audit.view" },
      { href: "/staff/settings", label: "Settings", action: "settings.manage" },
      { href: "/staff/support", label: "Support", action: "support.view" },
    ],
  },
];

const isActive = (pathname: string, link: NavLink) =>
  link.exact ? pathname === link.href : pathname.startsWith(link.href);

/* Below this width the sidebar becomes an off-canvas drawer. */
const DRAWER_BREAKPOINT = "(max-width: 1000px)";
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
export function StaffShell({ children, initialNotifications }: { children: ReactNode; initialNotifications?: NotificationItem[] }) {
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

  return (
    <div className="facility-shell">
      <aside
        ref={drawerRef}
        id={DRAWER_ID}
        className={`side-nav${navOpen ? " is-open" : ""}`}
        aria-label="Staff navigation panel"
        tabIndex={mounted && isMobile ? -1 : undefined}
        {...(mounted && isMobile && navOpen
          ? { role: "dialog", "aria-modal": "true" }
          : {})}
        inert={mounted && isMobile && !navOpen}
        onClick={handleNavClick}
      >
        <Link className="facility-brand" href="/staff" prefetch={false}>
          <Crest size="sm" />
          <span className="facility-brand-copy">
            <strong>Faiz Aam</strong>
            <span className={`urdu ${styles.urdu}`} dir="rtl" lang="ur">
              فیض عام
            </span>
            <small>Staff workspace</small>
          </span>
        </Link>

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
                {identity.displayName} — {identity.summaryLabel}
              </option>
            ))}
          </select>
          <p id="staff-identity-note" className={styles.identityNote}>
            Demo stand-in for staff sign-in — the backend issues real sessions.
          </p>
          {switchError ? (
            <p className={styles.switcherError} role="alert">
              {switchError}
            </p>
          ) : null}
        </div>

        {status === "ready" && summary ? (
          <div className={styles.workspaceSwitcher}>
            <label htmlFor="staff-workspace">Workspace</label>
            {workspaces.length > 1 ? (
              <>
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
            ) : (
              <p className={styles.workspaceNote}>
                {summary.roleLabel}
                {summary.assignmentLabel ? ` · ${summary.assignmentLabel}` : ""}
              </p>
            )}
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

        {NAV_GROUPS.map((group) => {
          const visibleLinks = group.links.filter((link) => canRole(activeRole, link.action));
          if (visibleLinks.length === 0) return null;
          return (
            <div className={styles.group} key={group.label}>
              <p className="section-label">{group.label}</p>
              <nav aria-label={`${group.label} navigation`}>
                {visibleLinks.map((link) => {
                  const active = isActive(pathname, link);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      prefetch={false}
                      className={active ? "active" : undefined}
                      aria-current={active ? "page" : undefined}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          );
        })}

        <div className="side-footer">
          <div className="signed-in">
            <span className="avatar" aria-hidden="true">
              <Crest size="sm" tone="chalk" />
            </span>
            <span className="signed-in-copy">
              <strong>{status === "ready" && summary ? summary.displayName : "Staff member"}</strong>
              <small>{status === "ready" && summary ? `${summary.roleLabel}${supabaseMode ? "" : " · demo session"}` : supabaseMode ? "Staff account" : "Demo session"}</small>
            </span>
            <button
              type="button"
              className="button button--small button--quiet"
              onClick={() => void handleSignOut()}
              title={supabaseMode ? "Sign out of this device" : "Back to sign in — demo sessions are not real"}
              disabled={signingOut}
            >
              {signingOut ? "Signing out…" : "Sign out"} {!supabaseMode ? <span className="num">(demo)</span> : null}
            </button>
          </div>
          {signOutError ? <p className={styles.switcherError} role="alert">{signOutError}</p> : null}
        </div>
      </aside>

      <div className={`nav-scrim${navOpen ? " is-open" : ""}`} aria-hidden="true" onClick={() => setNavOpen(false)} />

      <div className="portal-main">
        <header className="portal-chrome">
          {!supabaseMode ? (
            <p className="alert-strip demo-strip">
              Demo session — all data shown is fictional concept data. Real records appear once the backend and staff
              accounts are connected.
            </p>
          ) : null}

          <div className="portal-topbar">
            <button
              ref={menuButtonRef}
              type="button"
              className="shell-menu-button"
              aria-expanded={navOpen}
              aria-controls={DRAWER_ID}
              onClick={() => setNavOpen((open) => !open)}
            >
              Menu
            </button>
            <p className="eyebrow">Staff workspace</p>
            <div className="topbar-actions">
              <NotificationBell items={initialNotifications ?? (supabaseMode ? [] : demoStaffNotifications())} accountId={identityId ?? undefined} />
              {!supabaseMode ? <span className="demo-badge">Demo data</span> : null}
            </div>
          </div>

          <div className={`folio ${styles.folio}`}>
            <span>FAIZ AAM SECONDARY SCHOOL · STAFF WORKSPACE</span>
            <span className={styles.folioDate}>{supabaseMode ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()) : demoTodayLabel()}</span>
          </div>

          <div className={styles.contextStrip}>
            {status === "ready" && summary ? (
              <p className={styles.contextLine}>
                <span className={styles.contextLabel}>Workspace</span>
                <strong>{summary.roleLabel}</strong>
                <span>· {summary.academicYearLabel}</span>
                {summary.assignmentLabel ? <span>· {summary.assignmentLabel}</span> : null}
                {switching ? <span className={styles.contextPending}>· Updating…</span> : null}
              </p>
            ) : status === "error" ? (
              <p className={styles.contextLine} role="alert">
                <span className={styles.contextLabel}>Workspace</span>
                <span className={styles.contextError}>{errorMessage}</span>
              </p>
            ) : (
              <p className={styles.contextLine} role="status" aria-live="polite">
                <span className={styles.contextLabel}>Workspace</span>
                <span>Loading workspace…</span>
              </p>
            )}
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
        </header>

        <main id="main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}

export default StaffShell;
