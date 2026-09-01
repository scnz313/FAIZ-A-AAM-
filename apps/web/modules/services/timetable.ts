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

import { midTermDateSheet, timetableByDay, weekDays, type ExamSlot, type Period } from "@/modules/academics/demo";
import { demoNowIso, demoWeekday } from "@/modules/demo/clock";
import { auditService } from "@/modules/services/audit";
import { sessionGet, sessionKey, sessionRemove, sessionSet } from "@/modules/services/session";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";

/** The demo class owned by this facade; other classes have no timetable data. */
export const TIMETABLE_CLASS = "8-A";
/** Presentation calendar for the isolated demo adapter; Supabase mode uses
 * server period/date-sheet projections instead. */
export const TIMETABLE_WEEK_DAYS = weekDays;
export function getDemoDateSheet(): ExamSlot[] {
  return midTermDateSheet.map((slot) => ({ ...slot }));
}
export function timetableDemoNowIso(): string { return demoNowIso(); }
export function timetableDemoWeekday(): string { return demoWeekday(); }

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

/* ------------------------------------------------------------------ */
/* Overrides and date-sheet state                                      */
/* ------------------------------------------------------------------ */

/**
 * One date-specific change to a published class timetable (blueprint §5.9).
 * Overrides never rewrite the base timetable: they are recorded against a
 * date + period, applied only on that date, and stay in history after
 * revocation. The base timetable remains the source for every other date.
 */
export type TimetableOverrideKind = "substitute" | "room" | "cancellation" | "special";

export type TimetableOverride = {
  /** Deterministic demo reference, e.g. "OVR-2026-001". */
  ref: string;
  className: string;
  /** The date the override applies to, "YYYY-MM-DD" in the demo week. */
  dateIso: string;
  day: string;
  time: string;
  /** Authoritative configured slot number for this day. */
  periodNumber?: number;
  kind: TimetableOverrideKind;
  /** Substitute kind only — the covering teacher. */
  teacher?: string;
  /** Substitute kind only — the covering subject. */
  subject?: string;
  /** Room kind only — the changed room. */
  room?: string;
  /** Required reason — recorded in the change trail and audit. */
  note: string;
  createdAtIso: string;
  by: string;
  /** Optimistic lifecycle version. Revocation increments it. */
  version: number;
  /** Set when revoked; the record stays in history (append-only). */
  revokedAtIso: string | null;
  revocationReason: string | null;
};

export type TimetableOverrideInput = {
  dateIso: string;
  time: string;
  kind: TimetableOverrideKind;
  teacher?: string;
  subject?: string;
  room?: string;
  note: string;
  by?: string;
};

/** Published exam date-sheet state and its immutable entry projection. */
export type DateSheetState = {
  ref?: string;
  className: string;
  published: boolean;
  version: number;
  publishedAtIso: string;
  by: string;
  entries: ExamSlot[];
};

export type TimetableDraft = {
  id?: string;
  ref?: string;
  revision?: number;
  savedAtIso: string;
  periods: Record<string, Period[]>;
  notes: DraftNote[];
};

type SupabaseTimetablePeriod = {
  day_of_week: number;
  period_number: number;
  starts_at: string;
  ends_at: string;
  subject_id: string | null;
  teacher_assignment_id: string | null;
  teaching_assignment_id: string | null;
  room_id: string | null;
  kind: string;
  subjects?: { name: string } | null;
  teaching_assignments?: { staff_members?: { people?: { display_name: string } | null } | null } | null;
  staff_assignments?: { staff_members?: { people?: { display_name: string } | null } | null } | null;
  rooms?: { label: string } | null;
};

type SupabaseTimetableVersion = {
  id: string;
  reference: string;
  grade_section_id: string;
  status: string;
  version: number;
  revision?: number;
  effective_from?: string | null;
  effective_to?: string | null;
  created_at: string;
  updated_at?: string;
  timetable_periods?: SupabaseTimetablePeriod[];
  timetable_publications?: { reference: string; published_at: string; note: string | null }[] | null;
};

type SupabaseTimetableOverride = {
  id?: string;
  reference: string;
  grade_section_id: string;
  override_date: string;
  day_of_week: number;
  period_number: number;
  kind: string;
  subject_id: string | null;
  room_id: string | null;
  substitute_teacher_assignment_id: string | null;
  substitute_teaching_assignment_id: string | null;
  note: string | null;
  created_at: string;
  created_by_account_id?: string | null;
  updated_at?: string;
  version?: number;
  revoked_at: string | null;
  revoked_by_account_id?: string | null;
  revocation_reason: string | null;
  subjects?: { name: string } | null;
  rooms?: { label: string } | null;
  teaching_assignments?: { reference?: string; staff_members?: { people?: { display_name: string } | null } | null } | null;
  staff_assignments?: { reference?: string; staff_members?: { people?: { display_name: string } | null } | null } | null;
};

type SupabaseExamScheduleVersion = {
  id: string;
  reference: string;
  grade_section_id: string;
  version: number;
  status: string;
  created_at: string;
  published_at?: string | null;
  published_by_account_id?: string | null;
  publication_note?: string | null;
  exam_schedule_entries?: Array<{
    id?: string;
    exam_date: string;
    subject_id: string;
    room_id: string | null;
    starts_at: string;
    ends_at: string;
    subjects?: { name: string } | null;
    rooms?: { label: string } | null;
  }>;
};

