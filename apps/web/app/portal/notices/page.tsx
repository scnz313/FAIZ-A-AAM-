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
      <header>
        <p className="eyebrow">Portal · Notices</p>
        <h1 className={styles.title}>Notices</h1>
        <p className={styles.intro}>
          Notices for families and students — pinned items stay on top, newest first.
        </p>
        <ActiveChildLine />
      </header>

      <div>
        <div className="tabs" role="group" aria-label="Filter by category">
          <a
            href="/portal/notices"
            className={`${styles.tabLink}${category === null ? ` ${styles.tabLinkActive}` : ""}`}
            aria-current={category === null ? "true" : undefined}
          >
            All
          </a>
          {noticeCategories.map((item) => (
            <a
              key={item}
              href={`/portal/notices?category=${encodeURIComponent(item)}`}
              className={`${styles.tabLink}${category === item ? ` ${styles.tabLinkActive}` : ""}`}
              aria-current={category === item ? "true" : undefined}
            >
              {item}
            </a>
          ))}
        </div>

        {ordered.length === 0 ? (
          <div className="workspace-state">
            <p className="workspace-state-title">No notices in this category</p>
            {category === null ? (
              <p className="workspace-state-note">
                Nothing has been published for families yet. New notices appear here as soon as the office posts
                them.
              </p>
            ) : (
              <>
                <p className="workspace-state-note">
                  No {category} notices are posted right now. Try another category or view all notices.
                </p>
                <a className="link-arrow" href="/portal/notices">
                  View all notices →
                </a>
              </>
            )}
          </div>
        ) : (
          <div className={styles.rows}>
            {ordered.map((notice) => (
              <details
                key={notice.slug}
                className={`${styles.row}${notice.urgent ? ` ${styles.rowUrgent}` : ""}`}
              >
                <summary>
                  <span className={styles.rowMeta}>
                    <span className={styles.category}>
                      {notice.category}
                      {notice.pinned ? " · Pinned" : ""}
                    </span>
                    <span className={styles.metaRight}>
                      <time className={styles.date} dateTime={notice.dateIso}>
                        {formatKolkata(notice.dateIso, { format: "day" })}
                      </time>
                      <span className={styles.marker} aria-hidden="true">
                        +
                      </span>
                    </span>
                  </span>
                  <span className={styles.titleLine}>
                    <strong>{notice.title}</strong>
                    {notice.urgent && <StatusBadge tone="alert">URGENT</StatusBadge>}
                  </span>
                  <span className={styles.excerpt}>{notice.excerpt}</span>
                </summary>
                <div className={styles.body}>
                  {notice.body.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      <p className={styles.demoNote}>
        <span className="demo-badge">Demo data</span>
        <span>{CONTENT_DEMO_NOTE}</span>
      </p>
    </div>
  );
}
