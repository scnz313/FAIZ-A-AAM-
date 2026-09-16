"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import Button from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { formatKolkata } from "@/modules/iot/domain";
import {
  applicationReviewer,
  careersService,
  type JobApplicationRecord,
  type JobApplicationStatus,
} from "@/modules/services/careers";

import styles from "./CareersQueue.module.css";

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
 * Reviewer column value. The live staff projection carries the assigned
 * reviewer account id but not their directory name, so the queue states the
 * assignment honestly instead of borrowing the last recorded actor (which
 * read as a reviewer). Demo fixtures keep their named timeline actor.
 * Exported for the regression test.
 */
export function queueReviewerLabel(
  record: Pick<JobApplicationRecord, "reviewerAccountId" | "timeline">,
  demoMode: boolean,
): string {
  if (demoMode) return applicationReviewer(record) ?? "—";
  return record.reviewerAccountId !== undefined && record.reviewerAccountId !== "" ? "Assigned reviewer" : "—";
}

/**
 * Staff recruitment queue. Vacancy titles arrive from the owning server
 * loader/service; this component never imports fixture records.
 */
export function CareersQueue({
  initial,
  vacancyTitles,
  demoMode,
}: {
  initial: JobApplicationRecord[];
  vacancyTitles: Record<string, string>;
  demoMode: boolean;
}) {
  const { summary } = useStaffContext();
  const profileCode = summary?.profileCode ?? null;
  const [records, setRecords] = useState<JobApplicationRecord[]>(initial);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(demoMode);
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
    if (!demoMode) {
      setRecords(initial);
      setRefreshing(false);
      setError(null);
      return;
    }
    void refresh();
  }, [demoMode, initial, refresh]);

  const counts = useMemo(() => {
    const byStatus = Object.fromEntries(
      FILTERS.filter((tab) => tab.key !== "all").map((tab) => [tab.key, 0]),
    ) as Record<JobApplicationStatus, number>;
    for (const record of records) {
      byStatus[record.status] += 1;
    }
    return { all: records.length, ...byStatus };
  }, [records]);

  const stageFiltered = filter === "all" ? records : records.filter((record) => record.status === filter);
  const searchLower = search.trim().toLowerCase();
  const visible = searchLower === ""
    ? stageFiltered
    : stageFiltered.filter((record) => {
        const vacancy = vacancyTitles[record.vacancySlug] ?? record.vacancySlug;
        return (
          record.ref.toLowerCase().includes(searchLower) ||
          record.name.toLowerCase().includes(searchLower) ||
          vacancy.toLowerCase().includes(searchLower)
        );
      });

  return (
    <>
      <div className={`toolbar ${styles.toolbar}`}>
        <div className="seg x-scroll" role="group" aria-label="Filter applications by status">
          {FILTERS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={filter === tab.key}
              className={filter === tab.key ? "on" : undefined}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
              <span className={`num ${styles.tabCount}`}>{counts[tab.key]}</span>
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="search">
          <span className={`msym ${styles.searchIcon}`} aria-hidden="true">
            search
          </span>
          <input
            className="input"
            placeholder="Reference, candidate, vacancy…"
            aria-label="Search applications"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {refreshing ? (
        <p className={styles.statusLine} role="status" aria-live="polite">
          {demoMode ? "Refreshing queue from the demo service…" : "Refreshing authorized recruitment queue…"}
        </p>
      ) : null}

      {error ? (
        <div className={styles.refreshRow}>
          <p className="field-error" role="alert">
            {error}
          </p>
          <Button variant="quiet" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <section className="panel">
          <div className="pn-body">
            <div className={styles.emptyState}>
              <div className={`empty-ill ${styles.emptyIll}`}>
                <span className={`msym ${styles.emptyIcon}`}>work</span>
              </div>
              <div className={`strong ${styles.emptyTitle}`}>Nothing in this view right now</div>
              <p className={`muted small ${styles.emptyCopy}`}>
                Applications move through recruitment stages; this filter is empty at the moment.
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
              >
                Show all applications
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel" aria-labelledby="careers-queue-heading">
          <div className="pn-head">
            <div>
              <h2 id="careers-queue-heading">Recruitment queue</h2>
              <p className="sub">{visible.length} in this view</p>
            </div>
            {demoMode ? <span className="demo-badge">Demo data</span> : null}
          </div>
          <div className="pn-body flush">
            <div className={styles.queueViewport}>
              <div className={styles.queueInner}>
                <div className={styles.qHead}>
                  <span>Candidate</span>
                  <span>Vacancy</span>
                  <span>Submitted</span>
                  <span>Status</span>
                  <span>Reviewer</span>
                  <span className={styles.actionHead}>Action</span>
                </div>
                <div className={styles.queue}>
                  {visible.map((record) => (
                    <div key={record.ref} className={styles.qRow}>
                      <div className={styles.qCandidate}>
                        <div className={`q-t num ${styles.qTitle}`}>{record.ref}</div>
                        <div className={`q-s ${styles.qSub}`}>{record.name}</div>
                      </div>
                      <div className={styles.qVacancy}>{vacancyTitles[record.vacancySlug] ?? record.vacancySlug}</div>
                      <div className={`num ${styles.qDate}`}>{formatKolkata(record.submittedAtIso, { format: "day" })}</div>
                      <div className={styles.qStatus}>
                        <StatusBadge tone={STATUS_TONE[record.status]}>{record.status}</StatusBadge>
                      </div>
                      <div className={styles.qReviewer}>{queueReviewerLabel(record, demoMode)}</div>
                      <div className={styles.qAct}>
                        <Link
                          prefetch={false}
                          className="btn btn-ghost btn-sm"
                          href={canonicalStaffUrl(profileCode, `/careers/${record.ref}`)}
                        >
                          Review
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
