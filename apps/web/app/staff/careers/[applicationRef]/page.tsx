import type { Metadata } from "next";

import { JobReview } from "@/components/staff/JobReview";
import { CONTENT_DEMO_NOTE, vacancies } from "@/modules/content/demo";
import { fixtureApplicationRecord } from "@/modules/services/careers";

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
  /* The shared fixture derivation, so the SSR initial record and the
     client-side refresh always agree on the same starting state. */
  const initial = fixtureApplicationRecord(applicationRef);

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
        <div className={styles.ruleNote}>
          <p>{CONTENT_DEMO_NOTE}</p>
        </div>
      </div>
    );
  }

  const vacancy = vacancies.find((v) => v.slug === initial.vacancySlug);

  return <JobReview applicationRef={initial.ref} initial={initial} vacancyTitle={vacancy?.title ?? initial.vacancySlug} />;
}
