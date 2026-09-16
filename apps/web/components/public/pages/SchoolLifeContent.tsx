import type { SchoolLifeArtKey, SchoolLifePageBody } from "@fass/contracts";

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
import type { ComponentType } from "react";

import styles from "./SchoolLifeContent.module.css";

type SceneComponentProps = { className?: string; ariaHidden?: boolean };

/** Gallery artwork key → SVG scene. The stored body carries the key only;
 * components never travel through the content system. */
export const SCHOOL_LIFE_ART: Record<SchoolLifeArtKey, ComponentType<SceneComponentProps>> = {
  read: ReadScene,
  play: PlayScene,
  assembly: AssemblyScene,
  lake: LakeScene,
  campus: CampusScene,
  chinar: ChinarBranch,
};

export const SCHOOL_LIFE_ART_LABEL: Record<SchoolLifeArtKey, string> = {
  read: "Reading hour",
  play: "Playground",
  assembly: "Assembly",
  lake: "Wular lake",
  campus: "Main block",
  chinar: "Chinar in autumn",
};

/**
 * The managed School life page body. Renders the same V15 composition the
 * static page shipped: PageIntro, the ruled programme index, the facilities
 * grid, and the framed gallery plate. The body is validated upstream
 * (`parseSchoolLifePageBody`), so this component trusts the shape.
 */
export default function SchoolLifeContent({ body }: { body: SchoolLifePageBody }) {
  return (
    <div className={styles.page}>
      <PageIntro eyebrow={body.intro.eyebrow} title={body.intro.title} deck={body.intro.deck} />

      <PageSection label="Programmes" heading="What the week holds" headingId="programmes-heading">
        <div className={styles.lifeIndex}>
          {body.programmes.map((programme) => (
            <div className={styles.lifeRow} key={programme.id}>
              <span className={styles.lifeIcon} aria-hidden="true">
                <span className="msym" style={{ fontSize: 21 }}>{programme.icon}</span>
              </span>
              <h3 className={styles.lifeTitle}>{programme.title}</h3>
              <p className={styles.lifeLine}>{programme.line}</p>
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection label="Facilities" heading="Facilities, plainly stated." headingId="facilities-heading">
        <div className={styles.facilitiesGrid}>
          {body.facilities.map((facility) => (
            <div className={styles.facilityCell} key={facility.id}>
              <div className={styles.facilityTop} />
              <div className={styles.facilityTitle}>{facility.title}</div>
              <p className={styles.facilityLine}>{facility.line}</p>
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection label="Gallery" heading="Scenes from the school." headingId="gallery-heading">
        <div className={styles.gallery}>
          {body.gallery.map((tile) => {
            const Art = SCHOOL_LIFE_ART[tile.art];
            return (
              <figure className={styles.artTile} key={tile.id}>
                <Art ariaHidden className={styles.art} />
                <figcaption className={styles.caption}>{tile.caption}</figcaption>
              </figure>
            );
          })}
        </div>
      </PageSection>

      {body.note.trim() !== "" ? <ConceptNote>{body.note}</ConceptNote> : null}
    </div>
  );
}
