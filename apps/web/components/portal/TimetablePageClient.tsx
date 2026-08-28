"use client";

import { useEffect, useState } from "react";
import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { TimetableWorkspace } from "@/components/portal/TimetableWorkspace";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import type { Period } from "@/modules/academics/demo";
import { gradeSectionLabel } from "@/modules/services/family-context";
import { classKeyForGradeSection, getDemoDateSheet, getEffectiveTimetable, TIMETABLE_CLASS, TIMETABLE_WEEK_DAYS } from "@/modules/services/timetable";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "@/app/portal/timetable/page.module.css";

export function TimetablePageClient() {
  const { activeStudent } = useFamilyContext();
  const [timetable, setTimetable] = useState<Record<string, Period[]> | null | undefined>(undefined);
  const classLine = activeStudent ? `${gradeSectionLabel(activeStudent.gradeSection)} · ${activeStudent.academicYear.label}` : "Class · session";
  const className = activeStudent ? classKeyForGradeSection(activeStudent.gradeSection) : TIMETABLE_CLASS;
  useEffect(() => { let active = true; if (!activeStudent) { setTimetable(undefined); return () => { active = false; }; } void getEffectiveTimetable(className).then((next) => { if (active) setTimetable(next); }).catch(() => { if (active) setTimetable(null); }); return () => { active = false; }; }, [activeStudent, className]);
  return <div className={styles.page}><header><p className="eyebrow">Portal · Timetable</p><h1 className={styles.title}>Timetable</h1><p className={styles.intro}>{classLine}</p><ActiveChildLine /></header>{timetable === undefined ? <div className={styles.loadingBlock} aria-busy="true"><span className="sr-only">Loading timetable…</span><span className="skeleton-rule" aria-hidden="true" /><span className="skeleton-bar" style={{ width: "38%" }} aria-hidden="true" /></div> : timetable === null ? <div className="workspace-state"><p className="workspace-state-title">No published timetable</p><p className="workspace-state-note">No timetable is released for {classLine}. The portal uses the active child&apos;s effective section.</p></div> : <TimetableWorkspace timetable={timetable} weekDays={TIMETABLE_WEEK_DAYS} dateSheet={clientAdapterMode() === "supabase" ? [] : getDemoDateSheet()} className={className} />}<p className={styles.demoNote}><span className="demo-badge">Demo data</span><span>{ACADEMICS_DEMO_NOTE} Supabase mode reads the effective timetable projection for the active enrollment section.</span></p></div>;
}
