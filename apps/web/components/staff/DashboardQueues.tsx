import Link from "next/link";

import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { formatKolkata } from "@/modules/iot/domain";
import { canAnyRole } from "@/modules/services/staff-profiles";
import type { StaffQueueRecord } from "@/modules/services/admissions";
import type { JobApplicationRecord, JobApplicationStatus } from "@/modules/services/careers";

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
export function DashboardQueues({ admissions, jobs }: { admissions: StaffQueueRecord[]; jobs: JobApplicationRecord[] }) {
  const { summary } = useStaffContext();
  const profileCode = summary?.profileCode ?? null;
  /* Aggregate authorization: profile accounts check every active grant. */
  const roles = summary?.profileCode === null
    ? (summary?.role ? [summary.role] : [])
    : (summary?.roles ?? []);
  const showAdmissions = canAnyRole(roles, "admissions.view");
  const showCareers = canAnyRole(roles, "careers.view");
  if (!showAdmissions && !showCareers) return null;
  const visibleAdmissions = admissions.slice(0, 4);
  const visibleJobs = jobs.slice(0, 4);
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
          {visibleAdmissions.map((row) => (
            <li key={row.ref} className={styles.row}>
              <Link prefetch={false} className={styles.rowLink} href={canonicalStaffUrl(profileCode, `/admissions/${row.ref}`)}>
                <span className={styles.rowMain}>
                  <strong className="num">{row.ref}</strong>
                  <span>{row.studentName}</span>
                  <span className={styles.muted}>{row.grade}</span>
                </span>
                <StatusBadge tone={ADMISSION_TONE[row.status]}>{row.status}</StatusBadge>
              </Link>
            </li>
          ))}
        </ul>
        <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/admissions")}>
          View all applications →
        </Link>
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
          {visibleJobs.map((row) => (
            <li key={row.ref} className={styles.row}>
              <Link prefetch={false} className={styles.rowLink} href={canonicalStaffUrl(profileCode, `/careers/${row.ref}`)}>
                <span className={styles.rowMain}>
                  <strong className="num">{row.ref}</strong>
                  <span>{row.name}</span>
                  <span className={styles.muted}>{row.vacancySlug}</span>
                </span>
                <StatusBadge tone={JOB_TONE[row.status]}>{row.status}</StatusBadge>
              </Link>
            </li>
          ))}
        </ul>
        <p className={styles.asOf}>{jobs[0]?.submittedAtIso ? `submitted ${formatKolkata(jobs[0].submittedAtIso, { format: "day" })} onwards` : "No career applications in this scope."}</p>
        <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/careers")}>
          View all applications →
        </Link>
      </section>
      ) : null}
    </div>
  );
}
