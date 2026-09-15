import type { Metadata } from "next";
import Link from "next/link";

import Button from "@/components/ui/Button";
import PageIntro from "@/components/public/PageIntro";
import { ADMISSIONS_DEMO_NOTE } from "@/modules/admissions/demo";
import { CONTENT_DEMO_NOTE, notices } from "@/modules/content/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerPublicAdmissionConfiguration, loadServerPublicContent } from "@/lib/supabase/server-loaders";
import { DEMO_ADMISSION_CONFIGURATION, type AdmissionConfiguration } from "@/modules/services/school-config";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Admissions",
  description: "How to apply to Faiz Aam Secondary School: the admission process, eligibility, documents, and key dates.",
  alternates: { canonical: "/admissions" },
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

export default async function AdmissionsPage() {
  const supabaseMode = dataAdapter() === "supabase";
  const configuration: AdmissionConfiguration = supabaseMode
    ? await loadServerPublicAdmissionConfiguration()
    : DEMO_ADMISSION_CONFIGURATION;
  const currentYear = configuration.academicYears.find((year) => year.status === "current") ?? configuration.academicYears[0];
  const openWindows = configuration.windows.filter((window) => window.status === "open" && window.academicYearId === currentYear?.id);
  const classes = configuration.grades.filter((grade) => openWindows.some((window) => window.gradeId === grade.id)).map((grade) => grade.label);
  /* Requirements are configured per window; the public list names each once. */
  const requirementLabels = [...new Set(
    configuration.documentRequirements
      .filter((requirement) => requirement.required && requirement.status === "active")
      .map((requirement) => requirement.label),
  )];
  /* The dates fallback is a published notice in live mode; the demo fixture
     is never presented as authoritative. */
  const admissionNotice = supabaseMode
    ? (await loadServerPublicContent().catch(() => []))
        .filter((notice) => notice.status === "published")
        .sort((left, right) => new Date(right.dateIso).getTime() - new Date(left.dateIso).getTime())[0] ?? null
    : notices.find((notice) => notice.slug === "admissions-open-session-2027") ?? null;

  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="Admissions"
        title="Joining the school"
        deck={openWindows.length > 0 && currentYear ? `Applications for ${currentYear.label} are open for ${classes.join(", ") || "configured grades"}.` : "Admissions dates and eligible grades follow the school configuration."}
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
          {[
            { title: "Age by grade", line: "Children must meet the age rule configured for the selected grade and session.", concept: false },
            { title: "Documents", line: requirementLabels.length > 0 ? requirementLabels.join(", ") : "The current window has no published document checklist.", concept: false },
            { title: "Capacity", line: openWindows.length > 0 ? "Capacity is managed per configured grade window and checked again before enrollment." : "Capacity is published only when the school confirms the admission window.", concept: false },
          ].map((item) => (
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
        {openWindows.length > 0 ? (
          <article className={styles.noticeRow}>
            <p className={styles.noticeDate}>{formatKolkata(openWindows[0]!.closesAtIso, { format: "full" })}</p>
            <div>
              <h3 className={styles.noticeTitle}>Current admission window</h3>
              <p className={styles.noticeExcerpt}>{currentYear?.label} · {classes.join(", ") || "Configured grades"}</p>
              <p className={styles.noticePolicy}>Applications close at the configured deadline shown above.</p>
            </div>
          </article>
        ) : admissionNotice ? (
          <article className={styles.noticeRow}>
            <p className={styles.noticeDate}>{formatKolkata(admissionNotice.dateIso, { format: "full" })}</p>
            <div>
              <h3 className={styles.noticeTitle}>{admissionNotice.title}</h3>
              <p className={styles.noticeExcerpt}>{admissionNotice.excerpt}</p>
              {admissionNotice.body[1] ? (
                <p className={styles.noticePolicy}>{admissionNotice.body[1]}</p>
              ) : null}
            </div>
          </article>
        ) : (
          <article className={styles.noticeRow}>
            <p className={styles.noticeDate}>No open window</p>
            <div>
              <h3 className={styles.noticeTitle}>Admissions are closed right now</h3>
              <p className={styles.noticeExcerpt}>
                No admission window is currently open. Dates for the next session are published on the notices board.
              </p>
              <p className={styles.noticePolicy}>
                <Link className="link-arrow" href="/notices">
                  Read the notices board →
                </Link>
              </p>
            </div>
          </article>
        )}
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
            <Link className="link-arrow" href="/apply/student" prefetch={false}>
              Track an application →
            </Link>
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
