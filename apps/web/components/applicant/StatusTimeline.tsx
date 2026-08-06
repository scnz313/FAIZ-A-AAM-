import type { ApplicationEvent } from "@/modules/admissions/demo";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./StatusTimeline.module.css";

type StatusTimelineProps = {
  events: readonly ApplicationEvent[];
};

/**
 * Vertical ruled timeline of application events — status, actor,
 * Kolkata-local date, and note. The final event is the current state
 * and is marked with the saffron node.
 */
export default function StatusTimeline({ events }: StatusTimelineProps) {
  return (
    <ol className={styles.timeline}>
      {events.map((event, index) => {
        const isCurrent = index === events.length - 1;
        return (
          <li key={`${event.status}-${event.atIso}-${index}`} className={`${styles.event}${isCurrent ? ` ${styles.current}` : ""}`}>
            <span className={styles.node} aria-hidden="true" />
            <div className={styles.body}>
              <p className={styles.meta}>
                <strong>{event.status}</strong>
                <span>{formatKolkata(event.atIso, { format: "full" })}</span>
                {isCurrent ? <span className={styles.currentTag}>Current</span> : null}
              </p>
              <p className={styles.actor}>{event.actor}</p>
              <p className={styles.note}>{event.note}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
