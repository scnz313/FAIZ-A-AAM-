import type { Metadata } from "next";

import { CareersQueue } from "@/components/staff/CareersQueue";
import { careersService } from "@/modules/services/careers";
import { formatKolkata } from "@/modules/iot/domain";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerJobs, loadServerVacancies } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Careers",
};

export default async function CareersPage() {
  const serverMode = dataAdapter() === "supabase";
  const [allVacancies, initialRecords] = serverMode
    ? await Promise.all([loadServerVacancies(), loadServerJobs()])
    : await Promise.all([careersService.listVacancies(), careersService.listStaffRecords()]);
  const vacancyTitles = Object.fromEntries(allVacancies.map((vacancy) => [vacancy.slug, vacancy.title]));
  const open = allVacancies.filter((vacancy) => vacancy.status === "open");
  const closed = allVacancies.length - open.length;
  const nearestDeadlineIso = open.map((vacancy) => vacancy.deadlineIso).sort()[0];

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Careers</h1>
          <p className="ph-sub">Recruitment pipeline. Scorecards and panel notes are visible to staff with HR roles only.</p>
        </div>
      </div>

      <section className="panel" aria-label="Vacancy summary">
        <div className={`pn-body flush ${styles.stats}`}>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Open vacancies</span>
            <span className={`num ${styles.statValue}`}>{open.length}</span>
          </div>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Closed vacancies</span>
            <span className={`num ${styles.statValue}`}>{closed}</span>
          </div>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Nearest deadline</span>
            <span className={`num ${styles.statValue}`}>
              {nearestDeadlineIso ? formatKolkata(nearestDeadlineIso, { format: "day" }) : "—"}
            </span>
            {nearestDeadlineIso ? <span className={styles.statNote}>For open roles only</span> : null}
          </div>
        </div>
      </section>

      <CareersQueue initial={initialRecords} vacancyTitles={vacancyTitles} demoMode={!serverMode} />

      {!serverMode ? <p className="demo-note">Demo session · every application above is fictional concept data.</p> : null}
    </div>
  );
}
