"use client";

import { useEffect, useState } from "react";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { TimetableWorkspace } from "@/components/portal/TimetableWorkspace";
import Button from "@/components/ui/Button";
import { ErrorPanel } from "@/components/ui/AsyncStates";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { gradeSectionLabel } from "@/modules/services/family-context";
import {
  classKeyForGradeSection,
  getTimetablePortalProjection,
  TIMETABLE_CLASS,
  type TimetablePortalProjection,
} from "@/modules/services/timetable";

import styles from "@/app/portal/timetable/page.module.css";

/**
 * Portal timetable. Every read comes from one active-child projection; the
 * component is remounted by the family context generation on a child switch,
 * so a stale section can never be shown. The live "today" instant is passed
 * from the server so SSR and hydration agree.
 */
export function TimetablePageClient({ todayIso }: { todayIso?: string }) {
  const { activeStudent, status: contextStatus, errorMessage: contextError, retry: retryContext } = useFamilyContext();
  const live = clientAdapterMode() === "supabase";
  const [projection, setProjection] = useState<TimetablePortalProjection | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const classLine = activeStudent
    ? `${gradeSectionLabel(activeStudent.gradeSection)} · ${activeStudent.academicYear.label}`
    : "Class · session";
  const className = activeStudent ? classKeyForGradeSection(activeStudent.gradeSection) : TIMETABLE_CLASS;

  useEffect(() => {
    if (!activeStudent) {
      setProjection(undefined);
      return;
    }
    let active = true;
    /* Clear the outgoing child's projection immediately so no stale section
       survives the switch. */
    setProjection(undefined);
    setLoadError(false);
    void getTimetablePortalProjection(className)
      .then((next) => {
        if (active) setProjection(next);
      })
      .catch(() => {
        if (active) {
          setProjection(null);
          setLoadError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [activeStudent, className, reloadKey]);

  const versionLine = projection?.version
    ? ` · v${projection.version.version}${projection.version.publishedAtIso ? ` · published ${formatKolkata(projection.version.publishedAtIso, { format: "day" })}` : ""}`
    : "";

  return (
    <div className={styles.page}>
      {/* V15 PageHead */}
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Timetable</h1>
          <p className="ph-sub">
            Published timetable for {classLine}{versionLine}
          </p>
          <ActiveChildLine />
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
          <span className="msym" style={{ fontSize: 16 }}>print</span> Print
        </button>
      </div>

      {contextStatus === "error" ? (
        <ErrorPanel
          title="The timetable could not be loaded"
          note={contextError ?? "The active child could not be resolved. No record was changed."}
        >
          <Button variant="quiet" type="button" onClick={retryContext}>
            Try again
          </Button>
        </ErrorPanel>
      ) : loadError ? (
        <ErrorPanel
          title="The timetable could not be loaded"
          note="The timetable service did not respond. The published version is untouched."
        >
          <Button variant="quiet" type="button" onClick={() => setReloadKey((key) => key + 1)}>
            Try again
          </Button>
        </ErrorPanel>
      ) : projection === undefined || contextStatus === "loading" ? (
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
          version={projection.version}
          overrides={projection.overrides}
          dateSheetVersion={projection.dateSheetVersion}
          dateSheetPublishedAtIso={projection.dateSheetPublishedAtIso}
          todayIso={todayIso}
          live={live}
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
