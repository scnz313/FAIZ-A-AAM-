"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { formatKolkata } from "@/modules/iot/domain";
import type { ApplicationStatus } from "@/modules/admissions/demo";
import { admissionsService, type StaffQueueRecord } from "@/modules/services/admissions";
import { clientAdapterMode } from "@/modules/services/adapter-client";

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
  Withdrawn: "neutral",
};

const FILTERS: ReadonlyArray<{ key: "all" | ApplicationStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "Submitted", label: "Submitted" },
  { key: "Under review", label: "Under review" },
  { key: "Changes requested", label: "Changes requested" },
  { key: "Assessment", label: "Assessment" },
  { key: "Offered", label: "Offered" },
  { key: "Waitlisted", label: "Waitlisted" },
  { key: "Declined", label: "Declined" },
  { key: "Enrolled", label: "Enrolled" },
  { key: "Withdrawn", label: "Withdrawn" },
];

/**
 * Staff admissions queue. The server renders the initial rows; in demo mode
 * the component refreshes from the admissions service on mount so decisions
 * recorded earlier in the session (and applications submitted by applicants
 * in the same session) show here with their real status.
 */
export function AdmissionsQueue({ rows }: { rows: StaffQueueRecord[] }) {
  const { summary } = useStaffContext();
  const profileCode = summary?.profileCode ?? null;
  const supabaseMode = clientAdapterMode() === "supabase";
  const [filter, setFilter] = useState<"all" | ApplicationStatus>("all");
  const [liveRows, setLiveRows] = useState<StaffQueueRecord[]>(rows);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (supabaseMode) {
      setLiveRows(rows);
      return;
    }
    let cancelled = false;
    setRefreshing(true);
    admissionsService
      .listStaffRecords()
      .then((records) => {
        if (!cancelled) setLiveRows(records);
      })
      .catch(() => {
        if (!cancelled) setLiveRows(rows);
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rows, supabaseMode]);

  const visible = filter === "all" ? liveRows : liveRows.filter((row) => row.status === filter);

  /* Live metrics derived from the service data so session decisions and new
     submissions are reflected immediately. */
  const counts = {
    submitted: liveRows.filter((r) => r.status === "Submitted" || r.status === "Under review").length,
    assessment: liveRows.filter((r) => r.status === "Assessment").length,
    offers: liveRows.filter((r) => r.status === "Offered").length,
    flagged: liveRows.filter((r) => r.flagged).length,
  };

  return (
    <>
      <div className={styles.metrics}>
        <p className={styles.metric}>
          <span className="section-label">Submitted</span>
          <strong className={`num ${styles.metricNum}`}>{counts.submitted}</strong>
        </p>
        <p className={styles.metric}>
          <span className="section-label">Assessment</span>
          <strong className={`num ${styles.metricNum}`}>{counts.assessment}</strong>
        </p>
        <p className={styles.metric}>
          <span className="section-label">Offers</span>
          <strong className={`num ${styles.metricNum}`}>{counts.offers}</strong>
        </p>
        <p className={styles.metric}>
          <span className="section-label">Flagged</span>
          <strong className={`num ${styles.metricNum}`}>{counts.flagged}</strong>
        </p>
      </div>

      <section aria-labelledby="queue-heading">
      <div className={styles.sectionHead}>
        <h2 id="queue-heading" className="section-label">
          Application queue
        </h2>
        {!supabaseMode ? <span className="demo-badge">Demo data</span> : null}
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
          {supabaseMode ? "Refreshing the queue…" : "Refreshing from the demo session…"}
        </p>
      ) : null}

      <div className="table--scroll">
        <table className={`table ${styles.queueTable}`}>
          <thead>
            <tr>
              <th scope="col">Ref</th>
              <th scope="col">Student</th>
              <th scope="col">Grade</th>
              <th scope="col" className="num">Submitted</th>
              <th scope="col">Status</th>
              <th scope="col">Reviewer</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.ref} className={row.flagged ? styles.flaggedRow : undefined}>
                <td>
                  <Link prefetch={false} className={styles.rowLink} href={canonicalStaffUrl(profileCode, `/admissions/${row.ref}`)}>
                    <strong className="num">{row.ref}</strong>
                  </Link>
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
    </>
  );
}
