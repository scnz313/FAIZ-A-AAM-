import type { Metadata } from "next";

import PageIntro from "@/components/public/PageIntro";
import PageSection from "@/components/public/pages/PageSection";
import ConceptNote from "@/components/public/pages/ConceptNote";
import {
  AssemblyScene,
  CampusScene,
  ChinarBranch,
  LakeScene,
  PlayScene,
  ReadScene,
} from "@/components/ui/art";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "School Life",
  description:
    "Sports, arts, service, assemblies, trips, and facilities at Faiz E Aam Secondary School, Bandipora.",
  alternates: { canonical: "/school-life" },
};

const PROGRAMMES = [
  {
    icon: "sports_cricket",
    title: "Sports",
    line: "Cricket and football lead the year with inter-house leagues; athletics day closes the first term. Evening coaching runs twice a week for the senior squads.",
  },
  {
    icon: "palette",
    title: "Arts & crafts",
    line: "Calligraphy on Fridays; watercolour and craft through the term. The corridor gallery changes every month with each class taking its turn.",
  },
  {
    icon: "volunteer_activism",
    title: "Service",
    line: "Library duty, cleanliness rosters and the winter clothing collection run by the senior classes for the town's needs.",
  },
  {
    icon: "record_voice_over",
    title: "Assemblies",
    line: "Eight minutes every morning: recitation, the day's news read by a student, and one class presenting each Friday.",
  },
  {
    icon: "map",
    title: "Trips",
    line: "One day trip per class each year to the Wular fringe, the old town of Srinagar, and a senior excursion further afield in autumn.",
  },
  {
    icon: "science",
    title: "Clubs & laboratory",
    line: "A science club that keeps the laboratory honest, a quiz circle in winter, and reading hour for the middle school.",
  },
] as const;

const FACILITIES = [
  { title: "Science laboratory", line: "One combined lab for physics, chemistry and biology practicals, capped at sensible group sizes." },
  { title: "Library", line: "Reading room with Urdu, Kashmiri and English collections; extended hours before assessments." },
  { title: "Computer room", line: "Twenty working stations on a filtered connection, timetabled for every class weekly." },
  { title: "Covered courtyard", line: "Winter assembly, indoor games and a place to eat when the cold sets in." },
] as const;

const GALLERY = [
  { Art: ReadScene, caption: "Reading hour under the chinar · concept art" },
  { Art: PlayScene, caption: "Playground, winter sun · concept art" },
  { Art: AssemblyScene, caption: "Morning assembly · concept art" },
  { Art: LakeScene, caption: "Wular lake from the school road · concept art" },
  { Art: CampusScene, caption: "The main block · concept art" },
  { Art: ChinarBranch, caption: "Chinar in autumn · concept art" },
] as const;

export default function SchoolLifePage() {
  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="School life"
        title="The timetable is honest: play, art and service are on it."
        deck="Sports, arts, assemblies, trips and service rotate through the week and the year as scheduled parts of growing up, with the same standing as any lesson."
      />

      <PageSection label="Programmes" heading="What the week holds" headingId="programmes-heading">
        <div className={styles.lifeIndex}>
          {PROGRAMMES.map((p) => (
            <div className={styles.lifeRow} key={p.title}>
              <span className={styles.lifeIcon} aria-hidden="true">
                <span className="msym" style={{ fontSize: 21 }}>{p.icon}</span>
              </span>
              <h3 className={styles.lifeTitle}>{p.title}</h3>
              <p className={styles.lifeLine}>{p.line}</p>
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection label="Facilities" heading="Facilities, plainly stated." headingId="facilities-heading">
        <div className={styles.facilitiesGrid}>
          {FACILITIES.map((f) => (
            <div className={styles.facilityCell} key={f.title}>
              <div className={styles.facilityTop} />
              <div className={styles.facilityTitle}>{f.title}</div>
              <p className={styles.facilityLine}>{f.line}</p>
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection label="Gallery" heading="Scenes from the school." headingId="gallery-heading">
        <div className={styles.gallery}>
          {GALLERY.map(({ Art, caption }, index) => (
            <figure className={styles.artTile} key={index}>
              <Art ariaHidden className={styles.art} />
              <figcaption className={styles.caption}>{caption}</figcaption>
            </figure>
          ))}
        </div>
      </PageSection>

      <ConceptNote>
        Programme and facility descriptions are concept copy pending the
        school&apos;s confirmation.
      </ConceptNote>
    </div>
  );
}
