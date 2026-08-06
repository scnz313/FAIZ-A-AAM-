"use client";

import { useEffect, useState } from "react";

import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { formatKolkata } from "@/modules/iot/domain";
import type { ApplicationStatus } from "@/modules/admissions/demo";
import { admissionsService, type StaffQueueRecord } from "@/modules/services/admissions";

import styles from "./AdmissionsQueue.module.css";

const STATUS_TONE: Record<ApplicationStatus, StatusTone> = {
  Draft: "neutral",
  Submitted: "neutral",
  "Under review": "watch",
  "Changes requested": "alert",
  Assessment: "watch",
  Offered: "good",
  Waitlisted: "watch",
  Declined: "neutral",
  Enrolled: "good",
};

const FILTERS: ReadonlyArray<{ key: "all" | ApplicationStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "Submitted", label: "Submitted" },
  { key: "Under review", label: "Under review" },
  { key: "Assessment", label: "Assessment" },
  { key: "Offered", label: "Offered" },
];

/**
 * Staff admissions queue. The server renders the initial rows; on mount the
 * component refreshes from the admissions service so decisions recorded
 * earlier in the demo session (and applications submitted by applicants in
 * the same session) show here with their real status.
 */
export function AdmissionsQueue({ rows }: { rows: StaffQueueRecord[] }) {
  const [filter, setFilter] = useState<"all" | ApplicationStatus>("all");
  const [liveRows, setLiveRows] = useState<StaffQueueRecord[]>(rows);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    admissionsService
      .listStaffRecords()
      .then((records) => {
        if (!cancelled) setLiveRows(records);
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = filter === "all" ? liveRows : liveRows.filter((row) => row.status === filter);

  return (
    <section aria-labelledby="queue-heading">
      <div className={styles.sectionHead}>
        <h2 id="queue-heading" className="section-label">
          Application queue
        </h2>
        <span className="demo-badge">Demo data</span>
      </div>

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
            <span className={`num ${styles.tabCount}`}>{tab.key === "all" ? liveRows.length : liveRows.filter((r) => r.status === tab.key).length}</span>
          </button>
        ))}
      </div>

      {refreshing ? (
        <p className={styles.empty} role="status">
          Refreshing from the demo session…
        </p>
      ) : null}

      <div className="table--scroll">
        <table className={`table ${styles.queueTable}`}>
          <thead>
            <tr>
              <th scope="col">Ref</th>
              <th scope="col">Student</th>
              <th scope="col">Grade</th>
              <th scope="col">Submitted</th>
              <th scope="col">Status</th>
              <th scope="col">Reviewer</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.ref} className={row.flagged ? styles.flaggedRow : undefined}>
                <td>
                  <a className={styles.rowLink} href={`/staff/admissions/${row.ref}`}>
                    <strong className="num">{row.ref}</strong>
                  </a>
                </td>
                <td>
                  {row.studentName}
                  {row.flagged ? <span className={styles.flag}> · flagged</span> : null}
                </td>
                <td>{row.grade}</td>
                <td className="num">{formatKolkata(row.submittedAtIso, { format: "day" })}</td>
                <td>
                  <StatusBadge tone={STATUS_TONE[row.status]}>{row.status}</StatusBadge>
                </td>
                <td>{row.reviewer ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible.length === 0 ? <p className={styles.empty}>No applications in this view.</p> : null}
    </section>
  );
}
