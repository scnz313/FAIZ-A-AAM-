/**
 * Timetable service — the single authoritative timetable facade for the
 * Class 8-A timetable editor and the portal timetable view (I2 item 4).
 *
 * One service owns version metadata, the published period snapshot, the
 * append-only version history, drafts, and conflict detection, keyed by
 * class ("8-A"). Staff editing and portal reads go through this same
 * facade (`timetableService`), so a staff publish immediately replaces the
 * portal view in the session. The former timetable stub in the academics
 * service is gone — nothing here consults `academicsService` any more, and
 * the academics results session is never touched by timetable writes.
 *
 * A fresh session shows the fixture timetable and version 1 for Class 8-A
 * (the only class with demo data). Classes without timetable data return
 * the honest "not published" state (null/empty) instead of leaking the
 * 8-A fixture.
 *
 * Everything here is fictional demo data. No server persistence.
 */

import { timetableByDay, weekDays, type Period } from "@/modules/academics/demo";
import { demoNowIso } from "@/modules/demo/clock";
import { sessionGet, sessionKey, sessionRemove, sessionSet } from "@/modules/services/session";

/** The demo class owned by this facade; other classes have no timetable data. */
export const TIMETABLE_CLASS = "8-A";

/** Demo week carried by published versions. */
export const TIMETABLE_WEEK = "2026-08-03";

/** Home room used by the Class 8-A fixture (also a suggested fix target). */
const HOME_ROOM = "Room 21 · 8-A";

/* ------------------------------------------------------------------ */
/* Contracts                                                            */
/* ------------------------------------------------------------------ */

/** One period change carried by a publish. */
export type TimetablePeriodEdit = {
  day: string;
  time: string;
  subject: string;
  teacher: string;
  room: string;
};

/** A published timetable: version metadata plus the period snapshot. */
export type TimetableVersion = {
  className: string;
  weekOf: string;
  version: number;
  note?: string;
  publishedAtIso?: string;
  periods: Record<string, Period[]>;
};

export type TimetableVersionEntry = {
  version: number;
  note: string;
  publishedAtIso: string;
  by: string;
  /** True when published in this browser session (fixture history is not). */
  session: boolean;
};

export type DraftNote = {
  conflictMessage: string;
  reason: string;
  atIso: string;
};

export type TimetableDraft = {
  savedAtIso: string;
  periods: Record<string, Period[]>;
  notes: DraftNote[];
};

/* ------------------------------------------------------------------ */
/* Session storage (per class)                                          */
/* ------------------------------------------------------------------ */

