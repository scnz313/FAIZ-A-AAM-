import type { Metadata } from "next";
import Link from "next/link";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { OverviewFinanceBand } from "@/components/portal/OverviewFinanceBand";
import OverviewGreeting from "@/components/portal/OverviewGreeting";
import { ChildOverviewRows } from "@/components/portal/ChildOverviewRows";
import AlertStrip, { selectUrgentNotice } from "@/components/public/AlertStrip";
import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { demoNowIso } from "@/modules/demo/clock";
import { FINANCE_DEMO_NOTE } from "@/modules/services/finance";
import { contentService } from "@/modules/services/content";
import { formatKolkata } from "@/modules/iot/domain";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerContent } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Overview · Portal",
  description: "Family portal overview for Faiz Aam Secondary School · fees, notices, and results at a glance.",
};

const QUICK_LINKS: ReadonlyArray<{ icon: string; title: string; href: string }> = [
  { icon: "payments", title: "Pay a fee or invoice", href: "/portal/fees" },
  { icon: "workspace_premium", title: "Open results", href: "/portal/results" },
  { icon: "calendar_month", title: "This week's timetable", href: "/portal/timetable" },
  { icon: "folder_open", title: "Documents & downloads", href: "/portal/documents" },
];

export default async function PortalOverviewPage() {
  /* Family-audience published notices — the same record the notices page reads. */
  const supabaseMode = dataAdapter() === "supabase";
  const notices = supabaseMode ? await loadServerContent("family") : await contentService.listForAudience("family");
  /* The panel lists the latest notices (urgent and pinned first), so a
     published notice is never hidden behind a pinned-only filter. */
  const overviewNotices = [...notices]
    .sort((a, b) => {
      const priority = Number(b.urgent || b.pinned) - Number(a.urgent || a.pinned);
      if (priority !== 0) return priority;
      return (b.dateIso ?? "").localeCompare(a.dateIso ?? "");
    })
    .slice(0, 4);

  /* C5 owner decision: the latest urgent, published, non-expired family
     notice becomes the portal alert strip. Nothing renders when none exists. */
  const urgentNotice = selectUrgentNotice(notices, supabaseMode ? new Date().toISOString() : demoNowIso());

  return (
    <div className={styles.page}>
      <AlertStrip
        notice={
          urgentNotice === null
            ? null
            : {
                title: urgentNotice.title,
                excerpt: urgentNotice.excerpt,
                dateIso: urgentNotice.dateIso,
                href: "/portal/notices",
              }
        }
      />

      <div className="page-head">
        <div>
          <OverviewGreeting titleClassName={styles.title} />
          <p className="ph-sub">
            Guardian portal. Everything below is scoped to the active child. Switch children from the top bar.
          </p>
        </div>
        <ActiveChildLine />
      </div>

      <div className="g32">
        {/* Left column: Fees, Results, Notices */}
        <div className="stack" style={{ gap: 18 }}>
          <section className="panel">
            <div className="pn-head">
              <div>
                <h2>Fees</h2>
                <div className="tiny muted" style={{ marginTop: 2 }}>Balance for the active child</div>
              </div>
              <Link className="arrow-link small" href="/portal/fees" prefetch={false}>
                All invoices <span className="msym" style={{ fontSize: 15 }}>arrow_forward</span>
              </Link>
            </div>
            <div className="pn-body">
              <OverviewFinanceBand
                classNames={{
                  band: styles.feeBand,
                  grid: styles.feeGrid,
                  col: styles.feeCol,
                  bigNum: styles.feeBigNum,
                  detail: styles.feeDetail,
                  bigLine: styles.feeBigLine,
                }}
              />
            </div>
          </section>

          <section className="panel">
            <div className="pn-head">
              <h2>Notices</h2>
              <Link className="arrow-link small" href="/portal/notices" prefetch={false}>
                All notices <span className="msym" style={{ fontSize: 15 }}>arrow_forward</span>
              </Link>
            </div>
            <div className="pn-body">
              {overviewNotices.length === 0 ? (
                <p className="small muted">No notices published yet.</p>
              ) : (
                <ul className={styles.noticeList}>
                  {overviewNotices.map((notice) => (
                    <li key={notice.slug}>
                      <Link className={styles.noticeRow} href="/portal/notices" prefetch={false}>
                        <span className={styles.noticeDate}>
                          {formatKolkata(notice.dateIso, { format: "day" })}
                          {notice.urgent ? <span className={styles.urgentMark}> · Urgent</span> : null}
                        </span>
                        <span>
                          <strong className={styles.noticeTitle}>{notice.title}</strong>
                          <small className={styles.noticeExcerpt}>{notice.excerpt}</small>
                        </span>
                        <span className={styles.noticeArrow} aria-hidden="true">→</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* Right column: Active child, Quick actions, Support */}
        <div className="stack" style={{ gap: 18 }}>
          <ChildOverviewRows />

          <section className="panel">
            <div className="pn-head"><h2>Quick actions</h2></div>
            <div className="pn-body">
              <div className={styles.quickList}>
                {QUICK_LINKS.map((link) => (
                  <Link key={link.title} className={styles.quickRow} href={link.href} prefetch={false}>
                    <span className={`msym ${styles.quickIcon}`} aria-hidden="true" style={{ fontSize: 20 }}>{link.icon}</span>
                    <span className={styles.quickText}>{link.title}</span>
                    <span className={`msym ${styles.quickChev}`} aria-hidden="true" style={{ fontSize: 18 }}>chevron_right</span>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="pn-head"><h2>Support</h2></div>
            <div className="pn-body">
              <p className="small muted">Fee queries, record corrections, or anything else. The office answers within two working days on school days.</p>
              <div style={{ marginTop: 12 }}>
                <Link className="btn btn-ghost btn-sm" href="/portal/support" prefetch={false}>
                  <span className="msym" style={{ fontSize: 16 }}>support_agent</span> Contact the office
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>

      {dataAdapter() !== "supabase" ? (
        <aside className="panel" style={{ marginTop: 18 }}>
          <div className="pn-head"><h2>About this data</h2></div>
          <div className="pn-body">
            <p className={styles.demoPanelText}>
              <span className="demo-badge">Demo session</span> {FINANCE_DEMO_NOTE} {CONTENT_DEMO_NOTE} Nothing shown
              here is a real student record, amount, or notice.
            </p>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
