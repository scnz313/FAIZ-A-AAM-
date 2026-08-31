import Link from "next/link";

import { AQI_BAND_LABELS, type OverviewSummary } from "@fass/contracts";
import { getOverview } from "@/lib/iot/api";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerPublicContent } from "@/lib/supabase/server-loaders";
import { formatKolkata } from "@/modules/iot/domain";
import { BAND_TONE } from "./shared";
import styles from "./NoticeLine.module.css";

/**
 * Latest-notice strip. In Supabase mode the strip shows the latest
 * authoritative published public notice; the reading line is a live-ish
 * tie-in to the campus environment slice and never impersonates a school
 * notice. If the facade is unavailable, the strip falls back to the static
 * advisory copy alone.
 */
export default async function NoticeLine() {
  const [overview, notices] = await Promise.all([
    getOverview().catch((): OverviewSummary | null => null),
    dataAdapter() === "supabase" ? loadServerPublicContent().catch(() => []) : Promise.resolve([]),
  ]);
  const outdoor = overview?.outdoor ?? null;

  let latestNotice: { title: string; excerpt: string; dateIso: string; href: string } | null = null;
  const published = notices
    .filter((notice) => notice.status === "published")
    .sort((left, right) => new Date(right.dateIso).getTime() - new Date(left.dateIso).getTime());
  const latest = published[0];
  if (latest) {
    latestNotice = {
      title: latest.title,
      excerpt: latest.excerpt,
      dateIso: latest.dateIso,
      href: `/notices/${latest.slug}`,
    };
  }

  const headline = latestNotice?.title ?? "Winter air-quality advisory — the school moves assembly indoors on poor-air days.";

  return (
    <aside className="alert-strip alert-strip--warning" aria-label="Latest notice">
      <div className={styles.inner}>
        <p className={styles.text}>
          {latestNotice ? (
            <span className={styles.date}>{formatKolkata(latestNotice.dateIso, { format: "day" })}</span>
          ) : overview ? (
            <span className={styles.date}>{formatKolkata(overview.takenAt, { format: "day" })}</span>
          ) : null}
          <strong>{headline}</strong>
        </p>
        {outdoor ? (
          <p className={styles.reading}>
            <span
              className={`status-dot status-dot--${BAND_TONE[outdoor.aqiBand]}`}
              aria-hidden="true"
            />
            <span>
              Right now: {AQI_BAND_LABELS[outdoor.aqiBand]} air · AQI{" "}
              {outdoor.aqiIndex}
            </span>
            <span className={styles.demoTag}>demo reading</span>
          </p>
        ) : null}
        {latestNotice ? (
          <Link className="link-arrow" href={latestNotice.href}>
            Read notice →
          </Link>
        ) : (
          <Link className="link-arrow" href="/environment">
            Campus environment →
          </Link>
        )}
      </div>
    </aside>
  );
}