type SupabaseConfiguration = {
  gradeSections: Array<{ id: string; ref?: string; gradeLabel: string; sectionLabel: string }>;
  subjects?: Array<{ id: string; code?: string; name: string }>;
  assignments?: Array<{ id: string; ref?: string; gradeSectionId: string | null; subjectId: string | null; teacherName: string }>;
  rooms?: Array<{ id: string; label: string; code: string }>;
  periods?: Array<{ dayOfWeek: number; periodNumber: number; startsAt: string; endsAt: string }>;
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

type SupabaseTimetableCacheEntry = {
  version: TimetableVersion | null;
  overrides: TimetableOverride[];
};

/** Browser-memory projection cache used only to bridge the existing synchronous
 * day/week presenter. It is populated by authenticated adapter reads and never
 * falls back to session storage or fixtures in Supabase mode. */
const supabaseTimetableCache = new Map<string, SupabaseTimetableCacheEntry>();

function cachedSupabaseTimetable(className: string): SupabaseTimetableCacheEntry {
  return supabaseTimetableCache.get(className) ?? { version: null, overrides: [] };
}

function updateSupabaseTimetableCache(className: string, patch: Partial<SupabaseTimetableCacheEntry>): void {
  supabaseTimetableCache.set(className, { ...cachedSupabaseTimetable(className), ...patch });
}

function shortTime(value: string): string {
  return value.slice(0, 5);
}

function mapSupabasePeriod(period: SupabaseTimetablePeriod): Period {
  const kind = period.kind as Period["kind"];
  if (kind === "assembly") {
    return {
      time: shortTime(period.starts_at),
      subject: "Morning assembly",
      teacher: "All staff",
      room: period.rooms?.label ?? "Assembly area",
      kind,
      periodNumber: period.period_number,
      endsAt: shortTime(period.ends_at),
    };
  }
  if (kind === "break") {
    return {
      time: shortTime(period.starts_at),
      subject: period.subjects?.name ?? "Break",
      teacher: "—",
      room: period.rooms?.label ?? "—",
      kind,
      periodNumber: period.period_number,
      endsAt: shortTime(period.ends_at),
    };
  }
  return {
    time: shortTime(period.starts_at),
    subject: period.subjects?.name ?? period.subject_id ?? "Scheduled class",
    teacher: period.teaching_assignments?.staff_members?.people?.display_name
      ?? period.staff_assignments?.staff_members?.people?.display_name
      ?? period.teaching_assignment_id
      ?? period.teacher_assignment_id
      ?? "Assigned teacher",
    room: period.rooms?.label ?? period.room_id ?? "Assigned room",
    kind,
    periodNumber: period.period_number,
    endsAt: shortTime(period.ends_at),
  };
}

function mapSupabasePeriods(periods: SupabaseTimetablePeriod[] | undefined): Record<string, Period[]> {
  const mapped: Record<string, Period[]> = {};
  for (const period of periods ?? []) {
    const day = DAY_NAMES[Math.max(0, period.day_of_week - 1)] ?? "Monday";
    (mapped[day] ??= []).push(mapSupabasePeriod(period));
  }
  for (const entries of Object.values(mapped)) {
    entries.sort((left, right) => (left.periodNumber ?? 0) - (right.periodNumber ?? 0));
  }
  return mapped;
}

async function supabaseConfiguration(): Promise<SupabaseConfiguration | null> {
  const response = await adapterCall<SupabaseConfiguration>("config.read", {});
  return response.ok ? response.value : null;
}

async function supabaseSectionId(className: string): Promise<string | null> {
  const config = await supabaseConfiguration();
  return config === null ? null : configuredSection(config, className)?.id ?? null;
}

async function supabaseSectionRef(className: string): Promise<string | null> {
  const config = await supabaseConfiguration();
  return config === null ? null : configuredSection(config, className)?.ref ?? null;
}

function uuidOrNull(value: string | null | undefined): string | null {
  return value !== undefined && value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function configuredSection(config: SupabaseConfiguration, className: string) {
  const normalized = className.replace(/^Class\s+/i, "").replace("-", " ");
  return config.gradeSections.find((section) =>
    `${section.gradeLabel.replace(/^Class\s+/i, "")}-${section.sectionLabel}` === className
    || `${section.gradeLabel.replace(/^Class\s+/i, "")} ${section.sectionLabel}` === normalized,
  );
}

function sortOverrides(overrides: TimetableOverride[]): TimetableOverride[] {
  return [...overrides].sort((left, right) => {
    const active = (left.revokedAtIso === null ? 0 : 1) - (right.revokedAtIso === null ? 0 : 1);
    if (active !== 0) return active;
    return left.dateIso.localeCompare(right.dateIso)
      || left.time.localeCompare(right.time)
      || left.ref.localeCompare(right.ref);
  });
}

function mapSupabaseOverride(
  row: SupabaseTimetableOverride,
  className: string,
  config: SupabaseConfiguration,
  effective: SupabaseTimetableVersion | null,
): TimetableOverride {
  const dateDay = timetableWeekdayForDate(row.override_date);
  const rowDay = DAY_NAMES[Math.max(0, row.day_of_week - 1)] ?? "Monday";
  const day = dateDay ?? rowDay;
  const effectivePeriod = effective?.timetable_periods?.find((period) =>
    period.day_of_week === row.day_of_week && period.period_number === row.period_number,
  );
  const configuredPeriod = config.periods?.find((period) =>
    period.dayOfWeek === row.day_of_week && period.periodNumber === row.period_number,
  );
  const startsAt = effectivePeriod?.starts_at ?? configuredPeriod?.startsAt;
  const assignment = config.assignments?.find((candidate) => candidate.id === row.substitute_teacher_assignment_id);
  const subject = config.subjects?.find((candidate) => candidate.id === row.subject_id);
  const room = config.rooms?.find((candidate) => candidate.id === row.room_id);
  const kind: TimetableOverrideKind = row.kind === "room_change"
    ? "room"
    : row.kind === "substitute" || row.kind === "cancellation" || row.kind === "special"
      ? row.kind
      : "special";
  return {
    ref: row.reference,
    className,
    dateIso: row.override_date,
    day,
    time: startsAt === undefined ? `Period ${row.period_number}` : shortTime(startsAt),
    periodNumber: row.period_number,
    kind,
    teacher: kind === "substitute"
      ? row.teaching_assignments?.staff_members?.people?.display_name
        ?? row.staff_assignments?.staff_members?.people?.display_name
        ?? assignment?.teacherName
      : undefined,
    subject: kind === "substitute" ? row.subjects?.name ?? subject?.name : undefined,
    room: kind === "room" ? row.rooms?.label ?? room?.label : undefined,
    note: row.note ?? "No public change note was supplied.",
    createdAtIso: row.created_at,
    by: "Timetable office",
    version: row.version ?? 1,
    revokedAtIso: row.revoked_at,
    revocationReason: row.revocation_reason,
  };
}

const EXAM_DAY_FORMATTER = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const EXAM_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });

function mapSupabaseExamSlot(entry: NonNullable<SupabaseExamScheduleVersion["exam_schedule_entries"]>[number]): ExamSlot {
  const date = new Date(`${entry.exam_date}T00:00:00.000Z`);
  const validDate = !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === entry.exam_date;
  return {
    dateIso: entry.exam_date,
    dayLabel: validDate ? EXAM_DAY_FORMATTER.format(date) : "",
    dateLabel: validDate ? EXAM_DATE_FORMATTER.format(date) : entry.exam_date,
    subject: entry.subjects?.name ?? entry.subject_id,
    time: `${shortTime(entry.starts_at)} – ${shortTime(entry.ends_at)}`,
    room: entry.rooms?.label ?? entry.room_id ?? "To be confirmed",
  };
}

