"use client";

import { useCallback, useEffect, useState } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { formatKolkata } from "@/modules/iot/domain";
import {
  applicationReviewer,
  careersService,
  type JobApplicationRecord,
  type JobApplicationStatus,
} from "@/modules/services/careers";

import styles from "@/app/staff/careers/page.module.css";
import jobStyles from "@/components/staff/JobReview.module.css";

const STATUS_TONE: Record<JobApplicationStatus, StatusTone> = {
  Submitted: "neutral",
  "Eligibility review": "watch",
  Shortlisted: "watch",
  Interview: "watch",
  Offered: "good",
  "Not selected": "neutral",
  Withdrawn: "neutral",
};

type FilterKey = "all" | JobApplicationStatus;

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "Submitted", label: "Submitted" },
  { key: "Eligibility review", label: "Eligibility" },
  { key: "Shortlisted", label: "Shortlisted" },
  { key: "Interview", label: "Interview" },
  { key: "Offered", label: "Offered" },
  { key: "Not selected", label: "Not selected" },
  { key: "Withdrawn", label: "Withdrawn" },
];

/**
 * Staff recruitment queue. Vacancy titles arrive from the owning server
 * loader/service; this component never imports fixture records.
 */
export function CareersQueue({ initial, vacancyTitles, demoMode }: { initial: JobApplicationRecord[]; vacancyTitles: Record<string, string>; demoMode: boolean }) {
  const [records, setRecords] = useState<JobApplicationRecord[]>(initial);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setError(null);
    return careersService
      .listStaffRecords()
      .then((rows) => setRecords(rows))
      .catch(() => setError("The queue could not be refreshed right now."))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = filter === "all" ? records : records.filter((record) => record.status === filter);

  return (
    <>
      <div className="tabs" role="group" aria-label="Filter applications by status">
        {FILTERS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-pressed={filter === tab.key}
            className={filter === tab.key ? "active" : undefined}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
            <span className={`num ${styles.tabCount}`}>
              {tab.key === "all" ? records.length : records.filter((record) => record.status === tab.key).length}
            </span>
          </button>
        ))}
      </div>

      <div className="table--scroll">
        <table className={`table ${styles.queueTable}`}>
          <thead>
            <tr>
              <th scope="col">Ref</th>
              <th scope="col">Candidate</th>
              <th scope="col">Vacancy</th>
              <th scope="col" className="num">Submitted</th>
              <th scope="col">Status</th>
              <th scope="col">Reviewer</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((record) => (
              <tr key={record.ref} className={styles.queueRow}>
                <td>
                  <a className={styles.rowLink} href={`/staff/careers/${record.ref}`}>
                    <strong className="num">{record.ref}</strong>
                  </a>
                </td>
                <td>{record.name}</td>
                <td>{vacancyTitles[record.vacancySlug] ?? record.vacancySlug}</td>
                <td className="num">{formatKolkata(record.submittedAtIso, { format: "day" })}</td>
                <td>
                  <StatusBadge tone={STATUS_TONE[record.status]}>{record.status}</StatusBadge>
                </td>
                <td>{applicationReviewer(record) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 ? <p className="field-help">No applications in this view.</p> : null}
      {refreshing ? (
        <p className="field-help" aria-live="polite">
          {demoMode ? "Refreshing queue from the demo service…" : "Refreshing authorized recruitment queue…"}
        </p>
      ) : null}
      {error ? (
        <div className={jobStyles.refreshErrorRow}>
          <p className="field-error" role="alert">
            {error}
          </p>
          <Button variant="quiet" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      ) : null}
    </>
  );
}
