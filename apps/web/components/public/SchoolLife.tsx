import Link from "next/link";

import type { ManagedItem } from "./homeContent";
import styles from "./SchoolLife.module.css";

/**
 * V15 school-life editorial strip: a ruled life-index of programme rows,
 * each with an icon, title, description and chevron. UI-led with no
 * photography. The programme copy is fictional concept text for design
 * review; a published `home-life` page replaces the rows and drops the
 * concept note.
 */
const ACTIVITIES = [
  {
    icon: "sports_cricket",
    title: "Sports",
    line: "Inter-house cricket and football, athletics day, and evening coaching on the main field.",
  },
  {
    icon: "palette",
    title: "Arts & crafts",
    line: "Calligraphy, watercolour and craft work displayed each term in the corridor gallery.",
  },
  {
    icon: "volunteer_activism",
    title: "Service",
    line: "Cleanliness drives, library duty and a student-led winter clothing collection.",
  },
  {
    icon: "record_voice_over",
    title: "Assemblies",
    line: "A short morning assembly with recitation, news, and one class presenting each week.",
  },
  {
    icon: "map",
    title: "Trips",
    line: "Day trips each year to the Wular fringe, the old town, and a senior excursion further afield.",
  },
  {
    icon: "apartment",
    title: "Facilities",
    line: "Science laboratory, library, computer room, and a covered courtyard for winter assembly.",
  },
] as const;

export type SchoolLifeItem = {
  icon: string;
  title: string;
  line: string;
};

/**
 * Managed `home-life` rows become the index rows; icons cycle through the
 * institutional icon order so the ruled composition is preserved. Null or
 * empty managed content keeps the fallback activities.
 */
export function mergeLifeItems(managed: readonly ManagedItem[] | null): SchoolLifeItem[] {
  if (managed === null || managed.length === 0) {
    return ACTIVITIES.map((activity) => ({ ...activity }));
  }
  return managed.map((item, index) => {
    const template = ACTIVITIES[index % ACTIVITIES.length] ?? ACTIVITIES[0];
    return {
      icon: template.icon,
      title: item.title,
      line: item.line,
    };
  });
}

export default function SchoolLife({ items }: { items?: readonly ManagedItem[] | null } = {}) {
  const isManaged = items !== undefined && items !== null && items.length > 0;
  const activities = mergeLifeItems(isManaged ? items : null);

  return (
    <section className="sec sec-chalk" aria-labelledby="life-heading">
      <div className="wrap">
        <div className={styles.head}>
          <div>
            <p className="section-label">School life</p>
            <h2 className={styles.heading} id="life-heading">
              Room to learn, play, and find a stage.
            </h2>
          </div>
          <Link className="link-arrow" href="/school-life">
            School life →
          </Link>
        </div>
        <div className={styles.lifeIndex}>
          {activities.map((activity, index) => (
            <Link key={`${activity.title}-${index}`} className={styles.lifeRow} href="/school-life">
              <span className={styles.lifeIcon} aria-hidden="true">
                <span className="msym" style={{ fontSize: 21 }}>{activity.icon}</span>
              </span>
              <h3 className={styles.lifeTitle}>{activity.title}</h3>
              <p className={styles.lifeLine}>{activity.line}</p>
              <span className={`${styles.lifeChev} msym`} aria-hidden="true" style={{ fontSize: 20 }}>chevron_right</span>
            </Link>
          ))}
        </div>
        {isManaged ? null : (
          <p className={styles.note}>
            Programme descriptions are still to be confirmed by the school.
          </p>
        )}
      </div>
    </section>
  );
}
