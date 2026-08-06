import styles from "./ProgressRail.module.css";

export type ProgressRailStep = {
  /** Zero-padded step number, e.g. "01". */
  num: string;
  label: string;
  /** Short hint shown for steps that are not yet started. */
  hint: string;
};

type ProgressRailProps = {
  steps: readonly ProgressRailStep[];
  /** Zero-based index of the step the applicant is on. */
  current: number;
  /** Serif context heading, e.g. the selected grade. */
  contextTitle: string;
  /** Emphasised line under the context heading, e.g. the session. */
  contextSubtitle: string;
};

/**
 * Ink progress rail for the application centre — numbered steps with
 * done (willow check) and current (saffron) states, modelled on the
 * `apply` screen in design/mockups.html.
 */
export default function ProgressRail({ steps, current, contextTitle, contextSubtitle }: ProgressRailProps) {
  return (
    <nav className={styles.rail} aria-label="Application progress">
      <p className="section-label section-label--on-ink">Student admission</p>
      <h1 className={styles.contextTitle}>
        {contextTitle}
        <em className={styles.contextSubtitle}>{contextSubtitle}</em>
      </h1>

      <ol className={styles.list}>
        {steps.map((step, index) => {
          const state = index < current ? "done" : index === current ? "current" : "pending";
          return (
            <li
              key={step.num}
              className={`${styles.item} ${styles[state]}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className={styles.bullet} aria-hidden="true">
                {state === "done" ? "✓" : step.num}
              </span>
              <span>
                <strong>{step.label}</strong>
                <small>{state === "done" ? "Complete" : state === "current" ? "In progress" : step.hint}</small>
              </span>
            </li>
          );
        })}
      </ol>

      <div className={styles.help}>
        <strong>Need help?</strong>
        <p>Call the admissions office, or write to us with your application reference.</p>
        <a href="/admissions/apply">Contact admissions →</a>
      </div>
    </nav>
  );
}
