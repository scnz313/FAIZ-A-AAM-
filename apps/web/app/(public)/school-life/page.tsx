import type { Metadata } from "next";

import PageIntro from "@/components/public/PageIntro";
import PageSection from "@/components/public/pages/PageSection";
import RuledList from "@/components/public/pages/RuledList";
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
    "Sports, arts, service, assemblies, trips, and facilities at Faiz Aam Secondary School, Bandipora.",
};

const DOMAINS = [
  {
    num: "01",
    term: "Sports",
    detail:
      "Games and athletics run through the week, and the annual sports meet is held on the school ground in August. On poor-air days, outdoor events move indoors.",
  },
  {
    num: "02",
    term: "Arts",
    detail:
      "Drawing, craft, and music are part of the regular week. The annual cultural programme gives every class a chance to perform.",
  },
  {
    num: "03",
    term: "Service",
    detail:
      "Cleanliness drives, tree planting, and community reading days connect the school to the town. Service is treated as part of character, not as an extra.",
  },
  {
    num: "04",
    term: "Assemblies",
    detail:
      "Morning assembly opens the day with the thought of the day, announcements, and a quiet start. It is where the school gathers as one body.",
  },
  {
    num: "05",
    term: "Trips",
    detail:
      "Field visits and study tours are planned with parent consent and announced well in advance. Every trip is a lesson with a destination.",
  },
] as const;

const FACILITIES = [
  { term: "Library", detail: "Reading hours, borrowing, and a quiet place for study." },
  { term: "Laboratories", detail: "Science practicals for the middle and secondary sections." },
  { term: "Computer lab", detail: "Introductory computer periods for the secondary classes." },
  { term: "Playground", detail: "Games, athletics, and the annual sports meet." },
  { term: "Assembly hall", detail: "Indoor assembly, examinations, and the cultural programme." },
] as const;

const GALLERY = [
  { Art: ReadScene, caption: "Reading hour under the chinar — concept art" },
  { Art: PlayScene, caption: "Playground, winter sun — concept art" },
  { Art: AssemblyScene, caption: "Morning assembly — concept art" },
  { Art: LakeScene, caption: "Wular lake from the school road — concept art" },
  { Art: CampusScene, caption: "The main block — concept art" },
  { Art: ChinarBranch, caption: "Chinar in autumn — concept art" },
] as const;

export default function SchoolLifePage() {
  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="Life at school"
        title="School life"
        deck="Beyond the classroom."
      />

      <PageSection label="Programmes" heading="The five domains" headingId="domains-heading">
        <RuledList rows={DOMAINS} />
      </PageSection>

      <div className="ornament-rule ornament-rule--tight" aria-hidden="true">
        <i className="ornament-rule__diamond" />
      </div>

      <PageSection label="Facilities" heading="Facilities" headingId="facilities-heading">
        <RuledList rows={FACILITIES} />
      </PageSection>

      <div className="ornament-rule ornament-rule--tight" aria-hidden="true">
        <i className="ornament-rule__diamond" />
      </div>

      <PageSection label="Gallery" heading="Scenes from the school." headingId="gallery-heading">
        <div className={styles.gallery}>
          {GALLERY.map(({ Art, caption }, index) => (
            <figure className={styles.artTile} key={index}>
              <Art ariaHidden className={styles.art} />
              <figcaption className={styles.caption}>{caption}</figcaption>
            </figure>
          ))}
        </div>
        <p className={styles.galleryNote}>
          All artwork is original concept art — no school photography has been
          used.
        </p>
      </PageSection>

      <ConceptNote>
        Programme and facility descriptions are concept copy pending the
        school’s confirmation.
      </ConceptNote>
    </div>
  );
}
