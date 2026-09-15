import Link from "next/link";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { contentService, noticeCategories, type ContentNotice } from "@/modules/services/content";
import { formatKolkata } from "@/modules/iot/domain";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerContent } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

type NoticesPageProps = {
  searchParams: Promise<{ category?: string | string[] }>;
};

function compareNotices(a: ContentNotice, b: ContentNotice): number {
  const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
  if (pinned !== 0) return pinned;
  return new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime();
}

export default async function NoticesPage({ searchParams }: NoticesPageProps) {
  const params = await searchParams;
  const requested = typeof params.category === "string" ? params.category : null;
  const validCategories = noticeCategories as readonly string[];
  const category =
    requested !== null && validCategories.includes(requested)
      ? (requested as (typeof noticeCategories)[number])
      : null;

  /* Published notices the family may see: public rows plus family-targeted
     rows — the same records the public site and staff workspaces read. */
  const notices = dataAdapter() === "supabase" ? await loadServerContent("family") : await contentService.listForAudience("family");
  const visible = category === null ? notices : notices.filter((n) => n.category === category);
  const ordered = [...visible].sort(compareNotices);

  return (
    <div className={styles.page}>
      {/* V14 PageHead */}
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Notices</h1>
          <p className="ph-sub">
            Audience-safe notices for the active child&apos;s classes and the school generally. Expired notices disappear automatically.
          </p>
          <ActiveChildLine />
        </div>
      </div>

      {/* V14 seg filter for categories */}
      <div className="seg" role="tablist" aria-label="Filter by category">
        <Link
          prefetch={false}
          href="/portal/notices"
          role="tab"
          aria-selected={category === null}
          className={category === null ? "on" : undefined}
        >
          All
        </Link>
        {noticeCategories.map((item) => (
          <Link
            prefetch={false}
            key={item}
            href={`/portal/notices?category=${encodeURIComponent(item)}`}
            role="tab"
            aria-selected={category === item}
            className={category === item ? "on" : undefined}
          >
            {item}
          </Link>
        ))}
      </div>

      {ordered.length === 0 ? (
        <section className="panel">
          <div className="pn-body">
            <div style={{ textAlign: "center", padding: "42px 18px" }}>
              <div className="empty-ill" style={{ margin: "0 auto 12px" }}>
                <span className="msym" style={{ fontSize: 26 }}>inbox</span>
              </div>
              <div className="strong" style={{ fontSize: "1.02rem" }}>No notices in this category</div>
              <p className="muted small" style={{ margin: "6px auto 14px", maxWidth: 340 }}>
                {category === null
                  ? "Nothing has been published for families yet. New notices appear here as soon as the office posts them."
                  : `No ${category} notices are posted right now. Try another category or view all notices.`}
              </p>
              {category !== null ? (
                <Link prefetch={false} className="btn btn-ghost btn-sm" href="/portal/notices">
                  View all notices
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        /* V14 stack of accordion panels */
        <div className="stack" style={{ gap: 14 }}>
          {ordered.map((notice) => (
            <details key={notice.slug} className={`panel ${styles.noticePanel}`}>
              <summary className={styles.noticeHead}>
                <div className={styles.noticeHeadLeft}>
                  <div className={styles.noticeChips}>
                    <span className="chip">{notice.category}</span>
                    {notice.urgent ? <StatusBadge tone="alert">Urgent</StatusBadge> : null}
                    {notice.pinned ? (
                      <span className="chip" style={{ borderColor: "var(--saffron-line)", color: "var(--saffron-ink)" }}>
                        Pinned
                      </span>
                    ) : null}
                  </div>
                  <h2 className={styles.noticeTitle}>{notice.title}</h2>
                  <div className={`tiny muted ${styles.noticeDate}`}>
                    Published {formatKolkata(notice.dateIso, { format: "day" })}
                  </div>
                </div>
                <span className={`msym ${styles.expandIcon}`} aria-hidden="true">expand_more</span>
              </summary>
              <div className={styles.noticeBody}>
                {notice.body.length === 0 ? (
                  <p className="small muted">No further detail was published for this notice. Contact the office if you need it.</p>
                ) : (
                  notice.body.map((paragraph, index) => (
                    <p key={index} className="small" style={{ lineHeight: 1.65 }}>{paragraph}</p>
                  ))
                )}
              </div>
            </details>
          ))}
        </div>
      )}

      {dataAdapter() !== "supabase" ? (
        <p className={styles.demoNote}>
          <span className="demo-badge">Demo data</span>
          <span>{CONTENT_DEMO_NOTE}</span>
        </p>
      ) : null}
    </div>
  );
}
