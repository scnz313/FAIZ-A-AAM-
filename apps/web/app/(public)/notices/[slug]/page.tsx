import type { Metadata } from "next";
import type { ReactNode } from "react";

import PageIntro from "@/components/public/PageIntro";
import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { contentService } from "@/modules/services/content";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Notice",
};

export default async function NoticeDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  /* Only published, public notices are served; drafts, expired rows, and
     family-targeted notices are never exposed through a public URL. */
  const notice = await contentService.getNotice(slug, "public");

  if (!notice) {
    return (
      <div className={styles.page}>
        <PageIntro eyebrow="School office" title="Notice not found" deck="This notice may have expired or the link is incorrect." />
        <div className={styles.body}>
          <a className="link-arrow" href="/notices">
            ← All notices
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageIntro eyebrow={`School office · ${notice.category}`} title={notice.title} deck={notice.excerpt} />
      <div className={styles.body}>
        <p className={styles.meta}>
          <span className={`num ${styles.date}`}>{formatKolkata(notice.dateIso, { format: "full" })}</span>
          {notice.urgent ? <span className="status-badge status-badge--alert">Urgent</span> : null}
          {notice.pinned ? <span className="status-badge status-badge--watch">Pinned</span> : null}
        </p>

        <div className={styles.prose}>
          {notice.body.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>

        <div className={styles.foot}>
          <a className="link-arrow" href="/notices">
            ← All notices
          </a>
        </div>

        <p className={styles.note}>{CONTENT_DEMO_NOTE}</p>
      </div>
    </div>
  );
}
