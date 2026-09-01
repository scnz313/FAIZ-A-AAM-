import type { Metadata } from "next";

import PageIntro from "@/components/public/PageIntro";
import PageSection from "@/components/public/pages/PageSection";
import RuledList from "@/components/public/pages/RuledList";
import ConceptNote from "@/components/public/pages/ConceptNote";
import { ReadScene } from "@/components/ui/art";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Academics",
  description:
    "Learning stages, the examination cycle, and the school day at Faiz Aam Secondary School, Bandipora.",
};

const STAGES = [
  {
    term: "Primary",
    sub: "Classes 1–5",
    detail:
      "Reading, writing, arithmetic, and the habits of attention that everything else builds on.",
  },
  {
    term: "Middle",
    sub: "Classes 6–8",
    detail:
      "Wider subjects, laboratories, and longer essays — children learn to study on their own.",
  },
  {
    term: "Secondary",
    sub: "Classes 9–10",
    detail:
      "The examination years: structured revision, past papers, and careful guidance.",
  },
] as const;

const EXAMS = [
  {
    name: "Unit tests",
    body: "Short tests follow each unit of work. Papers are marked and returned quickly, so errors are caught while the topic is still fresh.",
  },
  {
    name: "Mid-term examinations",
    body: "The mid-term examinations in September cover the first half of the year's syllabus. The date sheet is published in the guardian portal under Timetable.",
  },
  {
    name: "Final examinations",
    body: "The final examinations close the academic year. Results are published in the portal; corrections create a new version, never a silent rewrite.",
  },
] as const;

const SCHOOL_DAY = [
  { time: "08:30", activity: "Morning assembly" },
  { time: "08:45", activity: "Classes begin" },
  { time: "13:00", activity: "Lunch" },
  { time: "14:00", activity: "Classes resume" },
  { time: "15:30", activity: "School closes" },
] as const;

export default function AcademicsPage() {
  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="The curriculum"
        title="Academics"
        deck="Learning stages, examinations, and the school day."
      />

      <PageSection label="Stages" heading="Learning stages" headingId="stages-heading">
        <RuledList rows={STAGES} />
      </PageSection>

      <div className="ornament-rule ornament-rule--tight" aria-hidden="true">
        <i className="ornament-rule__diamond" />
      </div>

      <PageSection label="Assessment" heading="Examination cycle" headingId="exams-heading">
        <div className={styles.examGrid}>
          {EXAMS.map((exam, index) => (
            <article className={styles.exam} key={exam.name}>
              <h3 className={styles.examName}>
                <span className={`serif-num ${styles.examNum}`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                {exam.name}
              </h3>
              <p className={styles.examBody}>{exam.body}</p>
            </article>
          ))}
        </div>
        <p className={styles.examNote}>
          Concept copy — the confirmed academic calendar is published with
          the school’s notices.
        </p>
      </PageSection>

      <div className="ornament-rule ornament-rule--tight" aria-hidden="true">
        <i className="ornament-rule__diamond" />
      </div>

      <PageSection label="The day" heading="The school day" headingId="day-heading">
        <div className={`panel ${styles.dayPanel}`}>
          <table className="table">
            <caption className="sr-only">School day timetable</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Activity</th>
              </tr>
            </thead>
            <tbody>
              {SCHOOL_DAY.map((row) => (
                <tr key={row.time}>
                  <td className="num">{row.time}</td>
                  <td>{row.activity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <figure className={styles.artBand}>
          <ReadScene ariaHidden className={styles.art} />
          <figcaption className={styles.artCaption}>Concept art</figcaption>
        </figure>
        <p className={styles.dayNote}>
          Classes run from 08:45 to 15:30 on school days. On poor-air
          mornings the assembly moves indoors.
        </p>
      </PageSection>

      <ConceptNote>
        Grade structure, examination dates, and timings are concept copy
        pending the school’s confirmation.
      </ConceptNote>
    </div>
  );
}
