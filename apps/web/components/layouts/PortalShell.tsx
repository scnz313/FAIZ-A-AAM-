"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { Crest } from "@/components/ui/Crest";
import { demoTodayLabel } from "@/modules/demo/clock";
import { gradeSectionLabel } from "@/modules/services/family-context";
import { identityService } from "@/modules/services/identity";
import { demoGuardianNotifications } from "@/modules/notifications/demo";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import type { NotificationItem } from "@/modules/notifications/demo";

import { NotificationBell } from "./NotificationBell";
import styles from "./PortalShell.module.css";

const NAV_LINKS: ReadonlyArray<{ href: string; label: string; exact?: boolean }> = [
  { href: "/portal", label: "Overview", exact: true },
  { href: "/portal/fees", label: "Fees" },
  { href: "/portal/results", label: "Results" },
  { href: "/portal/timetable", label: "Timetable" },
  { href: "/portal/notices", label: "Notices" },
  { href: "/portal/documents", label: "Documents" },
  { href: "/portal/profile", label: "Profile" },
  { href: "/portal/security", label: "Security" },
];

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
 * Family/student portal frame: chalk sidebar with the service-driven
 * linked-child switcher, demo-session banner, topbar eyebrow and folio rule.
 * The active child comes from FamilyContextProvider, so switching a child
 * updates the shell and every child-scoped page together. Below 1000px the
 * sidebar becomes a keyboard-operable drawer opened from the topbar Menu
 * button.
 */
export function PortalShell({ children, initialNotifications }: { children: ReactNode; initialNotifications?: NotificationItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, context, students, activeStudent, guardianName, switching, switchError, switchStudent, retry, announcement, errorMessage } =
    useFamilyContext();
  const [navOpen, setNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const supabaseMode = clientAdapterMode() === "supabase";
  /* Hydration-safe gate — see StaffShell. */
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

  /* Nav links are real <a> tags; a route change closes the drawer. */
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
      router.push("/sign-in");
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
        aria-label="Portal navigation panel"
        tabIndex={mounted && isMobile ? -1 : undefined}
        {...(mounted && isMobile && navOpen
          ? { role: "dialog", "aria-modal": "true" }
          : {})}
        inert={mounted && isMobile && !navOpen}
        onClick={handleNavClick}
      >
        <a className="facility-brand" href="/portal">
          <Crest size="sm" />
          <span className="facility-brand-copy">
            <strong>Faiz Aam</strong>
            <span className={`urdu ${styles.urdu}`} dir="rtl" lang="ur">
              فیض عام
            </span>
            <small>Parent portal</small>
          </span>
        </a>

        <div className={styles.childSwitcher}>
          <label htmlFor="portal-child">Linked child</label>
          {status === "loading" ? (
            <p className={styles.switcherNote} role="status" aria-live="polite">
              Loading linked children…
            </p>
          ) : status === "error" ? (
            <p className={styles.switcherNote} role="alert">
              {errorMessage}{" "}
              <button type="button" className="button button--quiet button--small" onClick={retry}>
                Try again
              </button>
            </p>
          ) : (
            <>
              <select
                id="portal-child"
                className="select"
                value={context?.activeStudentId ?? ""}
                onChange={(event) => void switchStudent(event.target.value)}
                disabled={switching}
                aria-describedby={switchError ? "portal-child-error" : undefined}
              >
                {students.map((item) => (
                  <option key={item.student.id} value={item.student.id}>
                    {item.student.displayName} · {gradeSectionLabel(item.gradeSection)} · {item.academicYear.label}
                  </option>
                ))}
              </select>
              {switchError ? (
                <p id="portal-child-error" className={styles.switcherError} role="alert">
                  {switchError}
                </p>
              ) : null}
            </>
          )}
        </div>

        <p className="section-label">Family services</p>

        <nav aria-label="Portal navigation">
          {NAV_LINKS.map((link) => {
            const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
            return (
              <a
                key={link.href}
                href={link.href}
                className={active ? "active" : undefined}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </a>
            );
          })}
        </nav>

        <div className="side-footer">
          <div className="signed-in">
            <span className="avatar" aria-hidden="true">
              <Crest size="sm" tone="chalk" />
            </span>
            <span className="signed-in-copy">
              <strong>{guardianName ?? "Guardian"}</strong>
              <small>{supabaseMode ? "Guardian account" : "Guardian · demo session"}</small>
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
          <a className="support-link" href="/portal/support">
            Support &amp; grievances
          </a>
        </div>
      </aside>

      <div className={`nav-scrim${navOpen ? " is-open" : ""}`} aria-hidden="true" onClick={() => setNavOpen(false)} />

      <div className="portal-main">
        <header className="portal-chrome">
          {!supabaseMode ? (
            <p className="alert-strip demo-strip">
              Demo session — sample family data. Your child&apos;s real records appear once guardian accounts are linked.
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
            <p className="eyebrow">Parent portal</p>
            <div className="topbar-actions">
              <NotificationBell items={initialNotifications ?? (supabaseMode ? [] : demoGuardianNotifications())} accountId={context?.accountId ?? undefined} />
              {!supabaseMode ? <span className="demo-badge">Demo data</span> : null}
              <a className="link-arrow" href="/portal/support">
                Get help ↗
              </a>
            </div>
          </div>

          <div className={`folio ${styles.folio}`}>
            <span>FAIZ AAM SECONDARY SCHOOL · PARENT PORTAL</span>
            <span className={styles.folioDate}>{supabaseMode ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()) : demoTodayLabel()}</span>
          </div>

          <div className={styles.contextStrip}>
            {status === "ready" && activeStudent ? (
              <p className={styles.contextLine}>
                <span className={styles.contextLabel}>Linked student</span>
                <strong>{activeStudent.student.displayName}</strong>
                <span>· {gradeSectionLabel(activeStudent.gradeSection)}</span>
                <span>· {activeStudent.academicYear.label}</span>
                <span className={`num ${styles.contextRef}`}>{activeStudent.student.ref}</span>
                {switching ? <span className={styles.contextPending}>· Updating…</span> : null}
              </p>
            ) : status === "error" ? (
              <p className={styles.contextLine} role="alert">
                <span className={styles.contextLabel}>Linked student</span>
                <span className={styles.contextError}>{errorMessage}</span>
              </p>
            ) : (
              <p className={styles.contextLine} role="status" aria-live="polite">
                <span className={styles.contextLabel}>Linked student</span>
                <span>Loading linked student…</span>
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

export default PortalShell;
