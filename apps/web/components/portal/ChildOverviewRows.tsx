"use client";

import Link from "next/link";

import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { gradeSectionLabel } from "@/modules/services/family-context";

import styles from "@/app/portal/page.module.css";

/**
 * "Your children (N)" overview panel: one accessible row per linked child
 * with name, class/section, year, safe reference, and a "View this child"
 * action. The rows use the family context generation as a remount key so
 * they always reflect the current link set.
 */
export function ChildOverviewRows() {
  const { status, students, activeStudent, generation, switchStudent, switching, errorMessage, retry } = useFamilyContext();

  if (status === "error") {
    return (
      <section className="panel">
        <div className="pn-head"><h2>Active child</h2></div>
        <div className="pn-body">
          <p className={styles.noChildren} role="alert">
            The linked children could not be loaded{errorMessage ? ` · ${errorMessage}` : "."}
          </p>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (status === "loading") {
    return (
      <section className="panel">
        <div className="pn-head"><h2>Active child</h2></div>
        <div className="pn-body">
          <p className={styles.noChildren} role="status" aria-live="polite">Loading linked children…</p>
        </div>
      </section>
    );
  }

  if (students.length === 0) {
    return (
      <section className="panel">
        <div className="pn-head"><h2>Active child</h2></div>
        <div className="pn-body">
          <p className={styles.noChildren}>No linked children yet · the school office approves link requests.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel" key={generation} aria-live="polite">
      <div className="pn-head"><h2>Active child</h2></div>
      <div className="pn-body">
        <ul className={styles.childrenList}>
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
                      className="btn btn-ghost btn-sm"
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
        <div style={{ marginTop: 14 }}>
          <Link className="btn btn-ghost btn-sm" href="/portal/profile" prefetch={false}>
            <span className="msym" style={{ fontSize: 16 }}>manage_accounts</span> Profile & linked children
          </Link>
        </div>
      </div>
    </section>
  );
}

export default ChildOverviewRows;
