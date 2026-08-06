import type { ReactNode } from "react";

import { demoTodayLabel } from "@/modules/demo/clock";

import styles from "./PageIntro.module.css";

export type PageIntroProps = {
  /** Small-caps eyebrow above the title, e.g. "Admissions · Session 2026-27". */
  eyebrow?: string;
  title: string;
  /** Serif italic deck line under the title. */
  deck?: string;
  /** Left folio text; defaults to the school name. */
  folioLeft?: string;
  /** Right folio text; defaults to the demo clock's concept date. */
  folioRight?: string;
  children?: ReactNode;
};

/**
 * Shared editorial header for public pages: folio masthead line, eyebrow,
 * serif h1, italic deck and a saffron ornament rule — the standard opening
 * of every public page so the site reads as one printed publication.
 */
export default function PageIntro({ eyebrow, title, deck, folioLeft, folioRight, children }: PageIntroProps) {
  return (
    <header className={styles.intro}>
      <div className="folio">
        <span>{folioLeft ?? "FAIZ AAM SECONDARY SCHOOL · BANDIPORA"}</span>
        <span>{folioRight ?? demoTodayLabel()}</span>
      </div>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1 className={styles.title}>{title}</h1>
      {deck ? <p className={styles.deck}>{deck}</p> : null}
      {children}
      <div className="ornament-rule">
        <i className="ornament-rule__diamond" aria-hidden="true" />
      </div>
    </header>
  );
}
