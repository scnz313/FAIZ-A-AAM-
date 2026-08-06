"use client";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { TimetableWorkspace } from "@/components/portal/TimetableWorkspace";
import { ACADEMICS_DEMO_NOTE, midTermDateSheet, weekDays } from "@/modules/academics/demo";
import type { Period } from "@/modules/academics/demo";
import { gradeSectionLabel } from "@/modules/services/family-context";
import { classKeyForGradeSection, TIMETABLE_CLASS, timetableService } from "@/modules/services/timetable";

import styles from "./page.module.css";

/**
 * Portal timetable — reads through the single timetable facade keyed by
 * the active child's grade section ("8-A" for both demo children). A staff
 * publish in the same session replaces this view; a class without
 * timetable data gets the honest "no published timetable" state instead of
 * the 8-A fixture.
 */
export default function TimetablePage() {
  const { activeStudent } = useFamilyContext();
  const classLine = activeStudent
    ? `${gradeSectionLabel(activeStudent.gradeSection)} · ${activeStudent.academicYear.label}`
    : "Class · session";
  const className = activeStudent ? classKeyForGradeSection(activeStudent.gradeSection) : TIMETABLE_CLASS;
  /* Undefined while the context loads; null when the class has no timetable. */
  const timetable: Record<string, Period[]> | null | undefined = activeStudent
    ? timetableService.effectiveTimetable(className)
    : undefined;

  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">Portal · Timetable</p>
        <h1 className={styles.title}>Timetable</h1>
        <p className={styles.intro}>{classLine}</p>
        <ActiveChildLine />
      </header>

      {timetable === undefined ? (
        <p className={styles.intro}>Loading timetable…</p>
      ) : timetable === null ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No published timetable</p>
          <p className="workspace-state-note">
            No timetable is published yet for {classLine}. Class timetables are released through the timetable
            office; this page updates as soon as one is published.
          </p>
        </div>
      ) : (
        <TimetableWorkspace timetable={timetable} weekDays={weekDays} dateSheet={midTermDateSheet} />
      )}

      <p className={styles.demoNote}>
        <span className="demo-badge">Demo data</span>
        <span>{ACADEMICS_DEMO_NOTE} The real schedule arrives with the timetable backend. “Today” follows the demo
        clock; a staff-published version replaces the fixture view for this session.</span>
      </p>
    </div>
  );
}
