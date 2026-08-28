"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import Button from "@/components/ui/Button";
import JobTimeline, { type JobTimelineEvent } from "@/components/applicant/JobTimeline";
import { DemoNotice } from "@/components/layouts/DemoNotice";
import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import PageIntro from "@/components/public/PageIntro";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { careersService, type JobApplicationRecord, type JobApplicationStatus } from "@/modules/services/careers";
import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./page.module.css";

/* ------------------------------------------------------------------ */
/* Timeline derivation from the service record                         */
/* ------------------------------------------------------------------ */

const PRE_DECISION_STAGES = ["Submitted", "Eligibility review", "Shortlisted", "Interview"] as const;

const STAGE_NOTES: Record<string, string> = {
  Submitted: "Application received by the school.",
  "Eligibility review": "Qualifications and documents are checked against the vacancy.",
  Shortlisted: "The candidate has been shortlisted for the next stage.",
  Interview: "Interview and, where relevant, a demonstration.",
  Offered: "An offer has been made to the candidate.",
  "Not selected": "The vacancy has been filled by another candidate.",
};

const STATUS_TONE: Record<JobApplicationStatus, StatusTone> = {
  Submitted: "neutral",
  "Eligibility review": "watch",
  Shortlisted: "watch",
  Interview: "watch",
  Offered: "good",
  "Not selected": "neutral",
  Withdrawn: "neutral",
};

/** Statuses where the applicant may still withdraw. */
const WITHDRAWABLE: readonly JobApplicationStatus[] = [
  "Submitted",
  "Eligibility review",
  "Shortlisted",
  "Interview",
];

function timelineFor(record: JobApplicationRecord): JobTimelineEvent[] {
  /* Withdrawn applications drop the future-stage chain: only the events
     that actually happened remain, ending on the withdrawal. */
  if (record.status === "Withdrawn") {
    return record.timeline.map((event, index) => ({
      id: `${event.status}-${index}`,
      label: event.status,
      note: event.note,
      actor: event.actor,
      time: formatKolkata(event.atIso, { format: "full" }),
      state: index === record.timeline.length - 1 ? "current" : "done",
    }));
  }
  const terminal: JobApplicationStatus | "Offered / Not selected" =
    record.status === "Offered" || record.status === "Not selected" ? record.status : "Offered / Not selected";
  const chain = [...PRE_DECISION_STAGES, terminal];
  const currentIdx = chain.indexOf(record.status);
  return chain.map((label, i) => {
    const event = record.timeline.find((e) => e.status === label);
    return {
      id: label,
      label,
      note:
        label === "Offered / Not selected"
          ? "The panel's decision has not been recorded yet."
          : STAGE_NOTES[label],
      actor: event?.actor,
      time: event ? formatKolkata(event.atIso, { format: "full" }) : undefined,
      state: i < currentIdx ? "done" : i === currentIdx ? "current" : "pending",
    };
  });
}

/* ------------------------------------------------------------------ */
/* Status view                                                         */
/* ------------------------------------------------------------------ */

/**
 * Applicant-facing vacancy application status. Reads the record through
 * the careers service on mount (fixture references and session-submitted
 * applications resolve; everything else shows the honest not-in-records
 * state) and supports withdrawal with confirmation.
 */
