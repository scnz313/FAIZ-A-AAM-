import type { Metadata } from "next";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { OverviewFinanceBand } from "@/components/portal/OverviewFinanceBand";
import OverviewGreeting from "@/components/portal/OverviewGreeting";
import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { FINANCE_DEMO_NOTE } from "@/modules/services/finance";
import { contentService } from "@/modules/services/content";
import { formatKolkata } from "@/modules/iot/domain";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerContent } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Overview · Portal",
  description: "Family portal overview for Faiz Aam Secondary School — fees, notices, and results at a glance.",
};

const QUICK_LINKS: ReadonlyArray<{ num: string; title: string; line: string; href: string }> = [
  { num: "01", title: "Pay fees", line: "Review the ledger and settle an outstanding invoice.", href: "/portal/fees" },
  { num: "02", title: "View results", line: "Term reports for the linked student.", href: "/portal/results" },
  { num: "03", title: "Today's timetable", line: "The school day, period by period.", href: "/portal/timetable" },
  { num: "04", title: "School notices", line: "Advisories, schedules, and dates from the office.", href: "/portal/notices" },
];

export default async function PortalOverviewPage() {
  /* Family-audience published notices — the same record the notices page reads. */
  const notices = dataAdapter() === "supabase" ? await loadServerContent("family") : await contentService.listForAudience("family");
  const pinnedNotices = notices.filter((notice) => notice.urgent || notice.pinned);

  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">Parent portal</p>
        <OverviewGreeting titleClassName={styles.title} />
        <ActiveChildLine />
      </header>

      <OverviewFinanceBand
        classNames={{
          band: styles.band,
          badge: styles.badge,
          grid: styles.grid,
          col: styles.col,
          bigNum: styles.bigNum,
          detail: styles.detail,
          bigLine: styles.bigLine,
        }}
      />

      <section aria-labelledby="attention-title">
        <p className="section-label" id="attention-title">
          For your attention
        </p>
        <ul className={styles.noticeList}>
          {pinnedNotices.map((notice) => (
            <li key={notice.slug}>
              <a className={styles.noticeRow} href="/portal/notices">
                <span className={styles.noticeDate}>
                  {formatKolkata(notice.dateIso, { format: "day" })}
                  {notice.urgent ? <span className={styles.urgentMark}> · Urgent</span> : null}
                </span>
                <span>
                  <strong className={styles.noticeTitle}>{notice.title}</strong>
                  <small className={styles.noticeExcerpt}>{notice.excerpt}</small>
                </span>
                <span className={styles.noticeArrow} aria-hidden="true">
                  →
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="quick-title">
        <p className="section-label" id="quick-title">
          Quick links
        </p>
        <div className={styles.quickGrid}>
          {QUICK_LINKS.map((link) => (
            <a key={link.num} className="tile-link" href={link.href}>
              <span className="tile-link__num">{link.num}</span>
              <span className="tile-link__title">{link.title}</span>
              <span className="tile-link__line">{link.line}</span>
              <span className="tile-link__more">Open →</span>
            </a>
          ))}
        </div>
      </section>

      <aside className="panel">
        <p className="section-label">About this data</p>
        <p className={styles.demoPanelText}>
          <span className="demo-badge">Demo session</span> {FINANCE_DEMO_NOTE} {CONTENT_DEMO_NOTE} Nothing shown
          here is a real student record, amount, or notice.
        </p>
      </aside>
    </div>
  );
}
