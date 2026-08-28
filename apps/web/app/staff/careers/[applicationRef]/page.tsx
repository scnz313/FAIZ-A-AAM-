import type { Metadata } from "next";

import { JobReview } from "@/components/staff/JobReview";
import { careersService } from "@/modules/services/careers";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerJobByRef, loadServerVacancies } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Application · Staff",
};

export default async function ApplicationReviewPage({
  params,
}: {
  params: Promise<{ applicationRef: string }>;
}) {
  const { applicationRef } = await params;
  const serverMode = dataAdapter() === "supabase";
  const initial = serverMode ? await loadServerJobByRef(applicationRef) : await careersService.getApplication(applicationRef);

  if (!initial) {
    return (
      <div className={styles.page}>
        <header className={`workspace-header ${styles.header}`}>
          <p className={styles.backLink}>
            <a className="link-arrow" href="/staff/careers">
              ← Careers
            </a>
          </p>
          <p className="eyebrow">Staff · Careers</p>
          <h1 className="workspace-title">Application not found</h1>
          <p className="workspace-intro">
            No application carries the reference <span className="num">{applicationRef}</span> in the current records.
            References are checked against the recruitment register.
          </p>
        </header>
        {!serverMode ? <div className={styles.ruleNote}><p>Fictional demo recruitment records.</p></div> : null}
      </div>
    );
  }

  const vacancy = serverMode
    ? (await loadServerVacancies()).find((candidate) => candidate.slug === initial.vacancySlug)
    : await careersService.getVacancy(initial.vacancySlug);

  return <JobReview applicationRef={initial.ref} initial={initial} vacancyTitle={vacancy?.title ?? initial.vacancySlug} />;
}
