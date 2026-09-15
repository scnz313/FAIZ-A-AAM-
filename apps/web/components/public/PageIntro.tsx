import styles from "./PageIntro.module.css";

export type PageIntroProps = {
  /** Small-caps saffron kicker above the title, e.g. "Admissions". */
  eyebrow?: string;
  title: string;
  /** Serif lede line under the title. */
  deck?: string;
  children?: React.ReactNode;
};

/**
 * V15 PageHero — the standard opening of every public inner page: kicker,
 * serif h1, and lede inside a bottom-flush `.sec` + `.wrap-n`. No folio
 * masthead or ornament rule (V15 removed both).
 */
export default function PageIntro({ eyebrow, title, deck, children }: PageIntroProps) {
  return (
    <section className={`sec ${styles.head}`} aria-label="Page introduction">
      <div className="wrap-n">
        {eyebrow ? <p className={styles.kicker}>{eyebrow}</p> : null}
        <h1 className={styles.title}>{title}</h1>
        {deck ? <p className={styles.lede}>{deck}</p> : null}
        {children}
      </div>
    </section>
  );
}
