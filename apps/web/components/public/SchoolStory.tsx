import type { StoryFields } from "./homeContent";
import styles from "./SchoolStory.module.css";

const FACTS: ReadonlyArray<readonly [string, string]> = [
  ["Location", "Astanpora, Bandipora, Jammu & Kashmir 193502"],
  ["Grades", "1 to 12, co-educational day school"],
  ["Guidance", "A Unit of Darul Uloom Raheemiyyah"],
  ["Medium", "English, with Urdu and Kashmiri"],
  ["Motto", "O Allah! Increase me in knowledge"],
  ["School day", "8:30 am to 3:30 pm, Mon to Sat"],
] as const;

const FALLBACK_HEADING = "A quiet, serious school on the northern shore of Wular.";
const FALLBACK_SUB =
  "Established as a unit of Darul Uloom Raheemiyyah, the school serves families across Bandipora with a broad curriculum and unhurried care.";
const FALLBACK_NARRATIVE = [
  "Every school day here is recorded: the lesson taught, the page completed, the mark earned, the small correction made the same week. Parents see the record as it is. This is a school that prefers steady progress, announced honestly, to grand claims made once a year.",
];

/**
 * V15 school story: narrative with drop cap (left, 3fr) and the V15
 * facts ledger (right, 2fr). A published `home-story` page may replace the
 * heading, sub, and narrative; the record ledger and the 3fr/2fr composition
 * stay structural. No photography and no link from this section; the About
 * page carries the full story and concept notes.
 */
export default function SchoolStory({ content }: { content?: StoryFields | null } = {}) {
  const heading = content?.heading ?? FALLBACK_HEADING;
  const sub = content?.sub ?? FALLBACK_SUB;
  const narrative = content?.narrative !== undefined && content.narrative.length > 0
    ? content.narrative
    : FALLBACK_NARRATIVE;

  return (
    <section className="sec sec-tint" id="school" aria-labelledby="story-heading">
      <div className="wrap">
        <div className={styles.head}>
          <h2 className={styles.heading} id="story-heading">
            {heading}
          </h2>
          <p className={styles.sub}>{sub}</p>
        </div>
        <div className={styles.grid}>
          <div className={styles.text}>
            {narrative.map((paragraph, index) => (
              <p key={index} className={index === 0 ? `${styles.narrative} drop` : styles.narrative}>
                {paragraph}
              </p>
            ))}
          </div>

          <div className={styles.facts} role="list" aria-label="School record">
            {FACTS.map(([key, val]) => (
              <div key={key} className={styles.factRow} role="listitem">
                <span className={styles.factKey}>{key}</span>
                <span className={styles.factVal}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
