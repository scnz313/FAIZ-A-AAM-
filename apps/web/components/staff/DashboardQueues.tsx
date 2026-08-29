import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { formatKolkata } from "@/modules/iot/domain";
import { canRole } from "@/modules/services/staff-authorization";
import { admissionsService, type StaffQueueRecord } from "@/modules/services/admissions";
import { careersService, type JobApplicationRecord, type JobApplicationStatus } from "@/modules/services/careers";
import { useEffect, useState } from "react";

import styles from "./DashboardQueues.module.css";

type ApplicationStatus = StaffQueueRecord["status"];
const ADMISSION_TONE: Record<ApplicationStatus, StatusTone> = {
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

const JOB_TONE: Record<JobApplicationStatus, StatusTone> = {
  Submitted: "neutral",
  "Eligibility review": "watch",
  Shortlisted: "watch",
  Interview: "watch",
  Offered: "good",
  "Not selected": "neutral",
  Withdrawn: "neutral",
};

/** Two ruled queue panels on the staff home: admissions and careers, shown
    only for roles whose workspace can act on them (I4). */
export function DashboardQueues() {
  const { summary } = useStaffContext();
  const role = summary?.role ?? "";
  const showAdmissions = canRole(role, "admissions.view");
  const showCareers = canRole(role, "careers.view");
  const [admissions, setAdmissions] = useState<StaffQueueRecord[]>([]);
  const [jobs, setJobs] = useState<JobApplicationRecord[]>([]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([showAdmissions ? admissionsService.listStaffRecords() : Promise.resolve([]), showCareers ? careersService.listStaffRecords() : Promise.resolve([])])
      .then(([admissionRows, jobRows]) => {
        if (!cancelled) {
          setAdmissions(admissionRows.slice(0, 4));
          setJobs(jobRows.slice(0, 4));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdmissions([]);
          setJobs([]);
        }
      });
    return () => { cancelled = true; };
  }, [showAdmissions, showCareers]);
  if (!showAdmissions && !showCareers) return null;
  /* Honest queue size: everything still moving, not just the rows shown. */
  const jobsOpen = jobs.filter(
    (row) => row.status !== "Offered" && row.status !== "Not selected",
  ).length;

  return (
    <div className={styles.queues}>
      {showAdmissions ? (
        <section className="panel" aria-labelledby="adm-queue-heading">
        <div className={styles.sectionHead}>
          <h2 id="adm-queue-heading" className="section-label">
            Admissions queue
          </h2>
          <span className={`num ${styles.count}`}>{admissions.length} queued</span>
        </div>
        <ul className={styles.list}>
          {admissions.map((row) => (
            <li key={row.ref} className={styles.row}>
              <a className={styles.rowLink} href={`/staff/admissions/${row.ref}`}>
                <span className={styles.rowMain}>
                  <strong className="num">{row.ref}</strong>
                  <span>{row.studentName}</span>
                  <span className={styles.muted}>{row.grade}</span>
                </span>
                <StatusBadge tone={ADMISSION_TONE[row.status]}>{row.status}</StatusBadge>
              </a>
            </li>
          ))}
        </ul>
        <a className="link-arrow" href="/staff/admissions">
          View all applications →
        </a>
      </section>
      ) : null}

      {showCareers ? (
        <section className="panel" aria-labelledby="job-queue-heading">
        <div className={styles.sectionHead}>
          <h2 id="job-queue-heading" className="section-label">
            Careers queue
          </h2>
          <span className={`num ${styles.count}`}>{jobsOpen} open</span>
        </div>
        <ul className={styles.list}>
          {jobs.map((row) => (
            <li key={row.ref} className={styles.row}>
              <a className={styles.rowLink} href={`/staff/careers/${row.ref}`}>
                <span className={styles.rowMain}>
                  <strong className="num">{row.ref}</strong>
                  <span>{row.name}</span>
                  <span className={styles.muted}>{row.vacancySlug}</span>
                </span>
                <StatusBadge tone={JOB_TONE[row.status]}>{row.status}</StatusBadge>
              </a>
            </li>
          ))}
        </ul>
        <p className={styles.asOf}>{jobs[0]?.submittedAtIso ? `submitted ${formatKolkata(jobs[0].submittedAtIso, { format: "day" })} onwards` : "No career applications in this scope."}</p>
        <a className="link-arrow" href="/staff/careers">
          View all applications →
        </a>
      </section>
      ) : null}
    </div>
  );
}
