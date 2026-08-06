import styles from "./JobTimeline.module.css";

export type JobTimelineEvent = {
  id: string;
  label: string;
  note?: string;
  /** Reviewer who recorded the event; omitted for the initial submission. */
  actor?: string;
  /** Display time for events with a known timestamp, e.g. the submission. */
  time?: string;
  state: "done" | "current" | "pending";
};

const STATE_CLASS = {
  done: styles.itemDone,
  current: styles.itemCurrent,
  pending: styles.itemPending,
} as const;

/**
 * Vertical ruled timeline of application status events: a hairline rail
 * with round markers, current stage in saffron, completed stages in
 * willow, upcoming stages muted. Applicant-facing only — it never carries
 * internal review notes.
 */
export default function JobTimeline({ events }: { events: JobTimelineEvent[] }) {
  return (
    <ol className={styles.timeline}>
      {events.map((event) => (
        <li key={event.id} className={`${styles.item} ${STATE_CLASS[event.state]}`}>
          <span className={styles.marker} aria-hidden="true">
            {event.state === "done" ? "✓" : ""}
          </span>
          <div className={styles.body}>
            <p className={styles.label}>{event.label}</p>
            {event.note ? <p className={styles.note}>{event.note}</p> : null}
            {event.actor || event.time ? (
              <p className={styles.meta}>{[event.actor, event.time].filter(Boolean).join(" · ")}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
