"use client";

import { useCallback, useEffect, useState } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { vacancies } from "@/modules/content/demo";
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

const vacancyTitle = (slug: string) => vacancies.find((vacancy) => vacancy.slug === slug)?.title ?? slug;

/**
 * Staff recruitment queue. The server renders the fixture rows as the
 * `initial` state (SSR-safe); on mount the queue refreshes from
 * `careersService.listStaffRecords()` so staff decisions and applications
 * submitted in this browser session appear here too. All data is fictional.
 */
export function CareersQueue({ initial }: { initial: JobApplicationRecord[] }) {
  const [records, setRecords] = useState<JobApplicationRecord[]>(initial);
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

  return (
    <>
      <div className="table--scroll">
        <table className={`table ${styles.queueTable}`}>
          <thead>
            <tr>
              <th scope="col">Ref</th>
              <th scope="col">Candidate</th>
              <th scope="col">Vacancy</th>
              <th scope="col">Submitted</th>
              <th scope="col">Status</th>
              <th scope="col">Reviewer</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.ref} className={styles.queueRow}>
                <td>
                  <a className={styles.rowLink} href={`/staff/careers/${record.ref}`}>
                    <strong className="num">{record.ref}</strong>
                  </a>
                </td>
                <td>{record.name}</td>
                <td>{vacancyTitle(record.vacancySlug)}</td>
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
      {refreshing ? (
        <p className="field-help" aria-live="polite">
          Refreshing queue from the demo session…
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
