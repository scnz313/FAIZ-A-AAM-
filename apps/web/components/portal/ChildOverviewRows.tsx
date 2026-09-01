"use client";

import Link from "next/link";

import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { gradeSectionLabel } from "@/modules/services/family-context";

import styles from "@/app/portal/page.module.css";

/**
 * "Your children (N)" overview rows: one accessible row per linked child
 * with name, class/section, year, safe reference, and a "View this child"
 * action. The rows use the family context generation as a remount key so
 * they always reflect the current link set.
 */
export function ChildOverviewRows() {
  const { students, activeStudent, generation, switchStudent, switching } = useFamilyContext();

  if (students.length === 0) {
    return (
      <section aria-labelledby="children-title">
        <p className="section-label" id="children-title">Your children</p>
        <p className={styles.noChildren}>No linked children yet — the school office approves link requests.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="children-title" key={generation}>
      <p className="section-label" id="children-title">
        Your children ({students.length})
      </p>
      <ul className={styles.childrenList} aria-live="polite">
        {students.map((item) => {
          const isActive = activeStudent?.student.id === item.student.id;
          return (
            <li key={item.student.id} className={styles.childRow}>
              <div className={styles.childInfo}>
                <strong>{item.student.displayName}</strong>
                <span className={styles.childMeta}>
                  {gradeSectionLabel(item.gradeSection)} · {item.academicYear.label} ·{" "}
                  <span className="num">{item.student.ref}</span>
                </span>
              </div>
              <div className={styles.childActions}>
                {isActive ? (
                  <span className={styles.activeBadge} aria-current="true">Viewing</span>
                ) : (
                  <button
                    type="button"
                    className="button button--quiet button--small"
                    onClick={() => void switchStudent(item.student.id)}
                    disabled={switching}
                    aria-label={`View this child: ${item.student.displayName}`}
                  >
                    View this child
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
