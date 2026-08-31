import type { Metadata } from "next";

import PageIntro from "@/components/public/PageIntro";
import PageSection from "@/components/public/pages/PageSection";
import RuledList from "@/components/public/pages/RuledList";
import ConceptNote from "@/components/public/pages/ConceptNote";
import { CampusScene } from "@/components/ui/art";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerPublicPageBody } from "@/lib/supabase/server-loaders";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "About",
  description:
    "The history, approach, and leadership of Faiz Aam Secondary School, Bandipora.",
};

const APPROACH = [
  {
    term: "Discipline",
    detail:
      "A firm timetable, morning assembly, and clear rules make the school day safe, predictable, and calm.",
  },
  {
    term: "Character",
    detail:
      "Honesty, courtesy, and service are practised daily — in the classroom, the courtyard, and the town.",
  },
  {
    term: "Academic seriousness",
    detail:
      "Small classes, careful teaching, and examinations that measure real understanding, not memory alone.",
  },
] as const;

export default async function AboutPage() {
  /* A published managed page overrides the concept copy; otherwise the
     concept page remains the honest fallback. */
  const managed = dataAdapter() === "supabase" ? await loadServerPublicPageBody("about") : null;
  if (managed !== null) {
    return (
      <div className={styles.page}>
        <PageIntro eyebrow="The school" title={managed.title} deck={managed.body[0] ?? ""} />
        <PageSection label="About" heading={managed.title} headingId="managed-about-heading">
          <div className={styles.story}>
            {managed.body.slice(1).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </PageSection>
        <ConceptNote>This page is published by the school through the content workspace.</ConceptNote>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="The school"
        title="A school rooted in Bandipora"
        deck="Established in 1976 as a small middle school between the town and the Wular lake, and grown, class by class, into the secondary school it is today."
      />

      <PageSection label="History" heading="Five decades on the same ground" headingId="history-heading">
        <div className={styles.historyGrid}>
          <div className={styles.story}>
            <p className="drop-cap">
              Faiz Aam began in 1976 as a small middle school, opened by a
              circle of teachers from Bandipora on a plot of land between the
              town and the Wular lake. Their idea was simple: a child from this
              valley should grow up knowing exactly where they come from, and
              still be ready for whatever the world asks next.
            </p>
            <p>
              The school grew class by class — middle school first, then the
              secondary section — without changing that founding idea. Assembly
              still opens the morning, classes follow a firm timetable, and the
              afternoon closes with games, reading, and homework finished
              before sunset.
            </p>
            <p>
              The method remains deliberately plain: small classes, clear
              rules, and teachers who stay for years. The school judges itself
              as it did in 1976 — by whether its children learn steadily and
              behave honourably.
            </p>
            <p className={styles.note}>
              Concept history for design review — the school’s official account
              is yet to be confirmed.
            </p>
          </div>
          <figure className={styles.artPanel}>
            <CampusScene ariaHidden className={styles.art} />
            <figcaption className={styles.artCaption}>
              The main block — concept art
            </figcaption>
          </figure>
        </div>
      </PageSection>

      <div className="ornament-rule ornament-rule--tight" aria-hidden="true">
        <i className="ornament-rule__diamond" />
      </div>

      <PageSection label="Method" heading="Our approach" headingId="approach-heading">
        <RuledList rows={APPROACH} />
      </PageSection>

      <div className="ornament-rule ornament-rule--tight" aria-hidden="true">
        <i className="ornament-rule__diamond" />
      </div>

      <PageSection label="Leadership" heading="From the head of school" headingId="leadership-heading">
        <blockquote className={`pull-quote ${styles.quote}`}>
          <span className="pull-quote__mark" aria-hidden="true" />
          <p className={styles.quoteText}>
            Children learn best when they are known — by name, by family, and
            by what they can do, not only by what they cannot.
          </p>
        </blockquote>
        <p className={styles.attribution}>
          Message from the head of school · concept text for design review
        </p>
      </PageSection>

      <ConceptNote>
        The school’s official history, leadership details, and accreditation
        are pending verification.
      </ConceptNote>
    </div>
  );
}
