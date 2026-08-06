import Image from "next/image";

import styles from "./SchoolStory.module.css";

/**
 * Editorial school story: one short paragraph and the welcome photograph.
 * Copy is fictional concept text — the school name and town are real,
 * everything else is to be confirmed.
 */
export default function SchoolStory() {
  return (
    <section className={styles.story} id="school" aria-labelledby="story-heading">
      <div className={styles.head}>
        <p className="section-label">The school</p>
        <h2 className={styles.heading} id="story-heading">
          A school that holds its ground.
        </h2>
      </div>

      <div className={styles.body}>
        <div className={styles.text}>
          <p className="drop-cap">
            Faiz Aam was founded in 1976 by a small circle of teachers from Bandipora, on a plot of land between
            the town and the Wular lake. Small classes, clear rules, and teachers who stay for years — that is the
            whole method.
          </p>
          <a className="link-arrow" href="/about">
            Read about the school
          </a>
          <p className={styles.note}>
            Concept copy for design review — the school&apos;s official history is yet to be confirmed.
          </p>
        </div>

        <figure className={styles.photo}>
          <div className={styles.photoFrame}>
            <Image
              src="/images/faiz-e-aam-students-welcome.png"
              alt="Students and teachers at the school entrance — concept illustration"
              fill
              sizes="(max-width: 1000px) 100vw, 40vw"
              quality={80}
              className={styles.image}
            />
          </div>
          <figcaption className={styles.caption}>Welcome to the school — concept illustration</figcaption>
        </figure>
      </div>

      <div className={`ornament-rule ornament-rule--willow ${styles.ornament}`} aria-hidden="true">
        <i className="ornament-rule__star" />
      </div>
    </section>
  );
}
