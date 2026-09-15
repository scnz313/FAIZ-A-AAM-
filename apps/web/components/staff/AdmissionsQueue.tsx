"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
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

const STAGES: ReadonlyArray<{ key: "all" | ApplicationStatus; label: string }> = [
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
 * Staff admissions queue — V14 aligned. Uses a toolbar with seg filter +
 * search, then a Panel with flush q-head + q-row items. Each q-row has:
 * application (ref + name + grade), stage, status, and a Review action.
 * The server renders the initial rows; in demo mode the component
 * refreshes from the admissions service on mount so decisions recorded
 * earlier in the session show here with their real status.
 */
export function AdmissionsQueue({ rows }: { rows: StaffQueueRecord[] }) {
  const { summary } = useStaffContext();
  const profileCode = summary?.profileCode ?? null;
  const supabaseMode = clientAdapterMode() === "supabase";
  const [stage, setStage] = useState<"all" | ApplicationStatus>("all");
  const [search, setSearch] = useState("");
  const [liveRows, setLiveRows] = useState<StaffQueueRecord[]>(rows);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (supabaseMode) {
      /* The SSR rows paint first; one silent re-read then replaces them so a
         decision recorded in another tab appears. A failed refresh keeps the
         current rows and intentionally shows no error banner. */
      admissionsService
        .listStaffRecords()
        .then((records) => {
          if (!cancelled) setLiveRows(records);
        })
        .catch(() => {
          /* Freshness only — the SSR rows stay on screen. */
        });
      return () => {
        cancelled = true;
      };
    }
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

  const stageFiltered = stage === "all" ? liveRows : liveRows.filter((row) => row.status === stage);
  const searchLower = search.trim().toLowerCase();
  const visible = searchLower === ""
    ? stageFiltered
    : stageFiltered.filter((row) =>
        row.ref.toLowerCase().includes(searchLower) ||
        row.studentName.toLowerCase().includes(searchLower) ||
        row.grade.toLowerCase().includes(searchLower)
      );

  return (
    <>
      {/* V14 toolbar: seg filter + search */}
      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="Stage filter">
          {STAGES.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={stage === s.key}
              className={stage === s.key ? "on" : undefined}
              onClick={() => setStage(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="search">
          <span className="msym" aria-hidden="true" style={{ fontSize: 19, color: "var(--muted)" }}>search</span>
          <input
            className="input"
            placeholder="Reference, student, grade…"
            aria-label="Search applications"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {refreshing ? (
        <p className={styles.empty} role="status">
          {supabaseMode ? "Refreshing the queue…" : "Refreshing from the demo session…"}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <section className="panel">
          <div className="pn-body">
            <div style={{ textAlign: "center", padding: "42px 18px" }}>
              <div className="empty-ill" style={{ margin: "0 auto 12px" }}>
                <span className="msym" style={{ fontSize: 26 }}>filter_alt</span>
              </div>
              <div className="strong" style={{ fontSize: "1.02rem" }}>Nothing in this stage right now</div>
              <p className="muted small" style={{ margin: "6px auto 14px", maxWidth: 340 }}>
                Applications move through stages; this one is empty at the moment.
              </p>
              <button className="btn btn-ghost btn-sm" onClick={() => { setStage("all"); setSearch(""); }}>
                Show all stages
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="pn-body flush">
            {/* V14 q-head */}
            <div className={styles.qHead}>
              <span>Application</span>
              <span>Stage</span>
              <span>Status</span>
              <span style={{ textAlign: "right" }}>Action</span>
            </div>
            {/* V14 queue with q-row items */}
            <div className={styles.queue}>
              {visible.map((row) => (
                <div key={row.ref} className={styles.qRow}>
                  <div>
                    <div className={`q-t num ${styles.qTitle}`}>
                      {row.ref} · {row.studentName}
                    </div>
                    <div className={`q-s ${styles.qSub}`}>
                      {row.grade} · session {row.session}
                      {row.flagged ? " · flagged" : ""}
                    </div>
                  </div>
                  <div className={`q-m ${styles.qStage}`}>{row.status}</div>
                  <div>
                    <StatusBadge tone={STATUS_TONE[row.status]}>{row.status}</StatusBadge>
                  </div>
                  <div className={styles.qAct}>
                    <Link
                      prefetch={false}
                      className="btn btn-ghost btn-sm"
                      href={canonicalStaffUrl(profileCode, `/admissions/${row.ref}`)}
                    >
                      Review
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
