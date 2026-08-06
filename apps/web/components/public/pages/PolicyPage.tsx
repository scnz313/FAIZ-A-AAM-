import type { Policy } from "@/modules/content/demo";
import PageIntro from "@/components/public/PageIntro";
import ConceptNote from "./ConceptNote";
import styles from "./PolicyPage.module.css";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "2026-07-01" -> "1 July 2026", deterministic regardless of timezone. */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

/**
 * Shared renderer for the four policy pages. Each route imports its policy
 * record from modules/content/demo.ts and passes it here; the deck shows
 * the policy's update date.
 */
export default function PolicyPage({ policy }: { policy: Policy }) {
  return (
    <>
      <PageIntro
        eyebrow="Policies"
        title={policy.title}
        deck={`Updated ${formatDate(policy.updatedIso)}`}
      />
      {policy.sections.map((section) => (
        <section key={section.heading} className={styles.section}>
          <h2 className={styles.heading}>{section.heading}</h2>
          <div className={styles.body}>
            {section.body.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </section>
      ))}
      <p className={styles.printLine}>
        <span className="kicker">Print</span>
        This page is set for printing — a dated PDF will be published here
        once the school confirms the final text.
      </p>
      <ConceptNote />
    </>
  );
}
