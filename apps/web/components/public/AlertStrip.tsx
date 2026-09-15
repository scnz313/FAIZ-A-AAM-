import Link from "next/link";

import { formatKolkata } from "@/modules/iot/domain";
import { isNoticeExpired, type ContentNotice } from "@/modules/services/content";

import styles from "./AlertStrip.module.css";

/** Resolved notice the strip renders; the caller owns loading and audience scope. */
export type AlertStripNotice = {
  title: string;
  excerpt?: string;
  dateIso: string;
  href: string;
};

/** Minimal notice shape the selection rule reads. */
export type SelectableNotice = Pick<
  ContentNotice,
  "title" | "excerpt" | "dateIso" | "urgent" | "status" | "expiresAtIso"
>;

/**
 * Owner decision (C5): an alert is the latest urgent, published, non-expired
 * notice for the surface's audience. There is no alert entity, no
 * acknowledgement, and no facility or environment connection. `nowIso` is
 * injectable so the demo clock and tests stay deterministic. Returns null
 * when no notice qualifies, so callers never fabricate an alert.
 */
export function selectUrgentNotice<T extends SelectableNotice>(
  notices: readonly T[],
  nowIso: string = new Date().toISOString(),
): T | null {
  const candidates = notices.filter(
    (notice) => notice.urgent === true && notice.status === "published" && !isNoticeExpired(notice, nowIso),
  );
  let newest: T | null = null;
  for (const candidate of candidates) {
    if (newest === null || Date.parse(candidate.dateIso) > Date.parse(newest.dateIso)) newest = candidate;
  }
  return newest;
}

/**
 * Sitewide urgent-notice strip. It renders nothing when the caller resolves
 * no notice, so a surface never fabricates an alert. The caller is expected
 * to exclude the same notice from its regular notice line so one notice
 * never appears twice on a single screen. Server-rendered and static, so it
 * is not a live region.
 */
export default function AlertStrip({ notice }: { notice: AlertStripNotice | null }) {
  if (notice === null) return null;

  return (
    <div className={`alert-strip alert-strip--warning ${styles.strip}`} role="region" aria-label="Urgent notice">
      <p className={styles.inner}>
        <span className={styles.label}>Urgent notice</span>
        <span className={styles.copy}>
          <strong className={styles.title}>{notice.title}</strong>
          {notice.excerpt ? <span className={styles.excerpt}>{notice.excerpt}</span> : null}
        </span>
        <time className={styles.date} dateTime={notice.dateIso}>
          {formatKolkata(notice.dateIso, { format: "day" })}
        </time>
        <Link className={styles.link} href={notice.href} prefetch={false}>
          Read notice <span className="msym" aria-hidden="true">arrow_forward</span>
        </Link>
      </p>
    </div>
  );
}
