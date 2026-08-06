"use client";

import { useRef, useState } from "react";
import type { Period } from "@/modules/academics/demo";
import {
  detectEditConflict,
  TIMETABLE_CLASS,
  timetableSubjects,
  timetableTeachers,
  validateDraft,
  type EditField,
} from "@/modules/services/timetable";

import styles from "./TimetableEditor.module.css";

type TimetableEditorProps = {
  timetable: Record<string, Period[]>;
  baseline: Record<string, Period[]>;
  weekDays: readonly string[];
  editedKeys: ReadonlySet<string>;
  preview: boolean;
  onEdit: (day: string, time: string, field: EditField, value: string) => void;
};

type BlockedEdit = { day: string; time: string; field: EditField; message: string; detail: string };

const FIELD_LABEL: Record<EditField, string> = { subject: "Subject", teacher: "Teacher", room: "Room" };

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

/**
 * Minimal Class 8-A timetable editor: one day at a time, read-only period
 * times, subject/teacher/room per class period. A conflicting edit is
 * blocked inline with the reason; the room field is checked when the cell
 * loses focus so typing is not interrupted.
 */
export function TimetableEditor({
  timetable,
  baseline,
  weekDays,
  editedKeys,
  preview,
  onEdit,
}: TimetableEditorProps) {
  const [day, setDay] = useState(weekDays[0] ?? "Monday");
  const [blocked, setBlocked] = useState<BlockedEdit | null>(null);
  const roomStart = useRef<{ value: string } | null>(null);

  const periods = timetable[day] ?? [];
  const issues = validateDraft(timetable, editedKeys);
  const issueFor = (key: string, field: EditField) =>
    issues.find((issue) => issue.key === key && issue.field === field);

  function attemptEdit(time: string, field: EditField, value: string) {
    const current = timetable[day]?.find((p) => p.time === time);
    if (!current) return;
    if (value.trim() === "") {
      setBlocked({
        day,
        time,
        field,
        message: `${FIELD_LABEL[field]} is required for every edited period — choose a value or keep the current one.`,
        detail: `The ${field.toLowerCase()} of ${day} ${time} was left empty.`,
      });
      return;
    }
    const conflict = detectEditConflict(timetable, { day, time, field, value }, TIMETABLE_CLASS);
    if (conflict) {
      setBlocked({ day, time, field, message: conflict.message, detail: conflict.detail });
      return;
    }
    setBlocked(null);
    onEdit(day, time, field, value);
  }

  function focusRoom(time: string) {
    const period = timetable[day]?.find((p) => p.time === time);
    roomStart.current = { value: period?.room ?? "" };
  }

  function commitRoom(time: string) {
    const start = roomStart.current;
    roomStart.current = null;
    const period = timetable[day]?.find((p) => p.time === time);
    if (!period) return;
    if (start && start.value === period.room) return;
    const conflict = detectEditConflict(timetable, { day, time, field: "room", value: period.room }, TIMETABLE_CLASS);
    if (conflict) {
      onEdit(day, time, "room", start?.value ?? "");
      setBlocked({ day, time, field: "room", message: conflict.message, detail: conflict.detail });
    }
  }

  function renderSelect(key: string, time: string, field: EditField, value: string, options: readonly string[]) {
    const issue = issueFor(key, field);
    const isBlockedCell =
      blocked !== null && blocked.day === day && blocked.time === time && blocked.field === field;
    return (
      <>
        <select
          aria-label={`${day} ${time} ${field}`}
          value={value}
          onChange={(event) => attemptEdit(time, field, event.target.value)}
          aria-invalid={issue !== undefined || isBlockedCell || undefined}
          aria-describedby={
            issue !== undefined
              ? `error-${key}-${field}`
              : isBlockedCell
                ? "editor-block-alert"
                : undefined
          }
          className={issue !== undefined || isBlockedCell ? styles.invalid : undefined}
        >
          <option value="">Select {FIELD_LABEL[field].toLowerCase()}…</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {issue !== undefined ? (
          <span id={`error-${key}-${field}`} className={styles.fieldError}>
            {FIELD_LABEL[field]} is required.
          </span>
        ) : null}
      </>
    );
  }

  function renderRoom(key: string, time: string, value: string) {
    const issue = issueFor(key, "room");
    const isBlockedCell =
      blocked !== null && blocked.day === day && blocked.time === time && blocked.field === "room";
    if (preview) return <span>{value}</span>;
    return (
      <>
        <input
          type="text"
          aria-label={`${day} ${time} room`}
          value={value}
          onFocus={() => focusRoom(time)}
          onChange={(event) => onEdit(day, time, "room", event.target.value)}
          onBlur={() => commitRoom(time)}
          aria-invalid={issue !== undefined || isBlockedCell || undefined}
          aria-describedby={
            issue !== undefined
              ? `error-${key}-room`
              : isBlockedCell
                ? "editor-block-alert"
                : undefined
          }
          className={issue !== undefined || isBlockedCell ? styles.invalid : undefined}
        />
        {issue !== undefined ? (
          <span id={`error-${key}-room`} className={styles.fieldError}>
            Room is required.
          </span>
        ) : null}
      </>
    );
  }

  return (
    <div className={styles.editor}>
      <div className={`tabs ${styles.dayTabs}`} role="group" aria-label="Editing day">
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

      <div className={styles.meta}>
        <p role="status" className={styles.editedCount}>
          {editedKeys.size === 0
            ? "No periods edited this draft."
            : `${editedKeys.size} period${editedKeys.size === 1 ? "" : "s"} edited this draft.`}
        </p>
        {preview ? (
          <p className={styles.previewNote}>
            Preview — the draft is shown read-only. Nothing changes for anyone until a version is published.
          </p>
        ) : null}
      </div>

      {blocked !== null ? (
        <div id="editor-block-alert" role="alert" className={`alert-strip alert-strip--warning ${styles.blockedStrip}`}>
          <p className={styles.blockedMessage}>{blocked.message}</p>
          <p className={styles.blockedDetail}>
            {blocked.detail} The edit to {blocked.day} {blocked.time} was not applied.
          </p>
        </div>
      ) : null}

      <div className="table--scroll">
        <table className={`table ${styles.editorTable}`}>
          <caption className="sr-only">
            Editable Class {TIMETABLE_CLASS} timetable for {day} — subject, teacher, and room per period
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Time</th>
              <th scope="col">Subject</th>
              <th scope="col">Teacher</th>
              <th scope="col">Room</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period, index) => {
              const key = `${day}|${period.time}`;
              const editable = period.kind !== "break" && period.kind !== "assembly";
              const changed = editedKeys.has(key) || period.change === true;
              if (!editable) {
                return (
                  <tr key={key} className={styles.kindRow}>
                    <td className="num">{periodNumber(periods, index)}</td>
                    <th scope="row">
                      <time dateTime={period.time}>{period.time}</time>
                    </th>
                    <td>{period.subject}</td>
                    <td>{period.teacher}</td>
                    <td>{period.room}</td>
                    <td className={styles.statusCell}>Fixed</td>
                  </tr>
                );
              }
              return (
                <tr key={key} className={changed ? styles.changedRow : undefined}>
                  <td className="num">{periodNumber(periods, index)}</td>
                  <th scope="row">
                    <time dateTime={period.time}>{period.time}</time>
                  </th>
                  <td>
                    {preview ? (
                      period.subject
                    ) : (
                      renderSelect(key, period.time, "subject", period.subject, timetableSubjects)
                    )}
                  </td>
                  <td>
                    {preview ? (
                      period.teacher
                    ) : (
                      renderSelect(key, period.time, "teacher", period.teacher, timetableTeachers)
                    )}
                  </td>
                  <td>{renderRoom(key, period.time, period.room)}</td>
                  <td className={styles.statusCell}>
                    {changed ? <span className={styles.changedNote}>Changed</span> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
