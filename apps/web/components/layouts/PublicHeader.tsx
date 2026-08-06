"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
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
  { label: "Disclosure", href: "/disclosure" },
] as const;

/** Utility strip contacts — fictional concept details for the design site. */
const UTILITY_CONTACTS = [
  { label: "+91 000 000 0000", href: "tel:+910000000000" },
  { label: "office@faizaam.example", href: "mailto:office@faizaam.example" },
] as const;

/* Below this width the primary nav collapses into the mobile menu. */
const MENU_BREAKPOINT = "(max-width: 1000px)";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Global public header: utility strip (date + contacts), brand, primary
 * nav with the active route marked, and persistent utility actions.
 * The nav underline follows the hover style; the current route keeps it
 * permanently via aria-current="page".
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

  /* Nav links are real <a> tags; a route change closes the menu. */
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  /* While open: lock body scroll, focus the first nav link (so Shift+Tab
     wraps inside the trap), trap Tab, close on Escape. Focus returns to
     the toggle on close. Mirrors the portal/staff drawer behavior. */
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
      {/* The utility strip belongs to inner pages; the hero stays a single
          clean row — brand, nav, portal action — over the ink ground. */}
      {!dark && (
        <div className="public-utility public-utility--light">
          <p className="public-utility__date">Bandipora · Jammu &amp; Kashmir</p>
          <p className="public-utility__links">
            {UTILITY_CONTACTS.map((contact) => (
              <a key={contact.label} href={contact.href}>
                {contact.label}
              </a>
            ))}
          </p>
        </div>
      )}

      <div className="public-header-main">
        <a className="brand" href="/" aria-label="Faiz Aam Secondary School home">
          <Crest size="md" tone={dark ? "chalk" : "ink"} />
          <span className="brand-copy">
            <span className="brand-name-row">
              <strong>Faiz Aam</strong>
              <span className="urdu brand-urdu" dir="rtl" lang="ur">
                فیض عام
              </span>
            </span>
            <small>Secondary School · Bandipora</small>
          </span>
        </a>

        <button
          ref={menuButtonRef}
          type="button"
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="public-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? "Close" : "Menu"}
        </button>

        <nav
          ref={navRef}
          id="public-nav"
          className={menuOpen ? "is-open" : undefined}
          aria-label="Primary navigation"
          onClick={handleNavClick}
        >
          {NAV_LINKS.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <a
                key={link.label}
                href={link.href}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </a>
            );
          })}
        </nav>

        <div className="header-actions">
          <a className="text-action" href="/portal/fees">
            Pay fees
          </a>
          <a className="portal-button" href="/portal">
            Portal <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </header>
  );
}

export default PublicHeader;
