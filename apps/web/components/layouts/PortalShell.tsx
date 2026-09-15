"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent, ReactNode } from "react";

import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { Crest } from "@/components/ui/Crest";
import { gradeSectionLabel } from "@/modules/services/family-context";
import { identityService } from "@/modules/services/identity";
import { demoGuardianNotifications } from "@/modules/notifications/demo";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import type { NotificationItem } from "@/modules/notifications/demo";

import { NotificationBell } from "./NotificationBell";
import styles from "./PortalShell.module.css";

type NavItem = readonly [href: string, label: string, icon: string];
type NavGroup = { label?: string; items: readonly NavItem[] };

const NAV_GROUPS: readonly NavGroup[] = [
  { items: [["/portal", "Overview", "space_dashboard"]] },
  {
    label: "Your child",
    items: [
      ["/portal/fees", "Fees", "payments"],
      ["/portal/results", "Results", "workspace_premium"],
      ["/portal/timetable", "Timetable", "calendar_month"],
      ["/portal/notices", "Notices", "campaign"],
      ["/portal/documents", "Documents", "folder_open"],
    ],
  },
  {
    label: "Account",
    items: [
      ["/portal/profile", "Profile", "manage_accounts"],
      ["/portal/security", "Security", "shield"],
      ["/portal/support", "Support", "support_agent"],
      ["/portal/link-child", "Link a child", "add_link"],
    ],
  },
];

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
 * Family/student portal frame — V14 app-shell pattern.
 * Chalk sidebar with profile header, nav-group icons, and child switcher.
 * Dark sticky ctx-bar with school emblem and child menu dropdown.
 * Below 1023px the sidebar becomes a keyboard-operable drawer.
 */
