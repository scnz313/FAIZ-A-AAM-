import type { Metadata } from "next";

import { CareersQueue } from "@/components/staff/CareersQueue";
import { CONTENT_DEMO_NOTE, jobApplications, vacancies } from "@/modules/content/demo";
import { fixtureApplicationRecord, type JobApplicationRecord } from "@/modules/services/careers";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Careers · Staff",
};

const vacancyTitle = (slug: string) => vacancies.find((vacancy) => vacancy.slug === slug)?.title ?? slug;

/** Server-rendered starting point; the queue refreshes from the demo session on mount. */
const initialRecords: JobApplicationRecord[] = jobApplications
  .map((row) => fixtureApplicationRecord(row.ref))
  .filter((record): record is JobApplicationRecord => record !== null)
  .sort((a, b) => b.submittedAtIso.localeCompare(a.submittedAtIso));

export default function CareersPage() {
  const open = vacancies.filter((vacancy) => vacancy.status === "open");
  const closed = vacancies.length - open.length;
  const nearestDeadlineIso = open.map((vacancy) => vacancy.deadlineIso).sort()[0];

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Careers</p>
        <h1 className="workspace-title">Careers</h1>
        <p className="workspace-intro">Recruitment queue by vacancy.</p>
        <p className={styles.summary}>
          <strong className="num">{open.length}</strong> open · <strong className="num">{closed}</strong> closed ·
          nearest deadline{" "}
          <strong className="num">
            {nearestDeadlineIso ? formatKolkata(nearestDeadlineIso, { format: "day" }) : "—"}
          </strong>
        </p>
      </header>

      <section aria-labelledby="queue-heading">
        <div className={styles.sectionHead}>
          <h2 id="queue-heading" className="section-label">
            Recruitment queue
          </h2>
          <span className="demo-badge">Demo data</span>
        </div>
        <CareersQueue initial={initialRecords} />
      </section>

      <div className={styles.ruleNote}>
        <p>{CONTENT_DEMO_NOTE}</p>
      </div>
    </div>
  );
}
