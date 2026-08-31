"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { relativeTime } from "@/modules/iot/domain";
import { notificationsService } from "@/modules/services/notifications";
import type { NotificationItem } from "@/modules/notifications/demo";

import styles from "./NotificationBell.module.css";

const PANEL_ID = "notification-panel";

/** Hand-drawn bell glyph — stroke-only, matches the editorial line weight. */
function BellIcon() {
  return (
    <svg
      className={styles.icon}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4.5a4.75 4.75 0 0 0-4.75 4.75c0 3.75-1.4 5.25-1.9 6.25h13.3c-.5-1-1.9-2.5-1.9-6.25A4.75 4.75 0 0 0 12 4.5Z" />
      <path d="M9.75 19a2.25 2.25 0 0 0 4.5 0" />
    </svg>
  );
}

/**
 * Topbar notification bell for the portal shells: a square chalk button
 * with a saffron unread-count chip, a flat ruled dropdown listing demo
 * notifications with relative times, and mark-all-read. Closes on outside
 * click, Escape, or route change; focus moves into the panel on open and
 * returns to the button on Escape-close. Unread-count changes are
 * announced politely for screen readers.
 *
 * When `accountId` is provided, the list and the read state come from the
 * notifications service (per-account, session-backed); without it the bell
 * renders the passed items with local read state.
 */
export function NotificationBell({ items: initialItems, accountId }: { items: NotificationItem[]; accountId?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initialItems);
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());
  /* Relative labels depend on "now": until mounted, render the fixed
     timestamp so server HTML and client hydration can never disagree. */
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  /* With an account, refresh the list from the service so its per-account
     read state (set elsewhere in the session) is reflected here. */
  useEffect(() => {
    if (!accountId || !open) return;
    let cancelled = false;
    void notificationsService
      .listForAccount(accountId)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, open]);

  const unreadCount = items.filter((item) => item.unread && !readIds.has(item.id)).length;

  /* A route change closes the dropdown. */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /* Close on outside click; Escape closes and returns focus to the bell. */
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  /* Move focus into the panel when it opens (first stop: the header row). */
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const markAllRead = () => {
    if (accountId) {
      void notificationsService.markAllRead(accountId).then((list) => setItems(list)).catch(() => {});
    }
    setReadIds(new Set(items.map((item) => item.id)));
  };

  const markRead = (id: string) => {
    setReadIds((current) => new Set([...current, id]));
    if (accountId) void notificationsService.markRead(accountId, id).then((list) => setItems(list)).catch(() => {});
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-label={`Notifications, ${unreadCount} unread`}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className={styles.chip} aria-hidden="true">
            {unreadCount}
          </span>
        )}
      </button>

      <div
        id={PANEL_ID}
        ref={panelRef}
        role="region"
        aria-label="Notifications"
        tabIndex={-1}
        hidden={!open}
        className={styles.panel}
      >
        <div className={styles.header}>
          <p className={styles.heading}>Notifications</p>
          <button
            type="button"
            className={styles.markAll}
            disabled={unreadCount === 0}
            onClick={markAllRead}
          >
            Mark all read
          </button>
        </div>

        {items.length === 0 ? (
          <p className={styles.empty}>Nothing new — notifications appear here.</p>
        ) : (
          <ul className={styles.list}>
            {/* Items render only after mount: their timestamps derive from
                the demo module's "now", which must never reach the SSR DOM
                (server and client bundles evaluate it at different times). */}
            {mounted &&
              items.map((item) => {
                const isUnread = item.unread && !readIds.has(item.id);
                return (
                  <li key={item.id} className={styles.item}>
                    <span
                      className={`${styles.marker}${isUnread ? ` ${styles.markerUnread}` : ""}`}
                      aria-hidden="true"
                    />
                    <div className={styles.itemBody}>
                      <p className={styles.itemMeta}>
                        <span className={styles.kind}>{item.kind}</span>
                        <time className={styles.time} dateTime={item.atIso}>
                          {relativeTime(item.atIso)}
                        </time>
                      </p>
                      {item.href ? (
                        <Link className={`${styles.text} ${styles.textLink}`} href={item.href} prefetch={false} onClick={() => markRead(item.id)}>{item.text}</Link>
                      ) : (
                        <p className={styles.text}>{item.text}</p>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </div>

      {/* Live region announcing unread-count changes. React 19.1 raises a
          prod-only hydration false-positive on SSR'd role="status" regions;
          the text is identical on both sides, so suppression is safe. */}
      <p role="status" className="sr-only" suppressHydrationWarning>
        {unreadCount === 0 ? "All notifications read" : `${unreadCount} unread notifications`}
      </p>
    </div>
  );
}

export default NotificationBell;
