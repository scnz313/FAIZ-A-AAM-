import Link from "next/link";

import {
  ArtsMark,
  AssembliesMark,
  ServiceMark,
  SportsMark,
  TripsMark,
} from "@/components/ui/art";
import styles from "./SchoolLife.module.css";

/**
 * School-life editorial strip: five programme tiles presented as a
 * numbered index, UI-led with no photography. The programme copy is
 * fictional concept text for design review.
 */
const ACTIVITIES = [
  {
    num: "01",
    title: "Sports",
    line: "Games, athletics, and the annual sports meet.",
    Mark: SportsMark,
  },
  {
    num: "02",
    title: "Arts",
    line: "Drawing, craft, and the cultural programme.",
    Mark: ArtsMark,
  },
  {
    num: "03",
    title: "Service",
    line: "Cleanliness drives and community reading days.",
    Mark: ServiceMark,
  },
  {
    num: "04",
    title: "Assemblies",
    line: "Morning assembly and the thought of the day.",
    Mark: AssembliesMark,
  },
  {
    num: "05",
    title: "Trips",
    line: "Field visits planned with parent consent.",
    Mark: TripsMark,
  },
] as const;

export default function SchoolLife() {
  return (
    <section className={styles.section} aria-labelledby="life-heading">
      <div className={styles.head}>
        <p className="section-label">School life</p>
        <h2 className={styles.heading} id="life-heading">
          Beyond the classroom.
        </h2>
      </div>
      <ul className={styles.grid}>
        {ACTIVITIES.map((activity) => (
          <li className={styles.cell} key={activity.num}>
            <Link className={`tile-link ${styles.tile}`} href="/school-life">
              <activity.Mark ariaHidden className={styles.mark} />
              <span className="tile-link__num serif-num">{activity.num}</span>
              <span className="tile-link__title">{activity.title}</span>
              <span className="tile-link__line">{activity.line}</span>
              <span className="tile-link__more">Read more <span aria-hidden="true">→</span></span>
            </Link>
          </li>
        ))}
      </ul>
      <p className={styles.note}>
        Concept programme descriptions — to be confirmed by the school.
      </p>
    </section>
  );
}