function sessionSlug(className: string): string {
  return className.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function periodsKey(className: string): string {
  return sessionKey(`timetable:${sessionSlug(className)}:periods`);
}

function historyKey(className: string): string {
  return sessionKey(`timetable:${sessionSlug(className)}:history`);
}

function draftKey(className: string): string {
  return sessionKey(`timetable:${sessionSlug(className)}:draft`);
}

/* ------------------------------------------------------------------ */
/* Class keys and known classes                                         */
/* ------------------------------------------------------------------ */

/**
 * Every grade section in this demo ("Class 8 · A" and "Class 9 · C").
 * "9-C" is a known section without timetable data yet — use
 * `listKnownClasses()` for the section list and `isKnownTimetableClass()`
 * for data availability.
 */
export const TIMETABLE_KNOWN_CLASSES: readonly string[] = ["8-A", "9-C"];

/**
 * Stable class key for a grade section ("Class 8" + "A" → "8-A"). The
 * portal derives its timetable class from the active child's enrollment
 * placement this way; placements without timetable data get the honest
 * not-published state.
 */
export function classKeyForGradeSection(gradeSection: { gradeLabel: string; sectionLabel: string }): string {
  return `${gradeSection.gradeLabel.replace(/^Class\s+/i, "")}-${gradeSection.sectionLabel}`;
}

/**
 * True only when the class has timetable data in this demo (the 8-A
 * fixture or a session-published version). Known-but-empty classes come
 * from `listKnownClasses()`.
 */
export function isKnownTimetableClass(className: string): boolean {
  return className === TIMETABLE_CLASS;
}

/** A copy of the demo's known class keys ("8-A", "9-C"). */
export function listKnownClasses(): string[] {
  return [...TIMETABLE_KNOWN_CLASSES];
}

/* ------------------------------------------------------------------ */
/* Baseline fixture version                                             */
/* ------------------------------------------------------------------ */

/** Fixture baseline: the fixture timetable is numbered version 1. */
export const fixtureVersion: TimetableVersionEntry = {
  version: 1,
  note: "Initial fixture timetable — effective Mon 3 Aug 2026",
  publishedAtIso: "2026-08-03T03:00:00Z",
  by: "Timetable office",
  session: false,
};

/* ------------------------------------------------------------------ */
/* Peer-class fixture (9-B)                                             */
/* ------------------------------------------------------------------ */

/**
 * Fictional peer-class fixture used only to demonstrate cross-class
 * conflict detection. It makes the two documented demo conflicts real:
 * M. Wani teaches 9-B at Mon 14:15, and 9-B uses the Computer lab at
 * Thu 13:30 — the same slot as 8-A's Computer Science period. No other
 * slot in this fixture clashes with Class 8-A.
 */
export const peerClassTimetables: Record<string, Record<string, Period[]>> = {
  "9-B": {
    Monday: [
      { time: "08:30", subject: "Morning assembly", teacher: "All staff", room: "Ground", kind: "assembly" },
      { time: "08:45", subject: "Science", teacher: "S. Naseer", room: "Lab 2" },
      { time: "09:30", subject: "English", teacher: "P. Shah", room: "Room 11 · 9-B" },
      { time: "10:15", subject: "Urdu", teacher: "A. Dar", room: "Room 11 · 9-B" },
      { time: "11:00", subject: "Break", teacher: "—", room: "Courtyard", kind: "break" },
      { time: "11:15", subject: "Mathematics", teacher: "T. Baba", room: "Room 11 · 9-B" },
      { time: "12:00", subject: "Social Science", teacher: "Z. Khan", room: "Room 11 · 9-B" },
      { time: "12:45", subject: "Lunch", teacher: "—", room: "Dining hall", kind: "break" },
      { time: "13:30", subject: "Kashmiri", teacher: "H. Mir", room: "Room 11 · 9-B" },
      { time: "14:15", subject: "Mathematics", teacher: "M. Wani", room: "Room 11 · 9-B" },
    ],
    Tuesday: [
      { time: "08:30", subject: "Morning assembly", teacher: "All staff", room: "Ground", kind: "assembly" },
      { time: "08:45", subject: "Mathematics", teacher: "T. Baba", room: "Room 11 · 9-B" },
      { time: "09:30", subject: "Science", teacher: "S. Naseer", room: "Lab 2" },
      { time: "10:15", subject: "English", teacher: "P. Shah", room: "Room 11 · 9-B" },
      { time: "11:00", subject: "Break", teacher: "—", room: "Courtyard", kind: "break" },
      { time: "11:15", subject: "Urdu", teacher: "A. Dar", room: "Room 11 · 9-B" },
      { time: "12:00", subject: "Kashmiri", teacher: "H. Mir", room: "Room 11 · 9-B" },
      { time: "12:45", subject: "Lunch", teacher: "—", room: "Dining hall", kind: "break" },
      { time: "13:30", subject: "Social Science", teacher: "Z. Khan", room: "Room 11 · 9-B" },
      { time: "14:15", subject: "Physical education", teacher: "V. Raina", room: "Field B" },
    ],
    Wednesday: [
      { time: "08:30", subject: "Morning assembly", teacher: "All staff", room: "Ground", kind: "assembly" },
      { time: "08:45", subject: "Social Science", teacher: "Z. Khan", room: "Room 11 · 9-B" },
      { time: "09:30", subject: "Science", teacher: "S. Naseer", room: "Lab 2" },
      { time: "10:15", subject: "Mathematics", teacher: "T. Baba", room: "Room 11 · 9-B" },
      { time: "11:00", subject: "Break", teacher: "—", room: "Courtyard", kind: "break" },
      { time: "11:15", subject: "English", teacher: "P. Shah", room: "Room 11 · 9-B" },
      { time: "12:00", subject: "Computer Science", teacher: "L. Koul", room: "Lab 2" },
      { time: "12:45", subject: "Lunch", teacher: "—", room: "Dining hall", kind: "break" },
      { time: "13:30", subject: "Urdu", teacher: "A. Dar", room: "Room 11 · 9-B" },
      { time: "14:15", subject: "Kashmiri", teacher: "H. Mir", room: "Room 11 · 9-B" },
    ],
    Thursday: [
      { time: "08:30", subject: "Morning assembly", teacher: "All staff", room: "Ground", kind: "assembly" },
      { time: "08:45", subject: "Urdu", teacher: "A. Dar", room: "Room 11 · 9-B" },
      { time: "09:30", subject: "Mathematics", teacher: "T. Baba", room: "Room 11 · 9-B" },
      { time: "10:15", subject: "English", teacher: "P. Shah", room: "Room 11 · 9-B" },
      { time: "11:00", subject: "Break", teacher: "—", room: "Courtyard", kind: "break" },
      { time: "11:15", subject: "Kashmiri", teacher: "H. Mir", room: "Room 11 · 9-B" },
      { time: "12:00", subject: "Science", teacher: "S. Naseer", room: "Lab 2" },
      { time: "12:45", subject: "Lunch", teacher: "—", room: "Dining hall", kind: "break" },
      { time: "13:30", subject: "Computer Science", teacher: "L. Koul", room: "Computer lab" },
      { time: "14:15", subject: "Art & craft", teacher: "R. Bhat", room: "Craft room" },
    ],
    Friday: [
      { time: "08:30", subject: "Morning assembly", teacher: "All staff", room: "Ground", kind: "assembly" },
      { time: "08:45", subject: "English", teacher: "P. Shah", room: "Room 11 · 9-B" },
      { time: "09:30", subject: "Mathematics", teacher: "T. Baba", room: "Room 11 · 9-B" },
      { time: "10:15", subject: "Urdu", teacher: "A. Dar", room: "Room 11 · 9-B" },
      { time: "11:00", subject: "Break", teacher: "—", room: "Courtyard", kind: "break" },
      { time: "11:15", subject: "Science", teacher: "S. Naseer", room: "Lab 2" },
      { time: "12:00", subject: "Kashmiri", teacher: "H. Mir", room: "Room 11 · 9-B" },
      { time: "12:45", subject: "Lunch", teacher: "—", room: "Dining hall", kind: "break" },
      { time: "13:30", subject: "Physical education", teacher: "V. Raina", room: "Field B" },
      { time: "14:15", subject: "Social Science", teacher: "Z. Khan", room: "Room 11 · 9-B" },
    ],
    Saturday: [
      { time: "08:30", subject: "Morning assembly", teacher: "All staff", room: "Ground", kind: "assembly" },
      { time: "08:45", subject: "Remedial — Mathematics", teacher: "T. Baba", room: "Room 11 · 9-B" },
      { time: "09:30", subject: "Remedial — English", teacher: "P. Shah", room: "Room 11 · 9-B" },
      { time: "10:15", subject: "Remedial — Science", teacher: "S. Naseer", room: "Lab 2" },
      { time: "11:00", subject: "Break", teacher: "—", room: "Courtyard", kind: "break" },
      { time: "11:15", subject: "House activities", teacher: "V. Raina", room: "Field B" },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Conflict model                                                       */
/* ------------------------------------------------------------------ */

export type TimetableConflictKind = "claim" | "teacher" | "room";

export type TimetableConflict = {
  id: string;
  kind: TimetableConflictKind;
  message: string;
  day: string;
  time: string;
  /** Why the conflict exists — shown in the resolve panel. */
  detail: string;
  counterpart?: { className: string; day: string; time: string };
};

/**
 * The two documented demo conflicts, kept verbatim from the fixtures.
 * "conflict-2" (room) is also produced live by detectConflicts; the
 * dedupe in initialOpenConflicts keeps the live row.
 */
export const demoConflictClaims: ReadonlyArray<TimetableConflict> = [
  {
    id: "conflict-1",
    kind: "claim",
    message: "Teacher M. Wani double-booked Mon 14:15 (8-A vs 9-B)",
    day: "Monday",
    time: "14:15",
    detail:
      "The peer fixture assigns M. Wani to Class 9-B at Mon 14:15. The claim is cleared by changing the 8-A Mon 14:15 assignment so no teacher is double-booked, and recording why.",
    counterpart: { className: "9-B", day: "Monday", time: "14:15" },
  },
  {
    id: "conflict-2",
    kind: "claim",
    message: "Room Computer lab conflict Thu 13:30",
    day: "Thursday",
    time: "13:30",
    detail: "The peer fixture books the Computer lab for Class 9-B at Thu 13:30 — the same slot as 8-A's Computer Science period.",
    counterpart: { className: "9-B", day: "Thursday", time: "13:30" },
  },
];

function isEditable(period: Period | undefined): period is Period {
  return period !== undefined && period.kind !== "break" && period.kind !== "assembly";
}

/** Short day names used in conflict messages, matching the fixture claims. */
const DAY_SHORT: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
};

function shortDay(day: string): string {
  return DAY_SHORT[day] ?? day;
}

/** Same-day-same-time rows of every peer class for a slot. */
function peersAt(slotDay: string, slotTime: string): Array<{ className: string; period: Period }> {
  const rows: Array<{ className: string; period: Period }> = [];
  for (const [className, days] of Object.entries(peerClassTimetables)) {
    const period = days[slotDay]?.find((p) => p.time === slotTime);
    if (period) rows.push({ className, period });
  }
  return rows;
}

/**
 * Live conflict scan: the same teacher or the same room assigned to two
 * different classes at the same day+time, compared across all days of the
 * class's own timetable and against the peer-class fixture. Break and
 * assembly rows never participate.
 */
export function detectConflicts(periods: Record<string, Period[]>, className = TIMETABLE_CLASS): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];
  for (const day of weekDays) {
    for (const period of periods[day] ?? []) {
      if (!isEditable(period)) continue;
      for (const { className: otherClass, period: other } of peersAt(day, period.time)) {
        if (!isEditable(other)) continue;
        if (period.teacher !== "—" && period.teacher !== "All staff" && period.teacher === other.teacher) {
          conflicts.push({
            id: `detected-teacher-${day}-${period.time}`,
            kind: "teacher",
            message: `Teacher ${period.teacher} double-booked ${shortDay(day)} ${period.time} (${className} vs ${otherClass})`,
            day,
            time: period.time,
            detail: `${period.teacher} teaches ${other.subject} in ${otherClass} at ${shortDay(day)} ${period.time}.`,
            counterpart: { className: otherClass, day, time: period.time },
          });
        }
        if (period.room !== "" && period.room === other.room) {
          conflicts.push({
            id: `detected-room-${day}-${period.time}`,
            kind: "room",
            message: `Room ${period.room} conflict ${shortDay(day)} ${period.time}`,
            day,
            time: period.time,
            detail: `Both ${className} and ${otherClass} use ${period.room} at ${shortDay(day)} ${period.time}.`,
            counterpart: { className: otherClass, day, time: period.time },
          });
        }
      }
    }
  }
  return conflicts;
}

export type EditField = "subject" | "teacher" | "room";

export type EditAttempt = { day: string; time: string; field: EditField; value: string };

/**
 * Rejects a proposed edit that would create a live conflict: the edited
 * teacher or room is already assigned to another class — or to another
 * period of the same class at the same day+time (compared across all
 * days) — at the same slot. The message names the other assignment so
 * the user can recover. Returns null for legal edits and subject changes.
 */
export function detectEditConflict(
  periods: Record<string, Period[]>,
  attempt: EditAttempt,
  className = TIMETABLE_CLASS,
): TimetableConflict | null {
  if (attempt.field === "subject") return null;
  const current = periods[attempt.day]?.find((p) => p.time === attempt.time);
  if (!isEditable(current)) return null;
  const value = attempt.value.trim();
  if (value === "") return null; // required-field errors are reported separately
  const candidate = { ...current, [attempt.field]: value };

  function report(kind: "teacher" | "room", other: Period, otherClass: string, occupied: string): TimetableConflict | null {
    const message =
      kind === "teacher"
        ? `${candidate.teacher} already teaches Class ${otherClass} at ${shortDay(attempt.day)} ${attempt.time} — choose another teacher or period.`
        : `${candidate.room} is already booked by Class ${otherClass} at ${shortDay(attempt.day)} ${attempt.time} — choose another room or period.`;
    return {
      id: `blocked-${attempt.day}-${attempt.time}`,
      kind,
      message,
      day: attempt.day,
      time: attempt.time,
      detail: `${other.subject} (${otherClass}) ${occupied} at ${shortDay(attempt.day)} ${attempt.time}.`,
      counterpart: { className: otherClass, day: attempt.day, time: attempt.time },
    };
  }

  // Own class first: any other period of the class at the same day+time
  // (none by construction — a slot holds one row — but the scan keeps the
  // rule literal across all days of the class's own timetable).
  for (const other of periods[attempt.day] ?? []) {
    if (other === current || other.time !== attempt.time) continue;
    if (!isEditable(other)) continue;
    if (attempt.field === "teacher" && candidate.teacher === other.teacher) {
      return report("teacher", other, className, `is taught by ${other.teacher}`);
    }
    if (attempt.field === "room" && candidate.room !== "" && candidate.room === other.room) {
      return report("room", other, className, `uses ${other.room}`);
    }
  }

  for (const { className: otherClass, period: other } of peersAt(attempt.day, attempt.time)) {
    if (!isEditable(other)) continue;
    if (attempt.field === "teacher") {
      if (candidate.teacher !== "—" && candidate.teacher !== "All staff" && candidate.teacher === other.teacher) {
        return report("teacher", other, otherClass, `is taught by ${other.teacher}`);
      }
    } else if (candidate.room === other.room) {
      return report("room", other, otherClass, `uses ${other.room}`);
    }
  }
  return null;
}

/** Open-conflict list for the editor: live detections plus fixture claims not covered by one. */
export function initialOpenConflicts(): TimetableConflict[] {
  const detected = detectConflicts(timetableByDay, TIMETABLE_CLASS);
  const seen = new Set(detected.map((conflict) => conflict.message));
  return [...detected, ...demoConflictClaims.filter((claim) => !seen.has(claim.message))];
}

/* ------------------------------------------------------------------ */
/* Draft validation and resolve rules                                   */
/* ------------------------------------------------------------------ */

/** Keys ("day|time") whose assignment differs from the baseline. */
export function deriveEditedKeys(
  periods: Record<string, Period[]>,
  baseline: Record<string, Period[]>,
): Set<string> {
  const keys = new Set<string>();
  for (const day of weekDays) {
    for (const period of periods[day] ?? []) {
      const base = baseline[day]?.find((b) => b.time === period.time);
      if (!base) continue;
      if (period.subject !== base.subject || period.teacher !== base.teacher || period.room !== base.room) {
        keys.add(`${day}|${period.time}`);
      }
    }
  }
  return keys;
}

export type DraftIssue = { key: string; day: string; time: string; field: EditField };

/** Every edited period must keep a subject, teacher, and room. */
export function validateDraft(
  periods: Record<string, Period[]>,
  editedKeys: ReadonlySet<string>,
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  for (const key of editedKeys) {
    const [day, time] = key.split("|");
    if (day === undefined || time === undefined) continue;
    const period = periods[day]?.find((p) => p.time === time);
    if (!period) continue;
    if (period.subject.trim() === "") issues.push({ key, day, time, field: "subject" });
    if (period.teacher.trim() === "") issues.push({ key, day, time, field: "teacher" });
    if (period.room.trim() === "") issues.push({ key, day, time, field: "room" });
  }
  return issues;
}

function assignmentChanged(
  periods: Record<string, Period[]>,
  baseline: Record<string, Period[]>,
  day: string,
  time: string,
): boolean {
  const period = periods[day]?.find((p) => p.time === time);
  const base = baseline[day]?.find((b) => b.time === time);
  if (!period || !base) return false;
  return period.subject !== base.subject || period.teacher !== base.teacher || period.room !== base.room;
}

export type ResolveResult = { ok: true } | { ok: false; error: string };

/**
 * A resolve is only accepted when the assignment changed (no resolve
 * without a change), the live clash for the slot is actually gone, and a
 * reason is recorded.
 */
export function validateResolve(
  conflict: TimetableConflict,
  periods: Record<string, Period[]>,
  baseline: Record<string, Period[]>,
  reason: string,
  className = TIMETABLE_CLASS,
): ResolveResult {
  if (reason.trim() === "") {
    return { ok: false, error: "A reason is required — explain why the conflict is gone." };
  }
  if (!assignmentChanged(periods, baseline, conflict.day, conflict.time)) {
    return {
      ok: false,
      error:
        "No change was made to the assignment — resolving a conflict must change the teacher, room, or period and record why.",
    };
  }
  const field: EditField = conflict.kind === "room" ? "room" : "teacher";
  const period = periods[conflict.day]?.find((p) => p.time === conflict.time);
  const value = period?.[field] ?? "";
  const clash = detectEditConflict(periods, { day: conflict.day, time: conflict.time, field, value }, className);
  if (clash) {
    return { ok: false, error: `The conflict is still present: ${clash.message} — change the assignment so it disappears.` };
  }
  return { ok: true };
}

export type ResolveSuggestion = { field: EditField; value: string; reason: string };

/**
 * A concrete reasoned edit that clears the conflict, when one exists:
 * the documented fixes for the fixture claims, a free room, or the first
 * free teacher from the fixture set.
 */
export function suggestedResolve(
  conflict: TimetableConflict,
  periods: Record<string, Period[]>,
  className = TIMETABLE_CLASS,
): ResolveSuggestion | null {
  if (conflict.id === "conflict-1") {
    return { field: "teacher", value: "N. Lone", reason: "Substitute: N. Lone covers Mon 14:15 — M. Wani moved to 9-B" };
  }
  const current = periods[conflict.day]?.find((p) => p.time === conflict.time);
  if (conflict.kind === "room") {
    for (const room of [HOME_ROOM, "Lab 1", "Library", "Art room"]) {
      if (detectEditConflict(periods, { day: conflict.day, time: conflict.time, field: "room", value: room }, className) === null) {
        const subject = current?.subject ?? "The period";
        return {
          field: "room",
          value: room,
          reason: `${subject} moves to ${room} at ${conflict.day} ${conflict.time} — the room clash with ${conflict.counterpart?.className ?? "the other class"} is cleared.`,
        };
      }
    }
    return null;
  }
  for (const teacher of timetableTeachers) {
    if (teacher === current?.teacher) continue;
    if (detectEditConflict(periods, { day: conflict.day, time: conflict.time, field: "teacher", value: teacher }, className) === null) {
      return {
        field: "teacher",
        value: teacher,
        reason: `Substitute: ${teacher} covers ${conflict.day} ${conflict.time} — ${current?.teacher ?? "the teacher"} reassigned.`,
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Editor option sets (from the fixture)                                */
/* ------------------------------------------------------------------ */

const PLACEHOLDER_TEACHERS = new Set(["—", "All staff"]);

/** Distinct fixture subjects of editable periods, sorted. */
export const timetableSubjects: ReadonlyArray<string> = (() => {
  const subjects = new Set<string>();
  for (const day of weekDays) {
    for (const period of timetableByDay[day] ?? []) {
      if (isEditable(period)) subjects.add(period.subject);
    }
  }
  return [...subjects].sort();
})();

/** Distinct fixture teacher names (placeholders excluded), sorted. */
export const timetableTeachers: ReadonlyArray<string> = (() => {
  const names = new Set<string>();
  for (const day of weekDays) {
    for (const period of timetableByDay[day] ?? []) {
      if (isEditable(period) && !PLACEHOLDER_TEACHERS.has(period.teacher)) names.add(period.teacher);
    }
  }
  return [...names].sort();
})();

/* ------------------------------------------------------------------ */
/* Version + draft persistence (session demo)                           */
/* ------------------------------------------------------------------ */

function readPublishedVersion(className: string = TIMETABLE_CLASS): TimetableVersion | null {
  return sessionGet<TimetableVersion>(periodsKey(className));
}

/**
 * The timetable a consumer should show for a class: the session-published
 * snapshot, else the fixture baseline for Class 8-A. Classes without
 * timetable data return null — the portal shows the honest "not published"
 * state instead of the 8-A fixture.
 */
export function effectiveTimetable(className: string = TIMETABLE_CLASS): Record<string, Period[]> | null {
  return readPublishedVersion(className)?.periods ?? (isKnownTimetableClass(className) ? timetableByDay : null);
}

/**
 * The session-published timetable (version metadata + period snapshot) for
 * a class, or null when nothing was published this session. The portal and
 * staff manager both read this — a staff publish is immediately what the
 * portal shows.
 */
export async function getTimetableVersion(className: string = TIMETABLE_CLASS): Promise<TimetableVersion | null> {
  const snapshot = readPublishedVersion(className);
  return snapshot ? { ...snapshot, periods: snapshot.periods } : null;
}

/** Version history: fixture v1 (Class 8-A) plus every session-published version, newest first. */
export async function getTimetableVersionList(className: string = TIMETABLE_CLASS): Promise<TimetableVersionEntry[]> {
  const history = sessionGet<TimetableVersionEntry[]>(historyKey(className)) ?? [];
  if (!isKnownTimetableClass(className)) return [...history];
  return [...history, fixtureVersion];
}

function applyEdits(
  periods: Record<string, Period[]>,
  edits: ReadonlyArray<TimetablePeriodEdit>,
): Record<string, Period[]> {
  const next: Record<string, Period[]> = {};
  for (const day of weekDays) {
    next[day] = (periods[day] ?? []).map((period) => {
      const edit = edits.find((e) => e.day === day && e.time === period.time);
      if (!edit) return period;
      return { ...period, subject: edit.subject, teacher: edit.teacher, room: edit.room, change: true };
    });
  }
  return next;
}

/**
 * Next version number: one above the latest session-published version.
 * The fixture baseline is v1. Owned entirely by this facade — the
 * academics service no longer keeps a timetable counter.
 */
function nextVersionNumber(className: string = TIMETABLE_CLASS): number {
  const history = sessionGet<TimetableVersionEntry[]>(historyKey(className)) ?? [];
  const latest = Math.max(history[0]?.version ?? 0, fixtureVersion.version);
  return latest + 1;
}

/**
 * Publishes a new version: the facade writes the version metadata (counter
 * + note + timestamp) and the edited period snapshot into the same session
 * store, then appends to the version history — earlier versions stay
 * listed, nothing is silently overwritten. Throws on a failed publish
 * (missing note or unknown class) so the UI can show the recoverable error.
 */
export async function publishTimetable(
  edits: ReadonlyArray<TimetablePeriodEdit>,
  note: string,
  className: string = TIMETABLE_CLASS,
): Promise<TimetableVersion> {
  if (!isKnownTimetableClass(className)) {
    throw new Error("No timetable exists for this class.");
  }
  const trimmedNote = note.trim();
  if (trimmedNote === "") {
    throw new Error("A note for the published timetable is required — it becomes the version note in the change log.");
  }
  const version = nextVersionNumber(className);
  const published: TimetableVersion = {
    className,
    weekOf: TIMETABLE_WEEK,
    version,
    note: trimmedNote,
    publishedAtIso: demoNowIso(),
    periods: applyEdits(readPublishedVersion(className)?.periods ?? timetableByDay, edits),
  };
  sessionSet(periodsKey(className), published);
  const history = sessionGet<TimetableVersionEntry[]>(historyKey(className)) ?? [];
  sessionSet(historyKey(className), [
    {
      version,
      note: trimmedNote,
      publishedAtIso: published.publishedAtIso,
      by: "Timetable office",
      session: true,
    },
    ...history,
  ]);
  sessionRemove(draftKey(className));
  return published;
}

export function saveTimetableDraft(
  periods: Record<string, Period[]>,
  notes: ReadonlyArray<DraftNote>,
  className: string = TIMETABLE_CLASS,
): TimetableDraft {
  const draft: TimetableDraft = { savedAtIso: demoNowIso(), periods, notes: [...notes] };
  sessionSet(draftKey(className), draft);
  return draft;
}

export function getTimetableDraft(className: string = TIMETABLE_CLASS): TimetableDraft | null {
  return sessionGet<TimetableDraft>(draftKey(className));
}

export function clearTimetableDraft(className: string = TIMETABLE_CLASS): void {
  sessionRemove(draftKey(className));
}

/** Test/support hook: drop the session-published snapshot, history, and draft for a class. */
export function clearTimetableSession(className: string = TIMETABLE_CLASS): void {
  sessionRemove(periodsKey(className));
  sessionRemove(historyKey(className));
  sessionRemove(draftKey(className));
}

/* ------------------------------------------------------------------ */
/* The one timetable facade                                             */
/* ------------------------------------------------------------------ */

/**
 * The single timetable service used by the portal and the staff workspace
 * (I2 item 4). Staff edit/publish and portal reads are the same functions
 * over the same session store, keyed by class.
 */
export const timetableService = {
  classKeyForGradeSection,
  isKnownTimetableClass,
  listKnownClasses,
  effectiveTimetable,
  getTimetableVersion,
  getTimetableVersionList,
  publishTimetable,
  saveTimetableDraft,
  getTimetableDraft,
  clearTimetableDraft,
  clearTimetableSession,
  detectConflicts,
  detectEditConflict,
  initialOpenConflicts,
  deriveEditedKeys,
  validateDraft,
  validateResolve,
  suggestedResolve,
};
