import type { Metadata } from "next";
import Link from "next/link";

import PageIntro from "@/components/public/PageIntro";
import { ErrorPanel } from "@/components/ui/AsyncStates";
import RetryButton from "@/components/ui/RetryButton";
import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { contentService, type ContentNotice } from "@/modules/services/content";
import { formatKolkata } from "@/modules/iot/domain";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerPublicContent } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

type Props = {
  params: Promise<{ slug: string }>;
};

/** The notice's own title and excerpt; a withdrawn or unknown slug is
 *  marked "Notice not found" and kept out of the index. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const canonical = `/notices/${slug}`;
  let published: ContentNotice[];
  try {
    published =
      dataAdapter() === "supabase"
        ? await loadServerPublicContent()
        : await contentService.listForAudience("public");
  } catch {
    return { title: "Notice", alternates: { canonical } };
  }
  const notice = published.find((candidate) => candidate.slug === slug) ?? null;
  if (notice === null) {
    return { title: "Notice not found", robots: { index: false, follow: true }, alternates: { canonical } };
  }
  return {
    title: notice.title,
    description: notice.excerpt || undefined,
    alternates: { canonical: `/notices/${notice.slug}` },
  };
}

export default async function NoticeDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  /* Only published, public notices are served; drafts, expired rows, and
     family-targeted notices are never exposed through a public URL. A failed
     read renders the shared recoverable panel instead of throwing. */
  let published: ContentNotice[];
  try {
    published = dataAdapter() === "supabase"
      ? await loadServerPublicContent()
      : await contentService.listForAudience("public");
  } catch {
    return (
      <div className={styles.page}>
        <PageIntro
          eyebrow="School office"
          title="Notices are unavailable"
          deck="The notice board did not load. Nothing was changed."
        />
        <div className={styles.body}>
          <ErrorPanel
            title="This notice could not be loaded."
            note="The notice board is read-only; nothing was lost. Try again."
          >
            <RetryButton />
          </ErrorPanel>
          <p className={styles.meta} style={{ marginTop: 12 }}>
            <Link className="link-arrow" href="/notices">← All notices</Link>
          </p>
        </div>
      </div>
    );
  }
  const notice = published.find((candidate) => candidate.slug === slug) ?? null;

  if (!notice) {
    return (
      <div className={styles.page}>
        <PageIntro eyebrow="School office" title="Notice not found" deck="This notice may have expired or the link is incorrect." />
        <div className={styles.body}>
          <Link className="link-arrow" href="/notices">
            ← All notices
          </Link>
        </div>
      </div>
    );
  }

  const recent = published.filter((candidate) => candidate.slug !== notice.slug).slice(0, 4);

  return (
    <div className={styles.page}>
      <PageIntro eyebrow={`School office · ${notice.category}`} title={notice.title} deck={notice.excerpt} />

      <section className="sec">
        <div className="wrap">
          <div className="g34">
            <div style={{ minWidth: 0 }}>
              <Link className="link-arrow" href="/notices">
                ← Back to notices
              </Link>

              <p className={styles.meta}>
                <span className={styles.category}>{notice.category}</span>
                <span className={`num ${styles.date}`}>Published {formatKolkata(notice.dateIso, { format: "full" })}</span>
                {notice.urgent ? <span className="status-badge status-badge--alert">Urgent</span> : null}
                {notice.pinned ? <span className="status-badge status-badge--watch">Pinned</span> : null}
              </p>

              <hr className={styles.rule} />

              <div className={styles.prose}>
                {notice.body.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
                <p>
                  For questions about this notice, contact the school office during working
                  hours. Notices remain on the board until their expiry date, after which they
                  are archived by the office.
                </p>
              </div>

              {dataAdapter() !== "supabase" ? <p className={styles.note}>{CONTENT_DEMO_NOTE}</p> : null}
            </div>

            <aside className={styles.aside} aria-label="Notice board">
              <section className="panel" aria-label="Notice board">
                <div className="pn-head">
                  <h2>Notice board</h2>
                </div>
                <div className="pn-body flush">
                  {recent.map((candidate) => (
                    <Link
                      key={candidate.slug}
                      className="row-between"
                      style={{ padding: "11px 18px", borderBottom: "1px solid var(--line-soft)", gap: 12 }}
                      href={`/notices/${candidate.slug}`}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span className="small strong" style={{ display: "block", lineHeight: 1.4 }}>{candidate.title}</span>
                        <span className="tiny muted" style={{ display: "block", marginTop: 2 }}>
                          {candidate.category} · <span className="num">{formatKolkata(candidate.dateIso, { format: "day" })}</span>
                        </span>
                      </span>
                      <span className="msym" style={{ fontSize: 18, color: "var(--muted)" }}>chevron_right</span>
                    </Link>
                  ))}
                  <div className="pn-body">
                    <Link className="link-arrow tiny" href="/notices">All notices →</Link>
                  </div>
                </div>
              </section>

              <section className="panel" aria-label="Questions about this notice">
                <div className="pn-head">
                  <h2>Questions about this notice</h2>
                </div>
                <div className="pn-body">
                  <dl className="kv">
                    <dt>Office</dt>
                    <dd className="small">School days, 9:00 am to 3:00 pm</dd>
                    <dt>Phone</dt>
                    <dd className="small num"><a href="tel:+919000000000">+91 90000 00000</a></dd>
                    <dt>Email</dt>
                    <dd className="small"><a href="mailto:office@faizaam.example">office@faizaam.example</a></dd>
                  </dl>
                  <div style={{ marginTop: 14 }}>
                    <Link className="btn btn-ghost btn-sm" href="/contact">
                      <span className="msym" style={{ fontSize: 16 }}>mail</span>Write to the office
                    </Link>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}
