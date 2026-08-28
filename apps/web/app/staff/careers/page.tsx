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
          {!serverMode ? <span className="demo-badge">Demo data</span> : null}
        </div>
        <CareersQueue initial={initialRecords} vacancyTitles={vacancyTitles} demoMode={!serverMode} />
      </section>

      {!serverMode ? <div className={styles.ruleNote}><p>Fictional demo recruitment records.</p></div> : null}
    </div>
  );
}
