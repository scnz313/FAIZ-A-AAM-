"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ExamSlot, Period } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import {
  dateForTimetableWeekday,
  demoDateForWeekday,
  timetableDemoWeekday,
  timetableWeekdayForInstant,
  type TimetableOverride,
  type TimetablePortalVersion,
} from "@/modules/services/timetable";

import styles from "./TimetableWorkspace.module.css";

type Mode = "day" | "week" | "exam";

const MODES: ReadonlyArray<{ key: Mode; label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "exam", label: "Exam date sheet" },
];

/** Short human date like "01 Sep" for the exam date sheet (fixture format). */
function shortDateLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(parts[1]) - 1] ?? parts[1] ?? "";
  return `${parts[2]} ${month}`;
}

/** First and last exam dates from the date-sheet fixture, e.g. "1–9 September".
 *  A date sheet that covers a single day reads "6 October", never "6–6 October". */
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
  if (firstMonth === lastMonth) return firstDay === lastDay ? `${firstDay} ${lastMonth}` : `${firstDay}–${lastDay} ${lastMonth}`;
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

type TimetableWorkspaceProps = {
  timetable: Record<string, Period[]>;
  weekDays: readonly string[];
  dateSheet: ExamSlot[];
  className?: string;
  /** Published base version metadata; null when nothing is published. */
  version: TimetablePortalVersion | null;
  /** Active overrides for the section — already projected into `timetable`. */
  overrides: TimetableOverride[];
  dateSheetVersion: number | null;
  dateSheetPublishedAtIso: string | null;
  /** UTC instant from the server; absent in demo mode. */
  todayIso?: string;
  live: boolean;
};

/**
 * Client timetable island — V15 aligned. Uses the V15 seg controls for view
 * switching, Panel with flush ledger tables for day/week/exam views. All data
 * is the server-resolved projection passed from the page: this component
 * performs no reads, so a child switch or failed read can never leave a stale
 * section view behind.
 */
