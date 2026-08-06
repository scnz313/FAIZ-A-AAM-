import type { Metadata } from "next";

import Button from "@/components/ui/Button";
import PageIntro from "@/components/public/PageIntro";
import { ADMISSIONS_DEMO_NOTE } from "@/modules/admissions/demo";
import { CONTENT_DEMO_NOTE, notices } from "@/modules/content/demo";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Admissions",
  description:
    "How to apply to Faiz Aam Secondary School: the admission process, eligibility, documents, and key dates for session 2026-27.",
};

const STEPS = [
  {
    num: "01",
    title: "Apply online",
    line: "Complete the application in your own time. Drafts autosave, and a reference number is issued when you submit.",
  },
  {
    num: "02",
    title: "Verification & review",
    line: "The admissions office verifies your documents and eligibility. If anything needs attention, they write to you.",
  },
  {
    num: "03",
    title: "Assessment",
    line: "A short interaction with the student and guardian, scheduled at a time that suits the family.",
  },
  {
    num: "04",
    title: "Offer & enrollment",
    line: "Successful applicants receive an offer with an acceptance date. Accept the seat, pay the admission amount, and complete enrollment.",
  },
];

const ELIGIBILITY = [
  {
    title: "Age by grade",
    line: "Children must meet the age rule for the class they are applying to, counted against the session's cut-off date.",
    concept: true,
  },
  {
    title: "Previous school report card",
    line: "The last two years of report cards help the school confirm placement and continuity.",
    concept: true,
  },
  {
    title: "Documents",
    line: "Birth certificate, student photograph, previous report card, and address proof.",
    concept: true,
  },
  {
    title: "Confirmed policy",
    line: "Grade capacity, the age cut-off, and the full eligibility rules are published with the admission notice.",
    concept: false,
  },
];

export default function AdmissionsPage() {
  const admissionNotice = notices.find((notice) => notice.slug === "admissions-open-session-2027") ?? null;

  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="Admissions"
        title="Joining the school"
        deck="Applications for session 2026-27 are open for classes 6 to 10."
      />

      <section className={styles.section} aria-labelledby="how-heading">
        <p className="section-label">How it works</p>
        <h2 className={styles.sectionHeading} id="how-heading">
          Four quiet steps from application to enrollment.
        </h2>
        <ol className={styles.stepList}>
          {STEPS.map((step) => (
            <li key={step.num} className={styles.stepRow}>
              <p className={styles.stepNum}>{step.num}</p>
              <p className={styles.stepTitle}>{step.title}</p>
              <p className={styles.stepLine}>{step.line}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${styles.section} ${styles.band}`} aria-labelledby="eligibility-heading">
        <p className="section-label">Eligibility</p>
        <h2 className={styles.sectionHeading} id="eligibility-heading">
          Who can apply.
        </h2>
        <ul className={styles.eligibilityList}>
          {ELIGIBILITY.map((item) => (
            <li key={item.title} className={styles.eligibilityRow}>
              <strong className={styles.eligibilityTitle}>
                {item.title}
                {item.concept ? <em className={styles.conceptTag}>concept copy</em> : null}
              </strong>
              <p className={styles.eligibilityLine}>{item.line}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="dates-heading">
        <p className="section-label">Dates</p>
        <h2 className={styles.sectionHeading} id="dates-heading">
          The admission calendar.
        </h2>
        {admissionNotice ? (
          <article className={styles.noticeRow}>
            <p className={styles.noticeDate}>{formatKolkata(admissionNotice.dateIso, { format: "full" })}</p>
            <div>
              <h3 className={styles.noticeTitle}>{admissionNotice.title}</h3>
              <p className={styles.noticeExcerpt}>{admissionNotice.excerpt}</p>
              <p className={styles.noticePolicy}>{admissionNotice.body[1]}</p>
            </div>
          </article>
        ) : null}
      </section>

      <section className={`${styles.section} ${styles.band}`} aria-labelledby="cta-heading">
        <div className={styles.cta}>
          <h2 className={styles.ctaHeading} id="cta-heading">
            Ready to begin?
          </h2>
          <p className={styles.ctaLine}>
            The application takes a short while once you have the documents ready. You may save your draft and
            return to it at any time.
          </p>
          <div className={styles.ctaActions}>
            <Button href="/admissions/apply" variant="primary">
              Begin an application →
            </Button>
            <a className="link-arrow" href="/apply/student">
              Track an application →
            </a>
          </div>
          <p className={styles.ctaHint}>Have your reference ready.</p>
          <p className={styles.ctaNote}>
            <span className="demo-badge">Demo data</span>
            <span className={styles.ctaNoteText}>
              {ADMISSIONS_DEMO_NOTE} {CONTENT_DEMO_NOTE}
            </span>
          </p>
        </div>
      </section>
    </div>
  );
}
