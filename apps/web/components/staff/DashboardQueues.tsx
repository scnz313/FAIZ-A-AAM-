import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { admissionsQueueCounts, staffApplications } from "@/modules/admissions/demo";
import { jobApplications, vacancies, type JobApplicationRow } from "@/modules/content/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { canRole } from "@/modules/services/staff-authorization";
import type { ApplicationStatus } from "@/modules/admissions/demo";

import styles from "./DashboardQueues.module.css";

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
};

const JOB_TONE: Record<JobApplicationRow["status"], StatusTone> = {
  Submitted: "neutral",
  "Eligibility review": "watch",
  Shortlisted: "watch",
  Interview: "watch",
  Offered: "good",
  "Not selected": "neutral",
};

const vacancyTitle = (slug: string) => vacancies.find((vacancy) => vacancy.slug === slug)?.title ?? slug;

/** Two ruled queue panels on the staff home: admissions and careers, shown
    only for roles whose workspace can act on them (I4). */
export function DashboardQueues() {
  const { summary } = useStaffContext();
  const role = summary?.role ?? "";
  const showAdmissions = canRole(role, "admissions.view");
  const showCareers = canRole(role, "careers.view");
  if (!showAdmissions && !showCareers) return null;

  const admissions = staffApplications.slice(0, 4);
  const jobs = jobApplications.slice(0, 4);

  return (
    <div className={styles.queues}>
      {showAdmissions ? (
        <section className="panel" aria-labelledby="adm-queue-heading">
        <div className={styles.sectionHead}>
          <h2 id="adm-queue-heading" className="section-label">
            Admissions queue
          </h2>
          <span className={`num ${styles.count}`}>{admissionsQueueCounts.pendingReview} queued</span>
        </div>
        <ul className={styles.list}>
          {admissions.map((row) => (
            <li key={row.ref} className={styles.row}>
              <a className={styles.rowLink} href={`/staff/admissions/${row.ref}`}>
                <span className={styles.rowMain}>
                  <strong className="num">{row.ref}</strong>
                  <span>
                    {row.studentName}
                    {row.flagged ? <span className={styles.flag}> · flagged</span> : null}
                  </span>
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
          <span className={`num ${styles.count}`}>{jobs.length} recent</span>
        </div>
        <ul className={styles.list}>
          {jobs.map((row) => (
            <li key={row.ref} className={styles.row}>
              <a className={styles.rowLink} href={`/staff/careers/${row.ref}`}>
                <span className={styles.rowMain}>
                  <strong className="num">{row.ref}</strong>
                  <span>{row.name}</span>
                  <span className={styles.muted}>{vacancyTitle(row.vacancySlug)}</span>
                </span>
                <StatusBadge tone={JOB_TONE[row.status]}>{row.status}</StatusBadge>
              </a>
            </li>
          ))}
        </ul>
        <p className={styles.asOf}>submitted {formatKolkata(jobs[0]?.submittedAtIso ?? "", { format: "day" })} onwards</p>
        <a className="link-arrow" href="/staff/careers">
          View all applications →
        </a>
      </section>
      ) : null}
    </div>
  );
}