export function PortalShell({
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
  const { status, context, students, activeStudent, guardianName, switching, switchError, switchStudent, retry, announcement, errorMessage } =
    useFamilyContext();
  const [navOpen, setNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [cpOpen, setCpOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const supabaseMode = clientAdapterMode() === "supabase";
  const [mounted, setMounted] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const childMenuRef = useRef<HTMLDivElement>(null);
  const childMenuButtonRef = useRef<HTMLButtonElement>(null);
  const childPopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

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
      const drawerEl = drawerRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        setNavOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawerEl) return;
      const focusable = Array.from(drawerEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
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

  /* Close child popup on outside click; Escape closes and returns focus to
     the trigger so keyboard users never lose their place. */
  useEffect(() => {
    if (!cpOpen) return;
    const handler = (event: globalThis.MouseEvent) => {
      if (childMenuRef.current && !childMenuRef.current.contains(event.target as Node)) {
        setCpOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCpOpen(false);
        childMenuButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [cpOpen]);

  /* APG menu-button pattern: focus moves into the menu when it opens, and
     arrow keys / Home / End move between the child options. */
  useEffect(() => {
    if (!cpOpen) return;
    const first = childPopRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, [cpOpen]);

  const handleChildMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(childPopRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (index + step + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

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

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const guardianInitial = guardianName?.charAt(0).toUpperCase() ?? "G";

  return (
    <div className="app-shell">
      <aside
        ref={drawerRef}
        id={DRAWER_ID}
        className={`side${navOpen ? " open" : ""}`}
        aria-label="Guardian portal navigation"
        tabIndex={mounted && isMobile ? -1 : undefined}
        {...(mounted && isMobile && navOpen
          ? { role: "dialog", "aria-modal": "true" }
          : {})}
        inert={mounted && isMobile && !navOpen}
        onClick={handleNavClick}
      >
        <div className="side-head">
          <div className="profile">
            <span className="avatar" aria-hidden="true">{guardianInitial}</span>
            <span className="who">
              <span className="nm">{guardianName ?? "Guardian"}</span>
              <span className="rl">Guardian</span>
            </span>
          </div>
        </div>

        <nav className="side-nav">
          {NAV_GROUPS.map((group, gi) => (
            <div className="nav-group" key={gi}>
              {group.label ? <div className="ng-label">{group.label}</div> : null}
              {group.items.map(([href, label, icon]) => {
                const exact = href === "/portal";
                const active = isActive(href, exact);
                return (
                  <Link
                    key={href}
                    href={href}
                    prefetch={false}
                    className={active ? "on" : undefined}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="msym" aria-hidden="true">{icon}</span>
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
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
        <header className="ctx-bar" aria-label="Portal context">
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
            <Link className="cb-school" href="/portal" prefetch={false} aria-label="Faiz Aam Secondary School · Portal home">
              <Crest size="xs" tone="chalk" />
              <span className="hide-s">Faiz Aam Secondary School</span>
            </Link>

            {status === "ready" && activeStudent ? (
              <div className="ctx-child">
                <div className="cc-meta hide-s">
                  <strong>{activeStudent.student.displayName}</strong>
                  {gradeSectionLabel(activeStudent.gradeSection)} · {activeStudent.academicYear.label} · <span className="num">{activeStudent.student.ref}</span>
                </div>
                <div className="child-menu" ref={childMenuRef}>
                  <button
                    ref={childMenuButtonRef}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={cpOpen}
                    onClick={() => setCpOpen((o) => !o)}
                  >
                    <span className="msym" aria-hidden="true">family_restroom</span>
                    Your children ({students.length})
                    <span className="msym" aria-hidden="true">expand_more</span>
                  </button>
                  {cpOpen ? (
                    <div
                      ref={childPopRef}
                      className="child-pop"
                      role="menu"
                      onKeyDown={handleChildMenuKeyDown}
                    >
                      <div className="cp-t">Switch active child</div>
                      {students.map((item) => (
                        <button
                          key={item.student.id}
                          className={`cp-item${context?.activeStudentId === item.student.id ? " on" : ""}`}
                          role="menuitem"
                          onClick={() => {
                            setCpOpen(false);
                            childMenuButtonRef.current?.focus();
                            if (item.student.id !== context?.activeStudentId) {
                              void switchStudent(item.student.id);
                            }
                          }}
                        >
                          <span className="ci-av" aria-hidden="true">
                            {item.student.displayName.charAt(0)}
                          </span>
                          <span className="ci-meta">
                            <span className="nm">{item.student.displayName}</span>
                            <span className="cl">
                              {gradeSectionLabel(item.gradeSection)} · {item.academicYear.label}
                            </span>
                          </span>
                          {context?.activeStudentId === item.student.id ? (
                            <span className="msym st-done" aria-hidden="true" style={{ marginLeft: "auto", fontSize: 18 }}>check</span>
                          ) : null}
                        </button>
                      ))}
                      <div style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 6 }}>
                        <Link
                          className="cp-item"
                          role="menuitem"
                          href="/portal/link-child"
                          prefetch={false}
                          onClick={() => setCpOpen(false)}
                          style={{ display: "flex", textDecoration: "none", color: "inherit" }}
                        >
                          <span className="ci-av" style={{ background: "var(--paper-deep)", color: "var(--muted)" }} aria-hidden="true">
                            <span className="msym" aria-hidden="true">add</span>
                          </span>
                          <span className="ci-meta">
                            <span className="nm">Link another child</span>
                            <span className="cl">Use the student reference the office issued</span>
                          </span>
                        </Link>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : status === "error" ? (
              <div className="ctx-child">
                <div className="cc-meta" role="alert">
                  <strong>Unable to load</strong>
                  {errorMessage}{" "}
                  <button type="button" className="btn btn-quiet btn-sm" style={{ color: "#D8CFBB" }} onClick={retry}>
                    Try again
                  </button>
                </div>
              </div>
            ) : (
              <div className="ctx-child">
                <div className="cc-meta" role="status" aria-live="polite">
                  <strong>Loading…</strong>
                  Loading linked children…
                </div>
              </div>
            )}
            <NotificationBell items={initialNotifications ?? (supabaseMode ? [] : demoGuardianNotifications())} accountId={context?.accountId ?? undefined} />
            {switching ? <span className={styles.contextPending}>Updating…</span> : null}
            {signOutError ? <span className={styles.contextError} role="alert">{signOutError}</span> : null}
          </div>
        </header>

        {!supabaseMode ? (
          <p className="alert-strip demo-strip">
            Demo session · sample family data. Your child&apos;s real records appear once guardian accounts are linked.
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

export default PortalShell;
