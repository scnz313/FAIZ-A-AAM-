import { isNoticeExpired } from "@/modules/services/content";

import styles from "./UpcomingDates.module.css";

/** Minimal notice shape the dates ledger reads; the caller owns loading. */
export type UpcomingDateNotice = {
  slug: string;
  title: string;
  category: string;
  dateIso: string;
  status?: string;
  expiresAtIso?: string | null;
};

export type UpcomingDateEntry = {
  dateIso: string;
  when: string;
  what: string;
  tag: string;
};

const DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/* Fixed month labels keep the ledger identical across ICU locale builds
   (en-GB renders September as "Sept"). */
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function kolkataDateParts(iso: string): { year: string; month: string; day: string } {
  const parts = DATE_PARTS_FORMATTER.formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return { year: value("year"), month: value("month"), day: value("day") };
}

/** Present an instant as an Asia/Kolkata calendar date, e.g. "01 Nov 2026". */
export function formatUpcomingDate(iso: string): string {
  const { year, month, day } = kolkataDateParts(iso);
  const monthIndex = Number(month);
  const label = Number.isInteger(monthIndex) && monthIndex >= 1 && monthIndex <= 12
    ? MONTH_LABELS[monthIndex - 1]
    : "";
  return `${day} ${label} ${year}`.trim();
}

function kolkataDayKey(iso: string): string {
  const { year, month, day } = kolkataDateParts(iso);
  return `${year}-${month}-${day}`;
}

/**
 * Dates come only from published public notices that carry a valid date on
 * or after the current Asia/Kolkata day (newest first, capped). No fixture
 * calendar and no fabricated deadlines: an empty result is the honest state.
 */
export function selectUpcomingDates<T extends UpcomingDateNotice>(
  notices: readonly T[],
  nowIso: string,
  limit = 5,
): UpcomingDateEntry[] {
  const todayKey = kolkataDayKey(nowIso);
  return notices
    .filter((notice) => {
      if (notice.status !== undefined && notice.status !== "published") return false;
      if (isNoticeExpired(notice, nowIso)) return false;
      if (!Number.isFinite(Date.parse(notice.dateIso))) return false;
      return kolkataDayKey(notice.dateIso) >= todayKey;
    })
    .sort((left, right) => Date.parse(right.dateIso) - Date.parse(left.dateIso))
    .slice(0, Math.max(0, limit))
    .map((notice) => ({
      dateIso: notice.dateIso,
      when: formatUpcomingDate(notice.dateIso),
      what: notice.title,
      tag: notice.category,
    }));
}

/**
 * V15 dates ledger: notice-derived dates only. When no published notice
 * carries a current or upcoming date, the section says so instead of
 * inventing a school calendar.
 */
export default function UpcomingDates({
  notices = [],
  nowIso,
}: {
  notices?: readonly UpcomingDateNotice[];
  nowIso?: string;
} = {}) {
  const dates = selectUpcomingDates(notices, nowIso ?? new Date().toISOString());

  return (
    <section className="sec" aria-labelledby="dates-heading">
      <div className="wrap">
        <div className={styles.head}>
          <div>
            <p className="section-label">Upcoming dates</p>
            <h2 className={styles.heading} id="dates-heading">
              Upcoming dates.
            </h2>
          </div>
          <p className={styles.sub}>
            The full academic calendar is published in the guardian portal each term.
          </p>
        </div>
        <div className={styles.datesLedger}>
          {dates.length === 0 ? (
            <p className={styles.empty}>No dates have been published yet.</p>
          ) : (
            dates.map((entry) => (
              <div className={styles.dlRow} key={`${entry.dateIso}-${entry.what}`}>
                <span className={styles.when}>{entry.when}</span>
                <span className={styles.what}>{entry.what}</span>
                <span className={styles.tag}>{entry.tag}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
