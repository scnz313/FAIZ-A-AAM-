"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { relativeTime } from "@/modules/iot/domain";
import { notificationsService, type NotificationAudience } from "@/modules/services/notifications";
import type { NotificationItem } from "@/modules/notifications/demo";

import styles from "./NotificationBell.module.css";

const PANEL_ID = "notification-panel";

/** Most recent notices rendered before the reader expands the list. */
const VISIBLE_LIMIT = 6;

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
 * with a saffron unread-count chip and a flat ruled dropdown listing the
 * account's notifications with relative times. The list shows the six most
 * recent notices with an explicit expand control, stays inside a bounded
 * scroll region, and every row can be cleared individually or in one
 * "Clear all" action alongside mark-all-read. Closes on outside click,
 * Escape, or route change; focus moves into the panel on open and returns
 * to the button on Escape-close. Unread-count and clear changes are
 * announced politely for screen readers.
 *
 * When `accountId` is provided, the list, the read state, and the cleared
 * state come from the notifications service (per-account, session-backed);
 * without it the bell renders the passed items with local read state.
 */
export function NotificationBell({ items: initialItems, accountId, audience = "family" }: { items: NotificationItem[]; accountId?: string; audience?: NotificationAudience }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initialItems);
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [serverUnread, setServerUnread] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  /* Relative labels depend on "now": until mounted, render the fixed
     timestamp so server HTML and client hydration can never disagree. */
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  /* With an account, refresh the list and the authoritative unread count
     from the service so its per-account read state (set elsewhere in the
     session) is reflected here. Failures surface inline in the panel
     instead of being swallowed; the list-derived count is the fallback
     when only the exact-count call fails. */
  useEffect(() => {
    if (!accountId || !open) return;
    let cancelled = false;
    setError(null);
    void notificationsService
      .listForAccount(accountId, audience)
      .then((list) => {
        if (!cancelled) {
          setItems(list);
          /* Server truth arrived: local optimistic hides are no longer needed. */
          setDismissedIds(new Set());
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Notifications are unavailable.");
      });
    void notificationsService
      .unreadCount(accountId)
      .then((count) => {
        if (!cancelled) setServerUnread(count);
      })
      .catch(() => {
        /* Keep the list-derived count when the exact count cannot load. */
        if (!cancelled) setServerUnread(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, audience, open, reloadKey]);

  /* Session-dependent state (read ids, cleared ids, server count) and the
     shell-supplied items can differ between the server and the browser in
     demo mode, so nothing derived from them renders before mount: the
     server HTML and the first client render always agree, and the real
     list, chip, and counts appear on the first post-hydration update. */
  const visibleItems = mounted ? items.filter((item) => !dismissedIds.has(item.id)) : [];
  const unreadCount = serverUnread ?? visibleItems.filter((item) => item.unread && !readIds.has(item.id)).length;
  const shownItems = showAll ? visibleItems : visibleItems.slice(0, VISIBLE_LIMIT);

  /* A route change closes the dropdown. */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /* Collapse the expanded list whenever the panel closes. */
  useEffect(() => {
    if (!open) setShowAll(false);
  }, [open]);

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
    const previous = readIds;
    setError(null);
    setReadIds(new Set(items.map((item) => item.id)));
    if (accountId) {
      void notificationsService
        .markAllRead(accountId, audience)
        .then((list) => {
          setItems(list);
          setServerUnread(0);
        })
        .catch((cause: unknown) => {
          setReadIds(previous);
          setError(cause instanceof Error ? cause.message : "Notifications could not be marked read.");
        });
    }
  };

  const markRead = (id: string) => {
    const wasUnread = !readIds.has(id) && items.some((item) => item.id === id && item.unread);
    const previous = readIds;
    setError(null);
    setReadIds((current) => new Set([...current, id]));
    if (accountId) {
      void notificationsService
        .markRead(accountId, id, audience)
        .then((list) => {
          setItems(list);
          setServerUnread((count) => (count === null || !wasUnread ? count : Math.max(0, count - 1)));
        })
        .catch((cause: unknown) => {
          setReadIds(previous);
          setError(cause instanceof Error ? cause.message : "Notification could not be marked read.");
        });
    }
  };

  const dismiss = (id: string) => {
    const target = items.find((item) => item.id === id);
    const wasUnread = Boolean(target?.unread) && !readIds.has(id);
    setError(null);
    /* Optimistically lift the row out of the list; the panel keeps focus. */
    setDismissedIds((current) => new Set([...current, id]));
    panelRef.current?.focus();
    if (!accountId) {
      setItems((current) => current.filter((item) => item.id !== id));
      setAnnouncement("Notification cleared.");
      return;
    }
    void notificationsService
      .dismiss(accountId, id, audience)
      .then((list) => {
        setItems(list);
        setDismissedIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        setServerUnread((count) => (count === null || !wasUnread ? count : Math.max(0, count - 1)));
        setAnnouncement("Notification cleared.");
      })
      .catch((cause: unknown) => {
        setDismissedIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        setError(cause instanceof Error ? cause.message : "Notification could not be cleared.");
      });
  };

  const dismissAll = () => {
    const previousItems = items;
    const previousIds = dismissedIds;
    const previousUnread = serverUnread;
    setError(null);
    setDismissedIds(new Set(items.map((item) => item.id)));
    panelRef.current?.focus();
    if (!accountId) {
      setItems([]);
      setAnnouncement("All notifications cleared.");
      return;
    }
    void notificationsService
      .dismissAll(accountId, audience)
      .then((list) => {
        setItems(list);
        setDismissedIds(new Set());
        setServerUnread(0);
        setAnnouncement("All notifications cleared.");
      })
      .catch((cause: unknown) => {
        setItems(previousItems);
        setDismissedIds(previousIds);
        setServerUnread(previousUnread);
        setError(cause instanceof Error ? cause.message : "Notifications could not be cleared.");
      });
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
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.markAll}
              disabled={unreadCount === 0}
              onClick={markAllRead}
            >
              Mark all read
            </button>
            <button
              type="button"
              className={styles.markAll}
              disabled={visibleItems.length === 0}
              onClick={dismissAll}
            >
              Clear all
            </button>
          </div>
        </div>

        {error !== null && (
          <div className={styles.error} role="alert">
            <p className={styles.errorText}>{error}</p>
            <button type="button" className={styles.retry} onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </button>
          </div>
        )}

        {visibleItems.length === 0 ? (
          error === null && <p className={styles.empty}>Nothing new. Notifications appear here.</p>
        ) : (
          <>
            <ul className={styles.list}>
              {/* Items render only after mount: their timestamps derive from
                  the demo module's "now", which must never reach the SSR DOM
                  (server and client bundles evaluate it at different times). */}
              {mounted &&
                shownItems.map((item) => {
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
                      <button
                        type="button"
                        className={styles.dismiss}
                        aria-label={`Dismiss notification: ${item.text}`}
                        onClick={() => dismiss(item.id)}
                      >
                        <span className="msym" aria-hidden="true" style={{ fontSize: 16 }}>
                          close
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ul>
            {visibleItems.length > VISIBLE_LIMIT && (
              <button
                type="button"
                className={styles.showAll}
                aria-expanded={showAll}
                onClick={() => setShowAll((wasShown) => !wasShown)}
              >
                {showAll ? "Show fewer" : `Show all ${visibleItems.length}`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Live region announcing unread-count changes. React 19.1 raises a
          prod-only hydration false-positive on SSR'd role="status" regions;
          the text is identical on both sides, so suppression is safe. */}
      <p role="status" className="sr-only" suppressHydrationWarning>
        {unreadCount === 0 ? "All notifications read" : `${unreadCount} unread notifications`}
      </p>

      {/* Separate polite status so a clear is announced without mixing into
          the unread count sentence above. */}
      <p role="status" className="sr-only" suppressHydrationWarning>
        {announcement}
      </p>
    </div>
  );
}

export default NotificationBell;