export default function JobStatusView({ initial, initialVacancyTitle }: { initial?: JobApplicationRecord | null; initialVacancyTitle?: string | null }) {
  const params = useParams<{ slug: string }>();
  const applicationRef = params.slug ?? "";

  const [loading, setLoading] = useState(initial === undefined);
  const [record, setRecord] = useState<JobApplicationRecord | null>(initial ?? null);
  const [vacancyTitle, setVacancyTitle] = useState<string | null>(initialVacancyTitle ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const application = await careersService.getApplication(applicationRef);
      const vacancy = application ? await careersService.getVacancy(application.vacancySlug) : null;
      setRecord(application);
      setVacancyTitle(vacancy?.title ?? null);
    } catch {
      setLoadError("We could not load this application right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [applicationRef]);

  useEffect(() => {
    if (initial !== undefined) return;
    void load();
  }, [load, initial]);

  async function handleWithdraw() {
    if (!record || withdrawing) return;
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      const updated = await careersService.withdraw(record.ref, record.name);
      setRecord(updated);
      setConfirmingWithdraw(false);
    } catch {
      setWithdrawError("We could not record the withdrawal. Please try again.");
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <div className={styles.frame}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1}>
        {loading ? (
          <div className={styles.page}>
            <p className={styles.loadingLine} aria-live="polite">
              Loading application…
            </p>
          </div>
        ) : null}

        {!loading && loadError ? (
          <div className={styles.page}>
            <p className={styles.errorLine} role="alert">
              {loadError}
            </p>
            <div className={styles.retryRow}>
              <Button variant="quiet" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          </div>
        ) : null}

        {!loading && !loadError && !record ? (
          <div className={styles.page}>
            <PageIntro
              eyebrow="Careers · Application status"
              title={`Application ${applicationRef}`}
              deck="This reference is not in the school's records."
            />
            <div className={styles.section}>
              <div className={`panel ${styles.timelinePanel}`}>
                <JobTimeline
                  events={[
                    {
                      id: "submitted",
                      label: "Submitted",
                      note: "Application received by the school.",
                      state: "done",
                    },
                    {
                      id: "eligibility",
                      label: "Eligibility review",
                      note: "Awaiting review by the recruitment panel.",
                      state: "pending",
                    },
                  ]}
                />
              </div>

              <div className={styles.keepSafe}>
                <p className={styles.keepSafeTitle}>Keep this reference safe</p>
                <p className={styles.keepSafeText}>
                  Applications are tracked by reference only. If you have just submitted, it may take a short while
                  for the application to appear. If you believe this is an error, contact the school office.
                </p>
              </div>

              <DemoNotice className={styles.demoNote}>{CONTENT_DEMO_NOTE}</DemoNotice>
            </div>
          </div>
        ) : null}

        {!loading && !loadError && record ? (
          <div className={styles.page}>
            <PageIntro
              eyebrow="Careers · Application status"
              title={`Application ${record.ref}`}
              deck={`${record.name} · ${vacancyTitle ?? "Vacancy"}`}
            />
            <div className={styles.section}>
              <div className={styles.statusRow}>
                <p className="kicker">Current status</p>
                <StatusBadge tone={STATUS_TONE[record.status]}>{record.status}</StatusBadge>
              </div>

              <div className={`panel ${styles.timelinePanel}`}>
                <JobTimeline events={timelineFor(record)} />
              </div>

              {record.status === "Interview" ? (
                <div className={`panel ${styles.interviewPanel}`}>
                  <p className="kicker">Interview</p>
                  <h2 className={styles.interviewTitle}>Interview</h2>
                  {record.interview ? (
                    <>
                      <p className={styles.interviewLine}>
                        Date &amp; time: <span className="num">{formatKolkata(record.interview.atIso, { format: "full" })}</span>
                      </p>
                      {record.interview.note ? <p className={styles.interviewLine}>{record.interview.note}</p> : null}
                    </>
                  ) : (
                    <p className={styles.interviewLine}>Interview details will appear here.</p>
                  )}
                  <p className={styles.interviewNote}>
                    Bring the documents listed in the vacancy. Internal review notes are never shown to applicants.
                  </p>
                </div>
              ) : null}

              {record.status === "Withdrawn" ? (
                <div className={styles.withdrawnNote}>
                  <p className={styles.withdrawnTitle}>Application withdrawn</p>
                  <p className={styles.withdrawnText}>
                    This application is closed. Your details will be retained for the period stated in the vacancy,
                    then deleted or anonymised.
                  </p>
                </div>
              ) : null}

              {WITHDRAWABLE.includes(record.status) ? (
                <div className={styles.withdrawBlock}>
                  {confirmingWithdraw ? (
                    <div role="group" aria-label="Confirm withdrawal">
                      <p className={styles.withdrawConfirmTitle}>Withdraw this application?</p>
                      <p className={styles.withdrawConfirmText}>
                        Withdrawing closes your application for this vacancy. The panel will stop reviewing it.
                      </p>
                      <div className={styles.withdrawActions}>
                        <Button variant="danger" disabled={withdrawing} onClick={() => void handleWithdraw()}>
                          {withdrawing ? "Withdrawing…" : "Confirm withdrawal"}
                        </Button>
                        <Button variant="quiet" disabled={withdrawing} onClick={() => setConfirmingWithdraw(false)}>
                          Cancel
                        </Button>
                      </div>
                      {withdrawError ? (
                        <p className={styles.withdrawError} role="alert">
                          {withdrawError}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <Button variant="quiet" onClick={() => setConfirmingWithdraw(true)}>
                        Withdraw application
                      </Button>
                      <p className={styles.withdrawHint}>
                        Withdrawing closes your application for this vacancy and cannot be undone.
                      </p>
                    </>
                  )}
                </div>
              ) : null}

              <p className={styles.noteLine}>
                Internal review notes are never shown to applicants. Status messages reflect only the stage your
                application has reached.
              </p>

              <DemoNotice className={styles.demoNote}>{CONTENT_DEMO_NOTE}</DemoNotice>
            </div>
          </div>
        ) : null}
      </main>
      <PublicFooter />
    </div>
  );
}
