import type { Metadata } from "next";

import { CareersQueue } from "@/components/staff/CareersQueue";
import { careersService } from "@/modules/services/careers";
import { formatKolkata } from "@/modules/iot/domain";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerJobs, loadServerVacancies } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Careers · Staff",
};

export default async function CareersPage() {
  const serverMode = dataAdapter() === "supabase";
  const [allVacancies, initialRecords] = serverMode
    ? await Promise.all([loadServerVacancies(), loadServerJobs()])
    : await Promise.all([careersService.listVacancies(), careersService.listStaffRecords()]);
  const vacancyTitles = Object.fromEntries(allVacancies.map((vacancy) => [vacancy.slug, vacancy.title]));
  const openVacancies = allVacancies.filter((vacancy) => vacancy.status === "open");
  const open = openVacancies;
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
      <p className={styles.summary}>
        <strong className="num">{open.length}</strong> open · <strong className="num">{closed}</strong> closed
        {nearestDeadlineIso ? (
          <>
            {" "}· nearest deadline{" "}
            <strong className="num">{formatKolkata(nearestDeadlineIso, { format: "day" })}</strong>
          </>
        ) : null}
      </p>

      <section aria-labelledby="queue-heading">
        <div className={styles.sectionHead}>
          <h2 id="queue-heading" className="section-label">
            Recruitment queue
          </h2>
          {!serverMode ? <span className="demo-badge">Demo data</span> : null}
        </div>
        <CareersQueue initial={initialRecords} vacancyTitles={vacancyTitles} demoMode={!serverMode} />
      </section>

      {!serverMode ? <div className={styles.ruleNote}><p>Fictional demo recruitment records.</p></div> : null}
    </div>
  );
}
