import type { Metadata } from "next";

import { DemoNotice } from "@/components/layouts/DemoNotice";
import PageIntro from "@/components/public/PageIntro";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { CONTENT_DEMO_NOTE, vacancies } from "@/modules/content/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerVacancies } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

type Props = {
  params: Promise<{ vacancySlug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { vacancySlug } = await params;
  const records = dataAdapter() === "supabase" ? await loadServerVacancies() : vacancies;
  const vacancy = records.find((v) => v.slug === vacancySlug);
  return {
    title: vacancy ? vacancy.title : "Vacancy",
    description: vacancy?.description,
  };
}

export default async function VacancyDetailPage({ params }: Props) {
  const { vacancySlug } = await params;
  const records = dataAdapter() === "supabase" ? await loadServerVacancies() : vacancies;
  const vacancy = records.find((v) => v.slug === vacancySlug);

  if (!vacancy) {
    return (
      <div className={styles.page}>
        <PageIntro
          eyebrow="Careers · Not found"
          title="This vacancy is not listed"
          deck="The position may have been withdrawn, or the address may be incorrect."
        />
        <section className={`${styles.section} ${styles.sectionEnd}`}>
          <a className="link-arrow" href="/careers">
            See current vacancies →
          </a>
        </section>
      </div>
    );
  }

  const open = vacancy.status === "open";

  return (
    <div className={styles.page}>
      <PageIntro eyebrow={`Careers · ${vacancy.department}`} title={vacancy.title} deck={vacancy.description} />

      <section className={styles.section} aria-labelledby="qualifications-heading">
        <div className={styles.head}>
          <p className="section-label">Qualifications</p>
          <h2 className={styles.heading} id="qualifications-heading">
            What the role requires.
          </h2>
        </div>
        <ul className={styles.ruledList}>
          {vacancy.qualifications.map((q) => (
            <li className={styles.ruledItem} key={q}>
              {q}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="documents-heading">
        <div className={styles.head}>
          <p className="section-label">Documents required</p>
          <h2 className={styles.heading} id="documents-heading">
            Please have these ready.
          </h2>
        </div>
        <ul className={styles.ruledList}>
          {vacancy.documents.map((d) => (
            <li className={styles.ruledItem} key={d}>
              {d}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="deadline-heading">
        <div className={styles.head}>
          <p className="section-label">Deadline</p>
          <h2 className={styles.heading} id="deadline-heading">
            When applications close.
          </h2>
        </div>
        <div className={styles.deadlineRow}>
          <p className={styles.deadlineValue}>{formatKolkata(vacancy.deadlineIso, { format: "full" })}</p>
          <StatusBadge tone={open ? "watch" : "neutral"}>
            {open ? "Open for applications" : "Closed"}
          </StatusBadge>
        </div>
      </section>

      <section className={styles.section} aria-label="Apply">
        {open ? (
          <div className={styles.cta}>
            <Button href={`/apply/job/${vacancy.slug}`} variant="primary">
              Apply for this position →
            </Button>
            <p className={styles.ctaNote}>
              Applications are tracked by reference. Keep the reference you receive after submitting.
            </p>
          </div>
        ) : (
          <div className={styles.cta}>
            <p className={styles.ctaNote}>
              This vacancy is closed. Applications received before the deadline are under review.
            </p>
            <a className="link-arrow" href="/careers">
              See current vacancies →
            </a>
          </div>
        )}
      </section>

      {dataAdapter() === "demo" ? <div className={styles.conceptNote}><DemoNotice>{CONTENT_DEMO_NOTE}</DemoNotice></div> : null}
    </div>
  );
}