export function TimetableWorkspace({
  timetable,
  weekDays,
  dateSheet,
  className,
  version,
  overrides,
  dateSheetVersion,
  dateSheetPublishedAtIso,
  todayIso,
  live,
}: TimetableWorkspaceProps) {
  const [mode, setMode] = useState<Mode>("day");
  /* "Today" is the real Kolkata weekday in live mode (instant passed from the
     server so SSR and hydration agree) and the injected demo clock in demo
     mode; never the wall clock at render time. */
  const demoDay = timetableDemoWeekday();
  const liveToday = live && todayIso ? timetableWeekdayForInstant(todayIso) : null;
  const currentDay = live ? liveToday : demoDay;
  const firstDay = weekDays[0] ?? "";
  const [day, setDay] = useState(
    currentDay !== null && weekDays.includes(currentDay) ? currentDay : firstDay,
  );
  useEffect(() => {
    if (!weekDays.includes(day)) {
      setDay(currentDay !== null && weekDays.includes(currentDay) ? currentDay : firstDay);
    }
  }, [weekDays, day, currentDay, firstDay]);

  const selectedIso = live
    ? (version?.effectiveFromIso ? dateForTimetableWeekday(day, version.effectiveFromIso) : null)
    : demoDateForWeekday(day);
  const selectedOverrides = overrides.filter(
    (override) => override.revokedAtIso === null && selectedIso !== null && override.dateIso === selectedIso,
  );
  const selectedPeriods = timetable[day] ?? [];
  const isToday = currentDay !== null && day === currentDay;

  return (
    <>
      {/* V15 row-between: seg view switcher + day selector */}
      <div className={styles.toolbarRow}>
        <div className="seg" role="tablist" aria-label="Timetable view">
          {MODES.map((entry) => (
            <button
              key={entry.key}
              role="tab"
              aria-selected={mode === entry.key}
              className={mode === entry.key ? "on" : undefined}
              onClick={() => setMode(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {mode === "day" ? (
          <div className="seg" role="tablist" aria-label="Weekday">
            {weekDays.map((weekDay) => (
              <button
                key={weekDay}
                role="tab"
                aria-selected={day === weekDay}
                className={day === weekDay ? "on" : undefined}
                onClick={() => setDay(weekDay)}
              >
                {weekDay}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Day view — V15 Panel with flush ledger table */}
      {mode === "day" && (
        <section className="panel">
          <div className="pn-head">
            <h2>{day} · {className ?? "selected section"}</h2>
            {isToday ? <StatusBadge tone="neutral">Today</StatusBadge> : null}
          </div>
          <div className="pn-body flush">
            {version !== null ? (
              <p className={styles.noteLine}>
                Showing published v{version.version}
                {version.publishedAtIso ? ` (published ${formatKolkata(version.publishedAtIso, { format: "day" })})` : ""}
                {version.note ? ` · ${version.note}` : ""}.
              </p>
            ) : null}
            {selectedOverrides.length > 0 ? (
              <p className={styles.noteLine}>
                {selectedOverrides.length} date override{selectedOverrides.length === 1 ? "" : "s"} {selectedOverrides.length === 1 ? "applies" : "apply"} {isToday ? "today" : `on ${day}`} · marked below.
              </p>
            ) : null}
            {selectedPeriods.length === 0 ? (
              <div className="pn-body">
                <p className={styles.noteLine}>No periods are published for {day}.</p>
              </div>
            ) : (
              <div className="table-wrap" role="region" aria-label={`${day} timetable table`} tabIndex={0}>
                <table className={`ledger ${styles.ledgerTable} ${styles.dayTable}`}>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Subject</th>
                      <th>Teacher</th>
                      <th>Room</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPeriods.map((period, index) => {
                      const isBreak = period.kind === "break" || period.kind === "assembly";
                      return (
                        <tr key={`${period.time}-${period.subject}-${index}`} className={isBreak ? styles.breakRow : undefined}>
                          <td className="num strong">{periodNumber(selectedPeriods, index)}</td>
                          <td className={styles.subjectCell}>
                            <strong className={isBreak ? undefined : styles.subjectName}>{period.subject}</strong>
                            {period.change ? (
                              <span className={`chip ${styles.overrideChip}`}>
                                Override · this week
                              </span>
                            ) : null}
                          </td>
                          <td className="small muted">{period.teacher}</td>
                          <td className="num small">{period.room}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Week view — V15 Panel with flush grid ledger */}
      {mode === "week" && (
        <section className="panel">
          <div className="pn-head">
            <h2>Week at a glance</h2>
            {version !== null ? <StatusBadge tone="neutral">v{version.version}</StatusBadge> : null}
          </div>
          <div className="pn-body flush">
            {weekDays.length === 0 ? (
              <div className="pn-body">
                <p className={styles.noteLine}>No published periods to show for this week.</p>
              </div>
            ) : (
            <div className="table-wrap" role="region" aria-label="Week at a glance table" tabIndex={0}>
              <table className={`ledger ${styles.ledgerTable} ${styles.weekTable}`}>
                <thead>
                  <tr>
                    <th>Pd</th>
                    {weekDays.map((d) => <th key={d}>{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(timetable[weekDays[0] ?? ""] ?? []).map((_: Period, pi: number) => {
                    const firstDayPeriods = timetable[weekDays[0] ?? ""] ?? [];
                    const periodLabel = periodNumber(firstDayPeriods, pi);
                    return (
                      <tr key={pi}>
                        <td className="num strong">{periodLabel}</td>
                        {weekDays.map((d) => {
                          const cell = timetable[d]?.[pi];
                          if (!cell) return <td key={d} className="small muted">Free</td>;
                          const isBreak = cell.kind === "break" || cell.kind === "assembly";
                          return (
                            <td key={d} className="small" style={isBreak ? { background: "var(--chalk-2)" } : undefined}>
                              <span className="strong">{cell.subject}</span>
                              {!isBreak && <div className="tiny muted num">{cell.room}</div>}
                              {cell.change && <span className="tiny" style={{ color: "var(--saffron-ink)", fontWeight: 700 }}>Override</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </section>
      )}

      {/* Exam date sheet — V15 Panel with flush ledger */}
      {mode === "exam" && (
        <section className="panel">
          <div className="pn-head">
            <h2>Exam date sheet</h2>
            {dateSheetVersion !== null ? (
              <StatusBadge tone="good">v{dateSheetVersion} · published</StatusBadge>
            ) : dateSheet.length > 0 ? (
              <span className="tiny muted">Demo fixture · not sealed</span>
            ) : (
              <span className="tiny muted">Not published</span>
            )}
          </div>
          <div className="pn-body flush">
            {dateSheet.length === 0 ? (
              <div className="pn-body">
                <p className={styles.noteLine}>No exam dates are published for this section yet.</p>
              </div>
            ) : (
              <div className="table-wrap" role="region" aria-label="Exam date sheet table" tabIndex={0}>
                <table className={`ledger ${styles.ledgerTable} ${styles.examTable}`}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Day</th>
                      <th>Paper</th>
                      <th>Venue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dateSheet.map((slot) => (
                      <tr key={slot.dateIso}>
                        <td className="num strong">{slot.dateLabel || shortDateLabel(slot.dateIso)}</td>
                        <td className="small">{slot.dayLabel}</td>
                        <td className="strong">{slot.subject}</td>
                        <td className="small muted">{slot.room}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {dateSheetVersion !== null ? (
            <div className="pn-body" style={{ paddingTop: 12 }}>
              <p className="tiny muted" style={{ marginTop: 6 }}>
                {dateSheetPublishedAtIso ? `Published ${formatKolkata(dateSheetPublishedAtIso, { format: "day" })}. ` : ""}
                {examRange(dateSheet) !== null
                  ? `Mid-term examinations run ${examRange(dateSheet)}; classes continue the following school day.`
                  : "Dates appear once the school publishes the date sheet."}
              </p>
            </div>
          ) : null}
        </section>
      )}

      {/* V15 callout for overrides/versions info */}
      <div className={styles.calloutWrap}>
        <div className="callout">
          <span className="msym" style={{ fontSize: 20, flex: "none", marginTop: 1, color: "var(--ink-3)" }}>info</span>
          <span className="small">
            <strong>Overrides and versions.</strong>{" "}
            {version !== null
              ? `The published base timetable is v${version.version}${version.effectiveFromIso ? `, effective ${version.effectiveFromIso}` : ""}.`
              : "The published base timetable is shown."}{" "}
            {overrides.length > 0
              ? `${overrides.length} active date-specific override${overrides.length === 1 ? "" : "s"} layer on top and ${overrides.length === 1 ? "is" : "are"} marked where ${overrides.length === 1 ? "it applies" : "they apply"}.`
              : "A date-specific override layers on top and is marked where it applies."}{" "}
            The exam date sheet is always kept separate from the teaching timetable.
          </span>
        </div>
      </div>
    </>
  );
}

export default TimetableWorkspace;
