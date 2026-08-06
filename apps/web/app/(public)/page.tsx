import type { Metadata } from "next";
import Hero from "@/components/public/Hero";
import NoticeLine from "@/components/public/NoticeLine";
import ServiceRail from "@/components/public/ServiceRail";
import SchoolStory from "@/components/public/SchoolStory";
import SchoolLife from "@/components/public/SchoolLife";
import ImageBand from "@/components/public/ImageBand";
import UpcomingDates from "@/components/public/UpcomingDates";
import styles from "./page.module.css";

export const metadata: Metadata = {
  description:
    "Admissions, school life, notices, and campus environment for Faiz Aam Secondary School, Bandipora.",
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <NoticeLine />
      <ServiceRail />
      <SchoolStory />
      <ImageBand
        src="/images/faiz-e-aam-students-school-life.png"
        alt="Students in the schoolyard during a break — concept illustration"
        caption="Schoolyard, morning break — concept illustration"
      />
      <SchoolLife />
      <ImageBand
        src="/images/faiz-e-aam-students-learning.png"
        alt="Students learning in a classroom — concept illustration"
        caption="Middle-school science period — concept illustration"
      />
      <section className={styles.stages} aria-labelledby="stages-heading">
        <div className={styles.stagesHead}>
          <p className="section-label">Learning stages</p>
          <h2 className={styles.stagesHeading} id="stages-heading">
            From first letters to the final examinations.
          </h2>
        </div>
        <ol className={styles.stageList}>
          <li className={styles.stageRow}>
            <p className={styles.stageName}>
              Primary
              <span className={styles.stageClasses}>Classes 1–5</span>
            </p>
            <p className={styles.stageLine}>
              Reading, writing, arithmetic — the habits of attention.
            </p>
          </li>
          <li className={styles.stageRow}>
            <p className={styles.stageName}>
              Middle
              <span className={styles.stageClasses}>Classes 6–8</span>
            </p>
            <p className={styles.stageLine}>
              Wider subjects, laboratories, and longer essays.
            </p>
          </li>
          <li className={styles.stageRow}>
            <p className={styles.stageName}>
              Secondary
              <span className={styles.stageClasses}>Classes 9–10</span>
            </p>
            <p className={styles.stageLine}>
              The examination years — revision, past papers, guidance.
            </p>
          </li>
        </ol>
      </section>
      <ImageBand
        src="/images/faiz-e-aam-students-reading.png"
        alt="A student reading under a tree — concept illustration"
        caption="Reading hour, under the chinar — concept illustration"
      />
      <UpcomingDates />
    </>
  );
}
