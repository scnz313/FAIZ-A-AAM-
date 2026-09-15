"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Crest } from "@/components/ui/Crest";

type PublicHeaderProps = {
  /** "dark" renders chalk text on transparent for use over the ink hero. */
  tone?: "light" | "dark";
};

const NAV_LINKS = [
  { label: "About", href: "/about" },
  { label: "Academics", href: "/academics" },
  { label: "Admissions", href: "/admissions" },
  { label: "School life", href: "/school-life" },
  { label: "Notices", href: "/notices" },
  { label: "Careers", href: "/careers" },
  { label: "Contact", href: "/contact" },
] as const;

/* Below this width the primary nav collapses into the mobile menu. */
const MENU_BREAKPOINT = "(max-width: 1120px)";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * V15 public header — ribbon (unit + disclosure/notices/sign-in) above
 * site-head (brand + nav + CTAs). The active route keeps the saffron
 * underline via aria-current="page"; the underline shows statically
 * (no slide/scale animation).
 */
export function PublicHeader({ tone = "light" }: PublicHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const dark = tone === "dark";

  /* Track the mobile menu layout; leaving it forces the menu closed. */
  useEffect(() => {
    const query = window.matchMedia(MENU_BREAKPOINT);
    const sync = () => {
      setIsMobile(query.matches);
      if (!query.matches) setMenuOpen(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  /* A route change closes the menu. */
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  /* While open: lock body scroll, focus the first nav link (so Shift+Tab
     wraps inside the trap), trap Tab, close on Escape. Focus returns to
     the toggle on close. */
  useEffect(() => {
    if (!isMobile || !menuOpen) return;

    const menuButton = menuButtonRef.current;
    const nav = navRef.current;
    nav?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab" || !nav) return;
      const focusable = Array.from(nav.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
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
  }, [isMobile, menuOpen]);

  /* A link click inside the menu closes it even when the route is unchanged. */
  const handleNavClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a")) setMenuOpen(false);
  };

  return (
    <header className={`public-header ${dark ? "public-header--dark" : "public-header--light"}`}>
      {/* V14 ribbon — ink background, unit name + quick links */}
      {!dark && (
        <div className="public-utility public-utility--light">
          <div className="wrap">
            <span className="ribbon-unit">
              <span className="msym" aria-hidden="true">verified</span>
              <span className="hide-s">A Unit of Darul Uloom Raheemiyyah</span>
              <span className="dot-sep hide-s" aria-hidden="true" />
              <span>Bandipora, Kashmir</span>
            </span>
            <span className="ribbon-links">
              <Link href="/disclosure" prefetch={false}>
                <span className="msym" aria-hidden="true">account_balance</span>
                Disclosure
              </Link>
              <Link href="/notices" prefetch={false}>
                <span className="msym" aria-hidden="true">campaign</span>
                Notices
              </Link>
              <Link href="/sign-in" prefetch={false}>
                <span className="msym" aria-hidden="true">login</span>
                Sign in
              </Link>
            </span>
          </div>
        </div>
      )}

      {/* V15 site-head — paper background, brand + nav + CTAs */}
      <div className="public-header-main">
        <div className="wrap">
          <Link className="brand" href="/" prefetch={false} aria-label="Faiz E Aam Secondary School home">
            <Crest size="md" tone={dark ? "chalk" : "ink"} />
            <span className="brand-copy">
              <span className="brand-name">Faiz E Aam Secondary School</span>
              <span className="brand-sub">Bandipora, Kashmir</span>
            </span>
          </Link>

          <nav aria-label="Primary navigation" className="main-nav">
            {NAV_LINKS.map((link) => {
              const active =
                pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.label}
                  href={link.href}
                  prefetch={false}
                  className={active ? "on" : undefined}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="head-cta">
            <Link className="btn btn-ghost btn-sm" href="/sign-in" prefetch={false}>
              <span className="msym" aria-hidden="true">lock_person</span>
              Guardian sign-in
            </Link>
            <Link className="btn btn-primary btn-sm" href="/admissions" prefetch={false}>
              Apply for admission
            </Link>
          </div>

          <button
            ref={menuButtonRef}
            type="button"
            className="burger"
            aria-expanded={menuOpen}
            aria-controls="public-nav-drawer"
            aria-label="Open menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="msym" aria-hidden="true">menu</span>
          </button>
        </div>
      </div>

      {/* V14 mobile drawer — right-side slide-in panel with scrim */}
      {menuOpen ? (
        <div className="m-drawer open" role="dialog" aria-modal="true" aria-label="Site menu">
          <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <nav
            ref={navRef}
            id="public-nav-drawer"
            className="panel"
            aria-label="Primary navigation"
            onClick={handleNavClick}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontFamily: "var(--serif)", fontWeight: 600, fontSize: "0.98rem" }}>Menu</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                <span className="msym" aria-hidden="true">close</span>
              </button>
            </div>
            {NAV_LINKS.map((link) => {
              const active =
                pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.label}
                  href={link.href}
                  prefetch={false}
                  className={active ? "on" : undefined}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              <Link href="/sign-in" prefetch={false} style={{ display: "block", padding: "12px 10px", fontWeight: 650, color: "var(--saffron-ink)" }}>
                Guardian sign-in →
              </Link>
              <Link href="/admissions" prefetch={false} style={{ display: "block", padding: "12px 10px", fontWeight: 650, color: "var(--ink)" }}>
                Apply for admission →
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

export default PublicHeader;