function cloneDateSheetState(state: DateSheetState): DateSheetState {
  return {
    ...state,
    className: state.className ?? TIMETABLE_CLASS,
    entries: (state.entries ?? getDemoDateSheet()).map((entry) => ({ ...entry })),
  };
}

function applyOverridesToPeriods(periods: ReadonlyArray<Period>, overrides: ReadonlyArray<TimetableOverride>): Period[] {
  return periods.map((period) => {
    const override = overrides.find((candidate) =>
      candidate.revokedAtIso === null
      && (candidate.periodNumber !== undefined
        ? candidate.periodNumber === period.periodNumber
        : candidate.time === period.time),
    );
    if (override === undefined) return { ...period };
    if (override.kind === "cancellation") {
      return { ...period, subject: "Cancelled", teacher: "—", room: "—", change: true };
    }
    if (override.kind === "substitute") {
      return { ...period, subject: override.subject ?? period.subject, teacher: override.teacher ?? period.teacher, change: true };
    }
    if (override.kind === "room") return { ...period, room: override.room ?? period.room, change: true };
    return { ...period, change: true };
  });
}

/** Apply only overrides whose exact date falls in the published version's
 * seven-day window. Other dates and the base period arrays remain untouched. */
export function projectTimetableOverrides(
  periods: Record<string, Period[]>,
  overrides: ReadonlyArray<TimetableOverride>,
  weekOf: string,
): Record<string, Period[]> {
  const projected: Record<string, Period[]> = {};
  for (const [day, dayPeriods] of Object.entries(periods)) {
    const dateIso = dateForTimetableWeekday(day, weekOf);
    const matching = dateIso === null ? [] : overrides.filter((override) => override.dateIso === dateIso);
    projected[day] = applyOverridesToPeriods(dayPeriods, matching);
  }
  return projected;
}

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

function overridesKey(className: string): string {
  return sessionKey(`timetable:${sessionSlug(className)}:overrides`);
}

function dateSheetKey(className: string): string {
  return sessionKey(`timetable:${sessionSlug(className)}:datesheet`);
}

const OVERRIDES_COUNTER_KEY = sessionKey("timetable:overrides:counter");

/** Date of a weekday in the demo week (Mon 3 Aug – Sat 8 Aug 2026), or
 * null for days outside the fixture week. Overrides must target this week. */
