"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ExamSlot, Period } from "@/modules/academics/demo";
import { timetableDemoWeekday, timetableService, type TimetableOverride, type TimetableVersion } from "@/modules/services/timetable";

import styles from "./TimetableWorkspace.module.css";

type Mode = "day" | "week" | "exam";

const MODES: ReadonlyArray<{ key: Mode; label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "exam", label: "Exam date sheet" },
];

const DAY_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Date label for a weekday in the demo week (Mon 3 Aug – Sat 8 Aug 2026). */
function dayDateLabel(day: string): string {
  const iso = timetableService.demoDateForWeekday(day);
  return iso === null ? "" : DAY_DATE_FORMATTER.format(new Date(`${iso}T00:00:00.000Z`));
}

/** Short human date like "01 Sep" for the exam date sheet (fixture format). */
function shortDateLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(parts[1]) - 1] ?? parts[1] ?? "";
  return `${parts[2]} ${month}`;
}

/** First and last exam dates from the date-sheet fixture, e.g. "1–9 September". */
function examRange(dateSheet: ExamSlot[]): string | null {
  const dates = dateSheet.map((slot) => slot.dateIso).filter(Boolean).sort();
  if (dates.length === 0) return null;
  const first = dates[0] ?? "";
  const last = dates[dates.length - 1] ?? first;
  const firstDay = Number(first.slice(8, 10));
  const lastDay = Number(last.slice(8, 10));
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const firstMonth = months[Number(first.slice(5, 7)) - 1] ?? "";
  const lastMonth = months[Number(last.slice(5, 7)) - 1] ?? "";
  if (firstMonth === lastMonth) return `${firstDay}–${lastDay} ${lastMonth}`;
  return `${firstDay} ${firstMonth} – ${lastDay} ${lastMonth}`;
}

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

function PeriodList({ periods, overrideCount }: { periods: Period[]; overrideCount: number }) {
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
                  {overrideCount > 0 ? "Date override" : "Changed"}
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
  className?: string;
  /** Retained for call-site compatibility; "today" comes from the demo clock. */
  today?: string;
};

/**
 * Client timetable island: Day / Week / Exam date-sheet views with a
 * print fallback. All data is demo data passed from the server page.
 */
export function TimetableWorkspace({ timetable, weekDays, dateSheet, className }: TimetableWorkspaceProps) {
  const [mode, setMode] = useState<Mode>("day");
  /* "Today" is defined by the injected demo clock, not the wall clock. */
  const demoDay = timetableDemoWeekday();
  const [day, setDay] = useState(demoDay);
  /* A staff-published session version replaces the fixture view. */
  const [sessionVersion, setSessionVersion] = useState<TimetableVersion | null>(null);
  const [overrides, setOverrides] = useState<TimetableOverride[]>([]);
  const [dateSheetVersion, setDateSheetVersion] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    /* Only classes with a timetable render this workspace (8-A in the demo), so the default class key applies. */
    void timetableService
      .getTimetableVersion(className)
      .then((version) => {
        if (active) setSessionVersion(version);
      })
      .catch(() => {
        if (!active) return;
      });
    /* Date-specific overrides from the same facade — a staff override
       immediately shows here for the session (demo). */
    setOverrides(timetableService.listTimetableOverrides(className));
    void timetableService.getDateSheetState(className).then((state) => {
      if (active) setDateSheetVersion(state?.published ? state.version : null);
    }).catch(() => {
      if (active) setDateSheetVersion(null);
    });
    return () => {
      active = false;
    };
  }, [className]);
  const source = sessionVersion?.periods ?? timetable;

  const todayIso = timetableService.demoDateForWeekday(demoDay);
  const selectedIso = timetableService.demoDateForWeekday(day);
  const activeOverrides = overrides.filter((override) => override.revokedAtIso === null);
  const todayOverrides = activeOverrides.filter((override) => override.dateIso === todayIso);
  const selectedOverrides = activeOverrides.filter((override) => override.dateIso === selectedIso);
  const todayPeriods =
    todayOverrides.length > 0 && todayIso !== null
      ? timetableService.effectivePeriodsForDate(todayIso, className)
      : (source[demoDay] ?? []);
  const selectedPeriods =
    selectedOverrides.length > 0 && selectedIso !== null
      ? timetableService.effectivePeriodsForDate(selectedIso, className)
      : (source[day] ?? []);
  const dateSheetPublishedBadge =
    dateSheetVersion !== null ? <StatusBadge tone="good">v{dateSheetVersion} · published</StatusBadge> : null;

  return (
    <section className={`panel ${styles.workspace}`} aria-label={`Timetable for Class ${className ?? "selected section"}`}>
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
            {demoDay} · {dayDateLabel(demoDay)} · demo date
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
          {todayOverrides.length > 0 ? (
            <p className={styles.note}>
              {todayOverrides.length} date override{todayOverrides.length === 1 ? "" : "s"}{" "}
              {todayOverrides.length === 1 ? "applies" : "apply"} today — marked below.
            </p>
          ) : null}
          <PeriodList periods={todayPeriods} overrideCount={todayOverrides.length} />
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
            {day} · {dayDateLabel(day)}
          </p>
          <div className={styles.viewHead}>
            <h2 className={styles.viewTitle}>{day}&apos;s timetable</h2>
            {day === demoDay && <StatusBadge tone="neutral">Today</StatusBadge>}
          </div>
          {selectedOverrides.length > 0 ? (
            <p className={styles.note}>
              {selectedOverrides.length} date override{selectedOverrides.length === 1 ? "" : "s"}{" "}
              {selectedOverrides.length === 1 ? "applies" : "apply"} on {day} — marked below.
            </p>
          ) : null}
          <PeriodList periods={selectedPeriods} overrideCount={selectedOverrides.length} />
        </div>
      )}

      {mode === "exam" && (
        <div className={styles.view}>
          <p className="section-label">Mid-term examinations · {examRange(dateSheet) ?? "dates pending"}</p>
          <div className={styles.viewHead}>
            <h2 className={styles.viewTitle}>Exam date sheet</h2>
            {dateSheetPublishedBadge}
          </div>
          {dateSheet.length === 0 ? (
            <p className={styles.note}>No exam dates are published for this section yet.</p>
          ) : (
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
          )}
          <p className={styles.note}>
            The date sheet is also posted on the notice board. {examRange(dateSheet) !== null ? `Mid-term examinations run ${examRange(dateSheet)}; classes continue the following school day.` : "Dates appear once the school publishes the date sheet."}
          </p>
        </div>
      )}

      <p className={styles.printNote}>
        Use your browser&apos;s print option to keep a copy — all three views print as they appear.
      </p>
    </section>
  );
}
