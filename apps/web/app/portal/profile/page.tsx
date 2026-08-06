"use client";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { gradeSectionLabel } from "@/modules/services/family-context";

import styles from "./page.module.css";

/**
 * Profile — guardian and student details held by the school office. Both
 * panels follow the shared family context: the guardian identity comes from
 * the account summary and the student records follow the active linked
 * child, including the full linked-children list.
 */
export default function ProfilePage() {
  const { status, activeStudent, students, guardianName } = useFamilyContext();
  const child = activeStudent;

  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">Portal · Profile</p>
        <h1 className={styles.title}>Profile</h1>
        <p className={styles.intro}>Guardian and student details held by the school office.</p>
        <ActiveChildLine />
      </header>

      <div className={styles.columns}>
        <section className={`panel ${styles.panel}`} aria-labelledby="guardian-heading">
          <h2 id="guardian-heading" className={styles.panelTitle}>
            Guardian
          </h2>
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt>Name</dt>
              <dd>{status === "ready" ? (guardianName ?? "—") : "Loading…"}</dd>
            </div>
            <div className={styles.row}>
              <dt>Workspace</dt>
              <dd>Parent portal · demo session</dd>
            </div>
          </dl>
        </section>

        <section className={`panel ${styles.panel}`} aria-labelledby="student-heading">
          <h2 id="student-heading" className={styles.panelTitle}>
            Student
          </h2>
          {status === "loading" || child === null ? (
            <p className={styles.note} role="status" aria-live="polite">
              Loading the linked student…
            </p>
          ) : (
            <dl className={styles.rows}>
              <div className={styles.row}>
                <dt>Name</dt>
                <dd>{child.student.displayName}</dd>
              </div>
              <div className={styles.row}>
                <dt>Class</dt>
                <dd>{gradeSectionLabel(child.gradeSection)}</dd>
              </div>
              <div className={styles.row}>
                <dt>Academic year</dt>
                <dd>{child.academicYear.label}</dd>
              </div>
              <div className={styles.row}>
                <dt>Student reference</dt>
                <dd className="num">{child.student.ref}</dd>
              </div>
              <div className={styles.row}>
                <dt>Enrollment reference</dt>
                <dd className="num">{child.enrollment.ref}</dd>
              </div>
            </dl>
          )}
        </section>
      </div>

      <section aria-labelledby="children-heading">
        <h2 id="children-heading" className={styles.sectionTitle}>
          Linked children
        </h2>
        {status === "loading" ? (
          <p className={styles.note} role="status" aria-live="polite">
            Loading linked children…
          </p>
        ) : students.length === 0 ? (
          <p className={styles.note}>No linked children yet.</p>
        ) : (
          <div className={styles.rows}>
            {students.map((item) => (
              <div className={styles.childRow} key={item.student.id}>
                <div>
                  <strong>{item.student.displayName}</strong>
                  <small>
                    {gradeSectionLabel(item.gradeSection)} · {item.academicYear.label} · {item.student.ref}
                  </small>
                </div>
                <StatusBadge tone={item.student.id === child?.student.id ? "good" : "neutral"}>
                  {item.student.id === child?.student.id ? "Active" : "Linked"}
                </StatusBadge>
              </div>
            ))}
          </div>
        )}
        <p className={styles.note}>Request to link another child is approved by the school office.</p>
      </section>

      <div className={styles.correction}>
        <Button href="/portal/link-child" variant="quiet">
          Link another child →
        </Button>
        <Button href="/portal/support" variant="quiet">
          Request correction →
        </Button>
        <Button href="/portal/security" variant="quiet">
          Manage security →
        </Button>
        <p className={styles.correctionNote}>
          These details come from school records; corrections are approved by the school office. Password, 2FA and
          signed-in devices live under Security.
        </p>
      </div>

      <p className={styles.demoNote}>
        <span className="demo-badge">Demo data</span>
        <span>Fictional family details — real guardian and student records appear once accounts are linked.</span>
      </p>
    </div>
  );
}
