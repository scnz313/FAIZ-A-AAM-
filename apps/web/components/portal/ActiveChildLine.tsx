"use client";

import { gradeSectionLabel } from "@/modules/services/family-context";

import { useFamilyContext } from "./FamilyContextProvider";
import styles from "./ActiveChildLine.module.css";

/**
 * The active linked child shown in every child-scoped page header. Reads the
 * shared family context, so the line updates on a child switch without a
 * reload and shows a recoverable message when the context cannot load.
 */
export function ActiveChildLine() {
  const { status, activeStudent, errorMessage, retry, switching } = useFamilyContext();

  if (status === "error") {
    return (
      <p className={styles.line} role="alert">
        <span className={styles.label}>Linked student</span>
        <span className={styles.error}>{errorMessage}</span>
        <button type="button" className={`button button--quiet button--small ${styles.retry}`} onClick={retry}>
          Try again
        </button>
      </p>
    );
  }

  if (status === "loading" || activeStudent === null) {
    return (
      <p className={styles.line} role="status" aria-live="polite">
        <span className={styles.label}>Linked student</span>
        <span>Loading linked student…</span>
      </p>
    );
  }

  return (
    <p className={styles.line} role="status" aria-live="polite">
      <span className={styles.label}>Linked student</span>
      <strong>{activeStudent.student.displayName}</strong>
      <span>· {gradeSectionLabel(activeStudent.gradeSection)}</span>
      <span>· {activeStudent.academicYear.label}</span>
      <span className={`num ${styles.ref}`}>{activeStudent.student.ref}</span>
      {switching ? <span className={styles.pending}>· Updating…</span> : null}
    </p>
  );
}

export default ActiveChildLine;
