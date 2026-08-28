"use client";

import { useEffect, useState } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { canRole } from "@/modules/services/staff-authorization";
import {
  contentService,
  type ContentNotice,
  type NoticeStatus,
  type PublicPageReviewStatus,
  type PublicPageRow,
} from "@/modules/services/content";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./page.module.css";

const PAGE_STATUS_TONE: Record<PublicPageReviewStatus, "good" | "neutral" | "watch"> = {
  Published: "good",
  Draft: "neutral",
  "Needs review": "watch",
  "In review": "watch",
};

const NOTICE_STATUS_TONE: Record<NoticeStatus, "good" | "neutral" | "alert"> = {
  published: "good",
  draft: "neutral",
  expired: "alert",
};

const AUDIENCE_LABEL: Record<ContentNotice["audience"], string> = {
  public: "Public",
  family: "Family",
};

export default function ContentPage() {
  const [pages, setPages] = useState<PublicPageRow[] | null>(null);
  const [notices, setNotices] = useState<ContentNotice[] | null>(null);
  const [announcement, setAnnouncement] = useState<{ key: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { summary } = useStaffContext();
  const actor = summary?.displayName ?? "Content staff";
  const canPublish = canRole(summary?.role ?? "", "content.publish");

  /* Both tables read through the content service — the notice rows include
     draft and expired states alongside the published list. */
  useEffect(() => {
    let cancelled = false;
    void Promise.all([contentService.listPublicPages(), contentService.listForStaff()])
      .then(([pageRows, noticeRows]) => {
        if (cancelled) return;
        setPages(pageRows);
        setNotices(noticeRows);
      })
      .catch(() => {
        if (!cancelled) setPages([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function announce(text: string) {
    setAnnouncement((prev) => ({ key: (prev?.key ?? 0) + 1, text }));
  }

  async function review(row: PublicPageRow) {
    if (pages === null || busy) return;
    setBusy(true);
    try {
      const nextStatus: PublicPageReviewStatus = row.status === "In review" ? "Published" : "In review";
      const result = await contentService.setPublicPageStatus(row.key, nextStatus, actor);
      if (result.ok) {
        setPages((prev) => (prev ? prev.map((r) => (r.key === row.key ? result.value : r)) : prev));
        announce(`Page "${row.label}" marked ${nextStatus.toLowerCase()} (demo).`);
      } else {
        announce(result.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Content</p>
        <h1 className="workspace-title">Content</h1>
        <p className="workspace-intro">Public pages and their review status; notice publishing states.</p>
      </header>

      <section className="panel" aria-labelledby="content-list-heading">
        <div className={styles.panelHead}>
          <h2 id="content-list-heading" className={styles.panelTitle}>
            Public pages
          </h2>
          <span className="demo-badge">Demo data</span>
        </div>

        {announcement && (
          <p key={announcement.key} className={styles.liveNote} aria-live="polite">
            {announcement.text}
          </p>
        )}

        {pages === null ? (
          <p className={styles.loading} role="status">
            Loading content…
          </p>
        ) : (
          <div className="table--scroll">
            <table className={`table ${styles.table}`}>
              <caption className="sr-only">Public pages with status, last review and owner</caption>
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Last reviewed</th>
                  <th scope="col">Owner</th>
                  <th scope="col">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pages.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <a className={styles.pageLink} href={row.href}>
                        {row.label}
                      </a>
                    </td>
                    <td>
                      <StatusBadge tone={PAGE_STATUS_TONE[row.status]}>{row.status}</StatusBadge>
                    </td>
                    <td className="num">{row.lastReviewed}</td>
                    <td>{row.owner}</td>
                    <td className={styles.cellAction}>
                      {canPublish ? (
                        <Button variant="quiet" disabled={busy} onClick={() => void review(row)}>
                          {row.status === "In review" ? "Mark reviewed" : "Review"}
                        </Button>
                      ) : (
                        <span aria-label="Read only">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="notice-status-heading">
        <div className={styles.panelHead}>
          <h2 id="notice-status-heading" className={styles.panelTitle}>
            Notice status
          </h2>
          <span className="demo-badge">Demo data</span>
        </div>

        {notices === null ? (
          <p className={styles.loading} role="status">
            Loading notice status…
          </p>
        ) : (
          <div className="table--scroll">
            <table className={`table ${styles.table}`}>
              <caption className="sr-only">Notices with status, audience, version and review due date</caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Category</th>
                  <th scope="col">Audience</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Version
                  </th>
                  <th scope="col" className="num">Published</th>
                  <th scope="col" className="num">Review due</th>
                </tr>
              </thead>
              <tbody>
                {notices.map((notice) => (
                  <tr key={notice.slug}>
                    <td>
                      <strong>{notice.title}</strong>
                    </td>
                    <td>{notice.category}</td>
                    <td>{AUDIENCE_LABEL[notice.audience]}</td>
                    <td>
                      <StatusBadge tone={NOTICE_STATUS_TONE[notice.status]}>{notice.status}</StatusBadge>
                    </td>
                    <td className="num">{notice.version}</td>
                    <td className="num">
                      {notice.status === "published" ? formatKolkata(notice.dateIso, { format: "day" }) : "—"}
                    </td>
                    <td className="num">{notice.reviewDue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className={styles.note}>Content changes are versioned; public pages show only published current content.</p>
      <p className="demo-note">
        <span className="demo-badge">Demo data</span> {CONTENT_DEMO_NOTE}
      </p>
    </div>
  );
}
