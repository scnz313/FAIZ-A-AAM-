import type { Metadata } from "next";

import { DemoNotice } from "@/components/layouts/DemoNotice";
import PageIntro from "@/components/public/PageIntro";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { CONTENT_DEMO_NOTE, vacancies, type Vacancy } from "@/modules/content/demo";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Careers",
  description:
    "Vacancies at Faiz Aam Secondary School, Bandipora — open positions, how we hire, and what to expect from an application.",
};

const HIRE_STEPS = [
  {
    title: "Apply",
    line: "Submit the vacancy application with your qualifications and the documents listed, before the deadline.",
  },
  {
    title: "Eligibility review",
    line: "The recruitment panel checks qualifications and documents against the vacancy.",
  },
  {
    title: "Shortlist & interview",
    line: "Shortlisted applicants are invited to an interview and, where relevant, a demonstration.",
  },
  {
    title: "Reference check & offer",
    line: "References are checked before an offer is made; every applicant is informed of the outcome.",
  },
] as const;

function qualificationExcerpt(vacancy: Vacancy): string {
  const [first, ...rest] = vacancy.qualifications;
  if (!first) return "Qualifications to be confirmed";
  return rest.length > 0 ? `${first} · and ${rest.length} more` : first;
}

export default function CareersPage() {
  const open = vacancies.filter((v) => v.status === "open");
  const closed = vacancies.filter((v) => v.status === "closed");

  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="Careers"
        title="Work with the school"
        deck="Vacancies are published here and applications are tracked by reference."
      />

      <section className={styles.section} aria-labelledby="open-heading">
        <div className={styles.head}>
          <p className="section-label">Open positions</p>
          <h2 className={styles.heading} id="open-heading">
            Positions currently open.
          </h2>
        </div>
        <ul className={styles.list}>
          {open.map((v, i) => (
            <li key={v.slug}>
              <a className={`tile-link ${styles.row}`} href={`/careers/${v.slug}`}>
                <span className="tile-link__num serif-num">{String(i + 1).padStart(2, "0")}</span>
                <span className="tile-link__title">{v.title}</span>
                <span className="tile-link__line">
                  {v.department} · {v.location} · {v.type}
                </span>
                <span className="tile-link__line">{qualificationExcerpt(v)}</span>
                <span className="tile-link__more">
                  Closes {formatKolkata(v.deadlineIso, { format: "day" })} · Read more <span aria-hidden="true">→</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {closed.length > 0 ? (
        <section className={styles.section} aria-labelledby="closed-heading">
          <div className={styles.head}>
            <p className="section-label">Closed positions</p>
            <h2 className={styles.heading} id="closed-heading">
              Positions no longer open.
            </h2>
          </div>
          <div className={`panel ${styles.closedPanel}`}>
            {closed.map((v) => (
              <div className={styles.closedRow} key={v.slug}>
                <div className={styles.closedHead}>
                  <h3 className={styles.closedTitle}>{v.title}</h3>
                  <StatusBadge tone="neutral">Closed</StatusBadge>
                </div>
                <p className={styles.closedMeta}>
                  {v.department} · {v.location} · {v.type} · Closed {formatKolkata(v.deadlineIso, { format: "day" })}
                </p>
                <p className={styles.closedNote}>{v.description}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="how-heading">
        <div className={styles.head}>
          <p className="section-label">How we hire</p>
          <h2 className={styles.heading} id="how-heading">
            Four steps, clearly marked.
          </h2>
        </div>
        <ol className={styles.steps}>
          {HIRE_STEPS.map((s, i) => (
            <li className={styles.step} key={s.title}>
              <span className={`${styles.stepNum} serif-num`}>{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3 className={styles.stepTitle}>{s.title}</h3>
                <p className={styles.stepLine}>{s.line}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="privacy-heading">
        <div className={styles.head}>
          <p className="section-label">Applications and privacy</p>
          <h2 className={styles.heading} id="privacy-heading">
            Your information, kept carefully.
          </h2>
        </div>
        <div className="panel">
          <p className={styles.retention}>
            Applications are kept for the period stated in the vacancy and then deleted or anonymised.
          </p>
          <p className={styles.retentionSub}>Retention and deletion follow the school’s confirmed policy.</p>
        </div>
      </section>

      <div className={styles.conceptNote}>
        <DemoNotice>{CONTENT_DEMO_NOTE}</DemoNotice>
      </div>
    </div>
  );
}