export function demoDateForWeekday(day: string): string | null {
  const index = TIMETABLE_WEEK_DAYS.indexOf(day);
  if (index < 0) return null;
  const base = new Date(`${TIMETABLE_WEEK}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + index);
  return base.toISOString().slice(0, 10);
}

/** Weekday ("Monday"…) for a valid calendar date. */
export function timetableWeekdayForDate(dateIso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateIso) return null;
  const mondayIndex = (date.getUTCDay() + 6) % 7;
  return DAY_NAMES[mondayIndex] ?? null;
}

/** Date for a weekday in the seven-day window beginning at `weekOf`. */
export function dateForTimetableWeekday(day: string, weekOf: string = TIMETABLE_WEEK): string | null {
  if (!DAY_NAMES.includes(day as (typeof DAY_NAMES)[number]) || timetableWeekdayForDate(weekOf) === null) return null;
  const base = new Date(`${weekOf}T00:00:00.000Z`);
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + offset);
    if (timetableWeekdayForDate(date.toISOString().slice(0, 10)) === day) return date.toISOString().slice(0, 10);
  }
  return null;
}

/** Ordered weekdays actually carried by a timetable projection. */
export function timetableDays(periods: Record<string, Period[]>): string[] {
  return DAY_NAMES.filter((day) => (periods[day]?.length ?? 0) > 0);
}

/** The demo weekday ("Monday"…) for a "YYYY-MM-DD" date in the demo week. */
function demoWeekdayForDate(dateIso: string): string | null {
  const day = timetableWeekdayForDate(dateIso);
  return day !== null && demoDateForWeekday(day) === dateIso ? day : null;
}

function nextOverrideRef(): string {
  const last = sessionGet<number>(OVERRIDES_COUNTER_KEY) ?? 0;
  const next = last + 1;
  sessionSet(OVERRIDES_COUNTER_KEY, next);
  return `OVR-2026-${String(next).padStart(3, "0")}`;
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

/** Dynamic section list for operational Supabase mode. The fixed demo class
 * list is intentionally used only when the demo adapter is active. */
export async function listTimetableClasses(): Promise<string[]> {
  if (clientAdapterMode() === "supabase") {
    const config = await supabaseConfiguration();
    return (config?.gradeSections ?? []).map((section) => classKeyForGradeSection({ gradeLabel: section.gradeLabel, sectionLabel: section.sectionLabel }));
  }
  return listKnownClasses();
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

type SupabaseTimetableValidation = {
  valid: boolean;
  conflicts?: Array<{ kind?: string; day?: number; period?: number; message?: string }>;
};

export class TimetableConflictError extends Error {
  readonly conflicts: TimetableConflict[];

  constructor(conflicts: TimetableConflict[]) {
    super("The timetable has hard conflicts. Review the conflict list before publishing.");
    this.name = "TimetableConflictError";
    this.conflicts = conflicts;
  }
}

function mapSupabaseConflicts(
  conflicts: SupabaseTimetableValidation["conflicts"],
  periods: Record<string, Period[]>,
): TimetableConflict[] {
  return (conflicts ?? []).map((conflict, index) => {
    const day = DAY_NAMES[Math.max(0, (conflict.day ?? 1) - 1)] ?? "Monday";
    const period = periods[day]?.find((candidate) => candidate.periodNumber === conflict.period);
    const time = period?.time ?? `Period ${conflict.period ?? "—"}`;
    const kind: TimetableConflictKind = conflict.kind === "room" ? "room" : "teacher";
    const label = kind === "room" ? "Room" : "Teacher";
    return {
      id: `server-${kind}-${conflict.day ?? 0}-${conflict.period ?? index}`,
      kind,
      day,
      time,
      message: `${label} conflict at ${shortDay(day)} ${time}`,
      detail: conflict.message ?? `The school timetable service found a ${kind} conflict in configured period ${conflict.period ?? "—"}.`,
    };
  });
}

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

export type TimetableEditorOptions = {
  subjects: string[];
  teachers: string[];
  rooms: string[];
};

/** Authorised editor values; Supabase mode never consults fixture option sets. */
export async function getTimetableEditorOptions(className: string = TIMETABLE_CLASS): Promise<TimetableEditorOptions> {
  if (clientAdapterMode() === "supabase") {
    const config = await supabaseConfiguration();
    if (!config) return { subjects: [], teachers: [], rooms: [] };
    const sectionId = config.gradeSections.find((candidate) => classKeyForGradeSection({ gradeLabel: candidate.gradeLabel, sectionLabel: candidate.sectionLabel }) === className)?.id;
    if (!sectionId) return { subjects: [], teachers: [], rooms: [] };
    return {
      subjects: [...new Set((config.subjects ?? []).map((subject) => subject.name))].sort(),
      teachers: [...new Set((config.assignments ?? []).filter((assignment) => assignment.gradeSectionId === sectionId).map((assignment) => assignment.teacherName))].sort(),
      rooms: [...new Set((config.rooms ?? []).map((room) => room.label))].sort(),
    };
  }
  const rooms = new Set<string>();
  for (const day of weekDays) {
    for (const period of timetableByDay[day] ?? []) {
      if (isEditable(period)) rooms.add(period.room);
    }
  }
  return { subjects: [...timetableSubjects], teachers: [...timetableTeachers], rooms: [...rooms].sort() };
}

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

/** Async protected read. In Supabase mode it only returns database data and
 * never consults the demo fixture or session store. */
export async function getEffectiveTimetable(className: string = TIMETABLE_CLASS): Promise<Record<string, Period[]> | null> {
  if (clientAdapterMode() === "supabase") {
    const sectionRef = await supabaseSectionRef(className);
    if (!sectionRef) {
      updateSupabaseTimetableCache(className, { version: null });
      return null;
    }
    const response = await adapterCall<SupabaseTimetableVersion | null>("timetable.effective", { gradeSectionRef: sectionRef });
    if (!response.ok || !response.value) {
      updateSupabaseTimetableCache(className, { version: null });
      return null;
    }
    const publication = response.value.timetable_publications?.[0];
    const version: TimetableVersion = {
      className,
      weekOf: response.value.effective_from ?? response.value.created_at.slice(0, 10),
      version: response.value.version,
      note: publication?.note ?? undefined,
      publishedAtIso: publication?.published_at,
      periods: mapSupabasePeriods(response.value.timetable_periods),
    };
    updateSupabaseTimetableCache(className, { version });
    return version.periods;
  }
  return effectiveTimetable(className);
}

/**
 * The session-published timetable (version metadata + period snapshot) for
 * a class, or null when nothing was published this session. The portal and
 * staff manager both read this — a staff publish is immediately what the
 * portal shows.
 */
export async function getTimetableVersion(className: string = TIMETABLE_CLASS): Promise<TimetableVersion | null> {
  if (clientAdapterMode() === "supabase") {
    const sectionRef = await supabaseSectionRef(className);
    if (!sectionRef) {
      updateSupabaseTimetableCache(className, { version: null });
      return null;
    }
    const response = await adapterCall<SupabaseTimetableVersion | null>("timetable.effective", { gradeSectionRef: sectionRef });
    if (!response.ok || !response.value) {
      updateSupabaseTimetableCache(className, { version: null });
      return null;
    }
    const publication = response.value.timetable_publications?.[0];
    const version: TimetableVersion = {
      className,
      weekOf: response.value.effective_from ?? response.value.created_at.slice(0, 10),
      version: response.value.version,
      note: publication?.note ?? undefined,
      publishedAtIso: publication?.published_at,
      periods: mapSupabasePeriods(response.value.timetable_periods),
    };
    updateSupabaseTimetableCache(className, { version });
    return version;
  }
  const snapshot = readPublishedVersion(className);
  return snapshot ? { ...snapshot, periods: snapshot.periods } : null;
}

/** Version history: fixture v1 (Class 8-A) plus every session-published version, newest first. */
export async function getTimetableVersionList(className: string = TIMETABLE_CLASS): Promise<TimetableVersionEntry[]> {
  if (clientAdapterMode() === "supabase") {
    const response = await adapterCall<SupabaseTimetableVersion[]>("timetable.listVersions", {});
    if (!response.ok) return [];
    const sectionId = await supabaseSectionId(className);
    return response.value.filter((item) => item.grade_section_id === sectionId).map((item) => ({ version: item.version, note: item.timetable_publications?.[0]?.note ?? `Timetable ${item.status}`, publishedAtIso: item.timetable_publications?.[0]?.published_at ?? item.created_at, by: "Timetable office", session: false }));
  }
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

async function mapPeriodsToDatabase(
  periods: Record<string, Period[]>,
  edits: ReadonlyArray<TimetablePeriodEdit>,
  className: string,
): Promise<Array<Record<string, unknown>>> {
  const config = await supabaseConfiguration();
  if (!config) throw new Error("School timetable configuration is unavailable.");
  const section = config.gradeSections.find((candidate) => classKeyForGradeSection({ gradeLabel: candidate.gradeLabel, sectionLabel: candidate.sectionLabel }) === className);
  if (!section) throw new Error("No timetable section is available for this class.");
  return Object.entries(periods).flatMap(([day, entries]) => entries.map((original) => {
    const edit = edits.find((candidate) => candidate.day === day && candidate.time === original.time);
    const period = edit ? { ...original, subject: edit.subject, teacher: edit.teacher, room: edit.room } : original;
    const dayOfWeek = DAY_NAMES.indexOf(day as (typeof DAY_NAMES)[number]) + 1;
    const definition = config.periods?.find((candidate) =>
      candidate.dayOfWeek === dayOfWeek
      && (candidate.periodNumber === period.periodNumber || shortTime(candidate.startsAt) === shortTime(period.time)),
    );
    const periodNumber = period.periodNumber ?? definition?.periodNumber;
    if (dayOfWeek < 1 || periodNumber === undefined) {
      throw new Error(`Timetable entry ${day} ${period.time} is outside the configured school periods.`);
    }
    const subject = config.subjects?.find((candidate) => candidate.name.toLowerCase() === period.subject.toLowerCase());
    const subjectId = uuidOrNull(period.subject) ?? subject?.id ?? null;
    const assignment = config.assignments?.find((candidate) => candidate.teacherName.toLowerCase() === period.teacher.toLowerCase() && candidate.gradeSectionId === section.id && (subjectId === null || candidate.subjectId === subjectId));
    const assignmentId = uuidOrNull(period.teacher) ?? assignment?.id ?? null;
    const room = config.rooms?.find((candidate) => candidate.label.toLowerCase() === period.room.toLowerCase() || candidate.code.toLowerCase() === period.room.toLowerCase());
    const roomId = uuidOrNull(period.room) ?? room?.id ?? null;
    const isPlaceholder = period.kind === "break" || period.kind === "assembly" || period.subject === "—" || period.teacher === "—";
    if (!isPlaceholder && (subjectId === null || assignmentId === null || roomId === null)) {
      throw new Error(`Timetable entry ${day} ${period.time} needs an authorised subject, teacher assignment, and room.`);
    }
    return {
      dayOfWeek,
      periodNumber,
      startsAt: definition?.startsAt ?? period.time,
      endsAt: definition?.endsAt ?? period.endsAt,
      subjectRef: isPlaceholder ? null : (subject?.code ?? period.subject),
      teacherAssignmentRef: isPlaceholder ? null : (assignment?.ref ?? period.teacher),
      roomRef: isPlaceholder ? null : (room?.code ?? period.room),
      kind: period.kind ?? "class",
    };
  }));
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
  if (clientAdapterMode() === "supabase") {
    const sectionRef = await supabaseSectionRef(className);
    if (!sectionRef) throw new Error("No timetable section is available for this class.");
    const draft = await getTimetableDraftAsync(className);
    const current = draft?.periods ? { periods: draft.periods } : await getTimetableVersion(className);
    const periods = await mapPeriodsToDatabase(current?.periods ?? {}, edits, className);
    const saved = await adapterCall<{ versionId?: string; version?: number; reference?: string; revision?: number }>("timetable.saveDraft", { gradeSectionRef: sectionRef, versionRef: draft?.ref ?? null, periods, expectedRevision: draft?.revision ?? 0 });
    if (!saved.ok) throw new Error(saved.errors[0]?.message ?? "Unable to save timetable draft.");
    const versionRef = saved.value.reference ?? draft?.ref;
    if (!versionRef) throw new Error("The saved timetable draft has no publishable reference.");
    const validation = await adapterCall<SupabaseTimetableValidation>("timetable.validateDraft", { versionRef });
    if (!validation.ok) throw new Error(validation.errors[0]?.message ?? "Unable to validate timetable draft.");
    const conflicts = mapSupabaseConflicts(validation.value.conflicts, current?.periods ?? {});
    if (!validation.value.valid || conflicts.length > 0) throw new TimetableConflictError(conflicts);
    const published = await adapterCall<{ publicationRef: string }>("timetable.publish", { versionRef, note: note.trim() });
    if (!published.ok) throw new Error(published.errors[0]?.message ?? "Unable to publish timetable.");
    const latest = await getTimetableVersion(className);
    if (!latest) throw new Error("Published timetable could not be reloaded.");
    return latest;
  }
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

export async function saveTimetableDraftAsync(
  periods: Record<string, Period[]>,
  notes: ReadonlyArray<DraftNote>,
  className: string = TIMETABLE_CLASS,
): Promise<TimetableDraft> {
  if (clientAdapterMode() === "supabase") {
    const sectionRef = await supabaseSectionRef(className);
    if (!sectionRef) throw new Error("No timetable section is available for this class.");
    const payload = await mapPeriodsToDatabase(periods, [], className);
    const current = await getTimetableDraftAsync(className);
    const response = await adapterCall<{ updatedAt?: string; reference?: string; revision?: number; versionId?: string }>("timetable.saveDraft", { gradeSectionRef: sectionRef, versionRef: current?.ref ?? null, periods: payload, expectedRevision: current?.revision ?? 0 });
    if (!response.ok) throw new Error(response.errors[0]?.message ?? "Unable to save timetable draft.");
    return { id: response.value.versionId, ref: response.value.reference ?? current?.ref, revision: response.value.revision, savedAtIso: response.value.updatedAt ?? new Date().toISOString(), periods, notes: [...notes] };
  }
  return saveTimetableDraft(periods, notes, className);
}

export function getTimetableDraft(className: string = TIMETABLE_CLASS): TimetableDraft | null {
  return sessionGet<TimetableDraft>(draftKey(className));
}

export async function getTimetableDraftAsync(className: string = TIMETABLE_CLASS): Promise<TimetableDraft | null> {
  if (clientAdapterMode() === "supabase") {
    const response = await adapterCall<SupabaseTimetableVersion[]>("timetable.listVersions", {});
    if (!response.ok) return null;
    const sectionId = await supabaseSectionId(className);
    const draft = response.value.find((item) => item.grade_section_id === sectionId && item.status === "draft");
    return draft ? { id: draft.id, ref: draft.reference, revision: draft.revision ?? 0, savedAtIso: draft.updated_at ?? draft.created_at, periods: mapSupabasePeriods(draft.timetable_periods), notes: [] } : null;
  }
  return getTimetableDraft(className);
}

/** Hard conflicts returned by the authoritative draft validator. */
export async function getTimetableDraftConflicts(
  draft: TimetableDraft,
  className: string = TIMETABLE_CLASS,
): Promise<TimetableConflict[]> {
  if (clientAdapterMode() !== "supabase") return detectConflicts(draft.periods, className);
  if (!draft.ref) return [];
  const response = await adapterCall<SupabaseTimetableValidation>("timetable.validateDraft", { versionRef: draft.ref });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "The timetable draft could not be validated.");
  return mapSupabaseConflicts(response.value.conflicts, draft.periods);
}

export function clearTimetableDraft(className: string = TIMETABLE_CLASS): void {
  sessionRemove(draftKey(className));
}

/** Test/support hook: drop the session-published snapshot, history, and draft for a class. */
export function clearTimetableSession(className: string = TIMETABLE_CLASS): void {
  supabaseTimetableCache.delete(className);
  sessionRemove(periodsKey(className));
  sessionRemove(historyKey(className));
  sessionRemove(draftKey(className));
  sessionRemove(overridesKey(className));
  sessionRemove(dateSheetKey(className));
}

/* ------------------------------------------------------------------ */
/* Overrides                                                           */
/* ------------------------------------------------------------------ */

/** Synchronous presenter bridge. Demo mode reads its isolated session store;
 * Supabase mode returns only the last authenticated in-memory projection and
 * never consults demo/session records. Use `listTimetableOverridesAsync` to
 * refresh it from the server. */
export function listTimetableOverrides(className: string = TIMETABLE_CLASS): TimetableOverride[] {
  const overrides = clientAdapterMode() === "supabase"
    ? cachedSupabaseTimetable(className).overrides
    : sessionGet<TimetableOverride[]>(overridesKey(className)) ?? [];
  return sortOverrides(overrides).map((override) => ({ ...override }));
}

/** Authoritative override list. RLS limits a guardian to active overrides for
 * the selected linked section while timetable staff also receive revoked rows. */
export async function listTimetableOverridesAsync(className: string = TIMETABLE_CLASS): Promise<TimetableOverride[]> {
  if (clientAdapterMode() !== "supabase") return listTimetableOverrides(className);
  updateSupabaseTimetableCache(className, { overrides: [] });
  const config = await supabaseConfiguration();
  if (config === null) return [];
  const section = configuredSection(config, className);
  if (!section?.ref) return [];
  const [overridesResponse, effectiveResponse] = await Promise.all([
    adapterCall<SupabaseTimetableOverride[]>("timetable.listOverrides", { gradeSectionRef: section.ref }),
    adapterCall<SupabaseTimetableVersion | null>("timetable.effective", { gradeSectionRef: section.ref }),
  ]);
  if (!overridesResponse.ok) return [];
  const effective = effectiveResponse.ok ? effectiveResponse.value : null;
  const mapped = sortOverrides(overridesResponse.value
    .filter((row) => row.grade_section_id === section.id)
    .map((row) => mapSupabaseOverride(row, className, config, effective)));
  updateSupabaseTimetableCache(className, { overrides: mapped });
  return mapped.map((override) => ({ ...override }));
}

function loadOverrides(className: string): TimetableOverride[] {
  return sessionGet<TimetableOverride[]>(overridesKey(className)) ?? [];
}

function validateOverrideFields(input: TimetableOverrideInput): void {
  if (input.note.trim().length < 10) {
    throw new Error("A reason of at least 10 characters is required — it becomes part of the change trail.");
  }
  if (timetableWeekdayForDate(input.dateIso) === null) {
    throw new Error("Choose a valid override date.");
  }
  if (input.kind === "substitute" && (input.teacher === undefined || input.teacher.trim() === "")) {
    throw new Error("A substitute teacher is required for a substitute override.");
  }
  if (input.kind === "room" && (input.room === undefined || input.room.trim() === "")) {
    throw new Error("A room is required for a room override.");
  }
}

function validateDemoOverrideInput(input: TimetableOverrideInput, base: Record<string, Period[]>): { day: string } {
  validateOverrideFields(input);
  const day = demoWeekdayForDate(input.dateIso);
  if (day === null) {
    throw new Error("The override date must fall within the demo week (3–8 August 2026).");
  }
  const period = base[day]?.find((candidate) => candidate.time === input.time);
  if (period === undefined) {
    throw new Error(`No period starts at ${input.time} on ${day} — choose a period from the published timetable.`);
  }
  return { day };
}

/**
 * Records one date-specific override (blueprint §5.9). The base timetable
 * is never rewritten: the override applies only on its date and remains in
 * history after revocation. A reason is required and an audit event is
 * appended. In Supabase mode the command routes through the school
 * timetable service.
 */
export async function saveTimetableOverride(
  input: TimetableOverrideInput,
  className: string = TIMETABLE_CLASS,
): Promise<TimetableOverride> {
  if (clientAdapterMode() === "supabase") {
    validateOverrideFields(input);
    const config = await supabaseConfiguration();
    if (!config) throw new Error("School timetable configuration is unavailable.");
    const section = config.gradeSections.find((candidate) => classKeyForGradeSection({ gradeLabel: candidate.gradeLabel, sectionLabel: candidate.sectionLabel }) === className);
    if (!section?.ref) throw new Error("No timetable section is available for this class.");
    const day = timetableWeekdayForDate(input.dateIso);
    if (day === null) throw new Error("Choose a valid override date.");
    const dayOfWeek = DAY_NAMES.indexOf(day as (typeof DAY_NAMES)[number]) + 1;
    const effective = await adapterCall<SupabaseTimetableVersion | null>("timetable.effective", { gradeSectionRef: section.ref });
    if (!effective.ok) throw new Error(effective.errors[0]?.message ?? "The published timetable could not be loaded.");
    const effectivePeriod = effective.value?.timetable_periods?.find(
      (candidate) => candidate.day_of_week === dayOfWeek && shortTime(candidate.starts_at) === shortTime(input.time),
    );
    const configuredPeriod = config.periods?.find(
      (candidate) => candidate.dayOfWeek === dayOfWeek && shortTime(candidate.startsAt) === shortTime(input.time),
    );
    const periodNumber = effectivePeriod?.period_number ?? configuredPeriod?.periodNumber;
    if (periodNumber === undefined) {
      throw new Error(`No configured period starts at ${input.time} on ${day} for Class ${className}.`);
    }

    const requestedSubject = input.subject?.trim() ?? "";
    const subject = config.subjects?.find((candidate) => candidate.name.toLowerCase() === requestedSubject.toLowerCase() || candidate.code?.toLowerCase() === requestedSubject.toLowerCase());
    const subjectId = uuidOrNull(requestedSubject) ?? subject?.id ?? (input.kind === "substitute" ? effectivePeriod?.subject_id ?? null : null);
    if (requestedSubject !== "" && subjectId === null) throw new Error("Choose an authorised subject from the school timetable configuration.");

    const requestedRoom = input.room?.trim() ?? "";
    const room = config.rooms?.find((candidate) => candidate.label.toLowerCase() === requestedRoom.toLowerCase() || candidate.code.toLowerCase() === requestedRoom.toLowerCase());
    const roomId = uuidOrNull(requestedRoom) ?? room?.id ?? null;
    if (input.kind === "room" && roomId === null) throw new Error("Choose an authorised room from the school timetable configuration.");

    const requestedTeacher = input.teacher?.trim() ?? "";
    const assignment = config.assignments?.find((candidate) =>
      candidate.teacherName.toLowerCase() === requestedTeacher.toLowerCase()
      && candidate.gradeSectionId === section.id
      && (subjectId === null || candidate.subjectId === subjectId),
    );
    const assignmentId = uuidOrNull(requestedTeacher) ?? assignment?.id ?? null;
    if (input.kind === "substitute" && assignmentId === null) throw new Error("Choose an authorised substitute assignment for this class and subject.");

    const response = await adapterCall<{ reference: string }>("timetable.saveOverride", {
      gradeSectionRef: section.ref,
      overrideDate: input.dateIso,
      dayOfWeek,
      periodNumber,
      kind: input.kind === "room" ? "room_change" : input.kind,
      subjectId,
      roomId,
      substituteTeacherAssignmentId: assignmentId,
      note: input.note.trim(),
    });
    if (!response.ok) throw new Error(response.errors[0]?.message ?? "Unable to save the override.");
    return {
      ref: response.value.reference,
      className,
      dateIso: input.dateIso,
      day,
      time: shortTime(input.time),
      periodNumber,
      kind: input.kind,
      teacher: input.kind === "substitute" ? input.teacher?.trim() : undefined,
      subject: input.kind === "substitute" ? input.subject?.trim() : undefined,
      room: input.kind === "room" ? input.room?.trim() : undefined,
      note: input.note.trim(),
      createdAtIso: new Date().toISOString(),
      by: input.by ?? "Timetable office",
      version: 1,
      revokedAtIso: null,
      revocationReason: null,
    };
  }
  const { day } = validateDemoOverrideInput(input, effectiveTimetable(className) ?? {});
  const override: TimetableOverride = {
    ref: nextOverrideRef(),
    className,
    dateIso: input.dateIso,
    day,
    time: input.time,
    kind: input.kind,
    teacher: input.kind === "substitute" ? input.teacher?.trim() : undefined,
    subject: input.kind === "substitute" ? input.subject?.trim() : undefined,
    room: input.kind === "room" ? input.room?.trim() : undefined,
    note: input.note.trim(),
    createdAtIso: demoNowIso(),
    by: input.by ?? "Timetable office",
    version: 1,
    revokedAtIso: null,
    revocationReason: null,
  };
  sessionSet(overridesKey(className), [...loadOverrides(className), override]);
  void auditService.record({
    actor: override.by,
    action: "Timetable changed",
    target: `${className} · ${override.day} ${override.time} · ${override.kind}`,
    outcome: "Success",
    reason: override.note,
  });
  return { ...override };
}

/**
 * Revokes an active override — the base timetable reapplies on that date.
 * The override record stays in history (append-only); revocation is
 * audited. Unknown or already-revoked references throw.
 */
export async function revokeTimetableOverride(
  ref: string,
  reason: string,
  expectedVersion: number,
  className: string = TIMETABLE_CLASS,
): Promise<TimetableOverride> {
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 10) throw new Error("A revocation reason of at least 10 characters is required.");
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("A valid override version is required.");

  if (clientAdapterMode() === "supabase") {
    const config = await supabaseConfiguration();
    if (config === null) throw new Error("School timetable configuration is unavailable.");
    const section = configuredSection(config, className);
    if (!section?.ref) throw new Error("No timetable section is available for this class.");
    const response = await adapterCall<SupabaseTimetableOverride>("timetable.revokeOverride", {
      overrideRef: ref,
      reason: trimmedReason,
      expectedVersion,
    });
    if (!response.ok) throw new Error(response.errors[0]?.message ?? "Unable to revoke the override.");
    if (response.value.grade_section_id !== section.id) throw new Error("The revoked override does not belong to the selected class.");
    const mapped = mapSupabaseOverride(response.value, className, config, null);
    const current = cachedSupabaseTimetable(className).overrides;
    updateSupabaseTimetableCache(className, {
      overrides: sortOverrides([
        mapped,
        ...current.filter((candidate) => candidate.ref !== mapped.ref),
      ]),
    });
    return { ...mapped };
  }

  const overrides = loadOverrides(className);
  const override = overrides.find((candidate) => candidate.ref === ref);
  if (override === undefined) throw new Error(`No override carries the reference ${ref}.`);
  if (override.version !== expectedVersion) {
    throw new Error(`Override ${ref} version mismatch (expected ${expectedVersion}, found ${override.version}).`);
  }
  if (override.revokedAtIso !== null) throw new Error(`Override ${ref} is already revoked.`);
  const next: TimetableOverride = {
    ...override,
    version: override.version + 1,
    revokedAtIso: demoNowIso(),
    revocationReason: trimmedReason,
  };
  sessionSet(overridesKey(className), overrides.map((candidate) => (candidate.ref === ref ? next : candidate)));
  void auditService.record({
    actor: "Timetable office",
    action: "Timetable changed",
    target: `${className} · ${next.day} ${next.time} · override revoked`,
    outcome: "Success",
    reason: trimmedReason,
  });
  return { ...next };
}

/**
 * The periods shown for one date: the published base for that weekday with
 * every active override applied. Cancellations blank the assignment with
 * an explicit "Cancelled" subject; substitutes replace teacher/subject and
 * room overrides replace the room. The base timetable is never mutated.
 */
export function effectivePeriodsForDate(
  dateIso: string,
  className: string = TIMETABLE_CLASS,
): Period[] {
  const live = clientAdapterMode() === "supabase";
  const day = live ? timetableWeekdayForDate(dateIso) : demoWeekdayForDate(dateIso);
  if (day === null) return [];
  const base = live
    ? cachedSupabaseTimetable(className).version?.periods[day] ?? []
    : effectiveTimetable(className)?.[day] ?? [];
  const active = listTimetableOverrides(className).filter((override) =>
    override.dateIso === dateIso && override.revokedAtIso === null,
  );
  return applyOverridesToPeriods(base, active);
}

/* ------------------------------------------------------------------ */
/* Exam date-sheet publish state                                       */
/* ------------------------------------------------------------------ */

/** Published date-sheet state for a class, or null when never published. */
export async function getDateSheetState(className: string = TIMETABLE_CLASS): Promise<DateSheetState | null> {
  if (clientAdapterMode() === "supabase") {
    const config = await supabaseConfiguration();
    if (config === null) return null;
    const section = configuredSection(config, className);
    if (!section?.ref) return null;
    const response = await adapterCall<SupabaseExamScheduleVersion[]>("timetable.listDateSheets", {
      gradeSectionRef: section.ref,
    });
    if (!response.ok) return null;
    const published = response.value
      .filter((candidate) => candidate.grade_section_id === section.id && candidate.status === "published")
      .sort((left, right) => right.version - left.version)[0];
    if (published === undefined) return null;
    const entries = (published.exam_schedule_entries ?? [])
      .map(mapSupabaseExamSlot)
      .sort((left, right) => left.dateIso.localeCompare(right.dateIso) || left.time.localeCompare(right.time));
    return {
      ref: published.reference,
      className,
      published: true,
      version: published.version,
      publishedAtIso: published.published_at ?? published.created_at,
      by: "Timetable office",
      entries,
    };
  }
  const stored = sessionGet<DateSheetState>(dateSheetKey(className));
  return stored === null ? null : cloneDateSheetState(stored);
}

/**
 * Publishes the exam date sheet for a class — session-backed in the demo
 * (versioned, audited) so the staff publish is a real service write that
 * the portal can read. Supabase mode publishes through the school
 * timetable service when a date-sheet version exists.
 */
export async function publishDateSheet(
  className: string = TIMETABLE_CLASS,
  entries: ReadonlyArray<ExamSlot> = [],
): Promise<DateSheetState> {
  if (clientAdapterMode() === "supabase") {
    if (entries.length === 0) throw new Error("Add at least one exam date before publishing the date sheet.");
    const config = await supabaseConfiguration();
    if (!config) throw new Error("School timetable configuration is unavailable.");
    const section = configuredSection(config, className);
    if (!section?.ref) throw new Error("No timetable section is available for this class.");
    const payload = entries.map((entry) => {
      const subject = config.subjects?.find((candidate) => candidate.name.toLowerCase() === entry.subject.toLowerCase() || candidate.code?.toLowerCase() === entry.subject.toLowerCase());
      if (!subject) throw new Error(`Exam subject ${entry.subject} is not in the school configuration.`);
      const room = config.rooms?.find((candidate) => candidate.label.toLowerCase() === entry.room.toLowerCase() || candidate.code.toLowerCase() === entry.room.toLowerCase());
      if (!room) throw new Error(`Exam room ${entry.room} is not in the school configuration.`);
      const [startsAt = "", endsAt = ""] = entry.time.split(/\s*[–—-]\s*/u);
      if (!/^\d{2}:\d{2}$/.test(startsAt) || !/^\d{2}:\d{2}$/.test(endsAt)) {
        throw new Error(`Exam time ${entry.time} must contain a start and end time.`);
      }
      return { examDate: entry.dateIso, subjectId: subject.id, roomId: room.id, startsAt, endsAt };
    });
    const saved = await adapterCall<{ versionId?: string; reference?: string; version?: number }>("timetable.saveDateSheet", {
      gradeSectionRef: section.ref,
      entries: payload,
    });
    if (!saved.ok) throw new Error(saved.errors[0]?.message ?? "Unable to save the exam date sheet.");
    if (!saved.value.versionId) throw new Error("The saved exam date sheet has no publishable version.");
    const published = await adapterCall<{ reference: string }>("timetable.publishDateSheet", {
      versionId: saved.value.versionId,
      note: `Exam date sheet published for Class ${className}`,
    });
    if (!published.ok) throw new Error(published.errors[0]?.message ?? "Unable to publish the exam date sheet.");
    const authoritative = await getDateSheetState(className);
    if (authoritative === null || authoritative.ref !== published.value.reference) {
      throw new Error("The published exam date sheet could not be reloaded.");
    }
    return authoritative;
  }
  const previous = sessionGet<DateSheetState>(dateSheetKey(className));
  const state: DateSheetState = {
    className,
    published: true,
    version: (previous?.version ?? 0) + 1,
    publishedAtIso: demoNowIso(),
    by: "Timetable office",
    entries: (entries.length > 0 ? entries : getDemoDateSheet()).map((entry) => ({ ...entry })),
  };
  sessionSet(dateSheetKey(className), state);
  void auditService.record({
    actor: state.by,
    action: "Timetable changed",
    target: `Exam date sheet · ${className}`,
    outcome: "Success",
    reason: "Mid-term exam date sheet published.",
  });
  return cloneDateSheetState(state);
}

export type TimetablePortalProjection = {
  timetable: Record<string, Period[]> | null;
  weekDays: string[];
  dateSheet: ExamSlot[];
};

/** One portal read boundary for the effective base, exact-date overrides, and
 * latest published date sheet. Supabase failures return honest empty state and
 * never consult the demo fixture. */
export async function getTimetablePortalProjection(
  className: string = TIMETABLE_CLASS,
): Promise<TimetablePortalProjection> {
  if (clientAdapterMode() !== "supabase") {
    const timetable = effectiveTimetable(className);
    return {
      timetable,
      weekDays: timetable === null ? [] : [...TIMETABLE_WEEK_DAYS],
      dateSheet: getDemoDateSheet(),
    };
  }

  const version = await getTimetableVersion(className);
  if (version === null) {
    updateSupabaseTimetableCache(className, { version: null, overrides: [] });
    return { timetable: null, weekDays: [], dateSheet: [] };
  }
  const [overrides, dateSheet] = await Promise.all([
    listTimetableOverridesAsync(className),
    getDateSheetState(className),
  ]);
  return {
    timetable: projectTimetableOverrides(version.periods, overrides, version.weekOf),
    weekDays: timetableDays(version.periods),
    dateSheet: dateSheet?.entries.map((entry) => ({ ...entry })) ?? [],
  };
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
  listTimetableClasses,
  getDemoDateSheet,
  TIMETABLE_WEEK_DAYS,
  timetableDemoNowIso,
  timetableDemoWeekday,
  effectiveTimetable,
  getEffectiveTimetable,
  getTimetableVersion,
  getTimetableVersionList,
  publishTimetable,
  saveTimetableDraft,
  saveTimetableDraftAsync,
  getTimetableDraft,
  getTimetableDraftAsync,
  clearTimetableDraft,
  clearTimetableSession,
  detectConflicts,
  detectEditConflict,
  initialOpenConflicts,
  deriveEditedKeys,
  validateDraft,
  validateResolve,
  suggestedResolve,
  demoDateForWeekday,
  saveTimetableOverride,
  listTimetableOverrides,
  listTimetableOverridesAsync,
  revokeTimetableOverride,
  effectivePeriodsForDate,
  getDateSheetState,
  publishDateSheet,
  getTimetablePortalProjection,
};
