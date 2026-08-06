"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ExamSlot, Period } from "@/modules/academics/demo";
import { demoWeekday } from "@/modules/demo/clock";
import { timetableService, type TimetableVersion } from "@/modules/services/timetable";

import styles from "./TimetableWorkspace.module.css";

type Mode = "day" | "week" | "exam";

const MODES: ReadonlyArray<{ key: Mode; label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "exam", label: "Exam date sheet" },
];

/* Demo week of 3–8 August 2026, matching the portal's folio date. */
const DAY_DATES: Record<string, string> = {
  Monday: "3 August 2026",
  Tuesday: "4 August 2026",
  Wednesday: "5 August 2026",
  Thursday: "6 August 2026",
  Friday: "7 August 2026",
  Saturday: "8 August 2026",
};

/** Period number for a list row: classes count 1..n, assembly "A", breaks "—". */
function periodNumber(periods: Period[], index: number): string {
  const period = periods[index];
  if (period === undefined) return "";
  if (period.kind === "break") return "—";
  if (period.kind === "assembly") return "A";
  let n = 0;
  for (let i = 0; i <= index; i += 1) {
    const other = periods[i];
    if (other !== undefined && other.kind !== "break" && other.kind !== "assembly") n += 1;
  }
  return String(n);
}

function PeriodList({ periods }: { periods: Period[] }) {
  return (
    <ol className={styles.periods}>
      {periods.map((period, index) => {
        const classes = [
          styles.period,
          period.kind === "break" ? styles.break : "",
          period.kind === "assembly" ? styles.assembly : "",
          period.change ? styles.changed : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <li key={`${period.time}-${period.subject}`} className={classes}>
            <time dateTime={period.time}>{period.time}</time>
            <div className={styles.periodMain}>
              <strong>{period.subject}</strong>
              <small>
                {period.teacher} · {period.room}
              </small>
              {period.change && (
                <small className={styles.changedNote}>
                  <span className={styles.changedDot} aria-hidden="true" />
                  Changed
                </small>
              )}
            </div>
            <span className={`num ${styles.periodNumber}`}>{periodNumber(periods, index)}</span>
          </li>
        );
      })}
    </ol>
  );
}

type TimetableWorkspaceProps = {
  timetable: Record<string, Period[]>;
  weekDays: readonly string[];
  dateSheet: ExamSlot[];
  /** Retained for call-site compatibility; "today" comes from the demo clock. */
  today?: string;
};

/**
 * Client timetable island: Day / Week / Exam date-sheet views with a
 * print fallback. All data is demo data passed from the server page.
 */
export function TimetableWorkspace({ timetable, weekDays, dateSheet }: TimetableWorkspaceProps) {
  const [mode, setMode] = useState<Mode>("day");
  /* "Today" is defined by the injected demo clock, not the wall clock. */
  const demoDay = demoWeekday();
  const [day, setDay] = useState(demoDay);
  /* A staff-published session version replaces the fixture view. */
  const [sessionVersion, setSessionVersion] = useState<TimetableVersion | null>(null);
  useEffect(() => {
    let active = true;
    /* Only classes with a timetable render this workspace (8-A in the demo), so the default class key applies. */
    void timetableService.getTimetableVersion().then((version) => {
      if (active) setSessionVersion(version);
    });
    return () => {
      active = false;
    };
  }, []);
  const source = sessionVersion?.periods ?? timetable;

  const todayPeriods = source[demoDay] ?? [];
  const selectedPeriods = source[day] ?? [];

  return (
    <section className={`panel ${styles.workspace}`} aria-label="Timetable for Class 8-A">
      <div className={styles.toolbar}>
        <div className="tabs" role="group" aria-label="Timetable view">
          {MODES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={mode === entry.key ? "active" : undefined}
              aria-pressed={mode === entry.key}
              onClick={() => setMode(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <Button variant="quiet" onClick={() => window.print()}>
          Print / save a copy
        </Button>
      </div>

      {mode === "day" && (
        <div className={styles.view}>
          <p className="section-label">
            {demoDay} · {DAY_DATES[demoDay] ?? ""} · demo date
          </p>
          <div className={styles.viewHead}>
            <h2 className={styles.viewTitle}>Today&apos;s timetable</h2>
            <StatusBadge tone="neutral">Today</StatusBadge>
            {sessionVersion !== null ? <StatusBadge tone="watch">v{sessionVersion.version} · demo session</StatusBadge> : null}
          </div>
          {sessionVersion !== null ? (
            <p className={styles.note}>
              Showing the session-published v{sessionVersion.version} — the fixture view is replaced for this session
              (demo).
            </p>
          ) : null}
          <PeriodList periods={todayPeriods} />
        </div>
      )}

      {mode === "week" && (
        <div className={styles.view}>
          <div className={`tabs ${styles.dayTabs}`} role="group" aria-label="Select a day">
            {weekDays.map((weekDay) => (
              <button
                key={weekDay}
                type="button"
                className={day === weekDay ? "active" : undefined}
                aria-pressed={day === weekDay}
                onClick={() => setDay(weekDay)}
              >
                {weekDay}
              </button>
            ))}
          </div>
          <p className="section-label">
            {day} · {DAY_DATES[day] ?? ""}
          </p>
          <div className={styles.viewHead}>
            <h2 className={styles.viewTitle}>{day}&apos;s timetable</h2>
            {day === demoDay && <StatusBadge tone="neutral">Today</StatusBadge>}
          </div>
          <PeriodList periods={selectedPeriods} />
        </div>
      )}

      {mode === "exam" && (
        <div className={styles.view}>
          <p className="section-label">Mid-term examinations · 1–9 September</p>
          <div className={styles.viewHead}>
            <h2 className={styles.viewTitle}>Exam date sheet</h2>
          </div>
          <div className="table--scroll">
            <table className="table">
              <caption className="sr-only">Mid-term examination date sheet for Class 8-A</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Time</th>
                  <th scope="col">Room</th>
                </tr>
              </thead>
              <tbody>
                {dateSheet.map((slot) => (
                  <tr key={slot.dateIso}>
                    <td className="num">
                      {slot.dayLabel} {slot.dateLabel}
                    </td>
                    <td>
                      <strong>{slot.subject}</strong>
                    </td>
                    <td className="num">{slot.time}</td>
                    <td>{slot.room}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.note}>
            The date sheet is also posted on the notice board. Mid-term examinations run 1–9 September; classes
            continue on 10 September.
          </p>
        </div>
      )}

      <p className={styles.printNote}>
        Use your browser&apos;s print option to keep a copy — all three views print as they appear.
      </p>
    </section>
  );
}
