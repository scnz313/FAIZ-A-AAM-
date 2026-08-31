"use client";

import { useEffect, useState } from "react";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { TimetableWorkspace } from "@/components/portal/TimetableWorkspace";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { gradeSectionLabel } from "@/modules/services/family-context";
import {
  classKeyForGradeSection,
  getTimetablePortalProjection,
  TIMETABLE_CLASS,
  type TimetablePortalProjection,
} from "@/modules/services/timetable";

import styles from "@/app/portal/timetable/page.module.css";

export function TimetablePageClient() {
  const { activeStudent } = useFamilyContext();
  const live = clientAdapterMode() === "supabase";
  const [projection, setProjection] = useState<TimetablePortalProjection | null | undefined>(undefined);
  const classLine = activeStudent
    ? `${gradeSectionLabel(activeStudent.gradeSection)} · ${activeStudent.academicYear.label}`
    : "Class · session";
  const className = activeStudent ? classKeyForGradeSection(activeStudent.gradeSection) : TIMETABLE_CLASS;

  useEffect(() => {
    let active = true;
    if (!activeStudent) {
      setProjection(undefined);
      return () => {
        active = false;
      };
    }
    setProjection(undefined);
    void getTimetablePortalProjection(className)
      .then((next) => {
        if (active) setProjection(next);
      })
      .catch(() => {
        if (active) setProjection(null);
      });
    return () => {
      active = false;
    };
  }, [activeStudent, className]);

  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">Portal · Timetable</p>
        <h1 className={styles.title}>Timetable</h1>
        <p className={styles.intro}>{classLine}</p>
        <ActiveChildLine />
      </header>

      {projection === undefined ? (
        <div className={styles.loadingBlock} aria-busy="true">
          <span className="sr-only">Loading timetable…</span>
          <span className="skeleton-rule" aria-hidden="true" />
          <span className="skeleton-bar" style={{ width: "38%" }} aria-hidden="true" />
        </div>
      ) : projection === null || projection.timetable === null ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No published timetable</p>
          <p className="workspace-state-note">
            No timetable is released for {classLine}. The portal uses the active child&apos;s effective section.
          </p>
        </div>
      ) : (
        <TimetableWorkspace
          timetable={projection.timetable}
          weekDays={projection.weekDays}
          dateSheet={projection.dateSheet}
          className={className}
        />
      )}

      {!live ? (
        <p className={styles.demoNote}>
          <span className="demo-badge">Demo data</span>
          <span>{ACADEMICS_DEMO_NOTE}</span>
        </p>
      ) : null}
    </div>
  );
}
