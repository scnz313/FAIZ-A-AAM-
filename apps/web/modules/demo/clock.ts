/**
 * Injected deterministic demo clock.
 *
 * Demo flows must never read the real wall clock: the prototype presents a
 * fixed editorial concept date. Tests may pin the clock with `setDemoNow`
 * (and restore it with `setDemoNow(null)`) so demo behavior stays
 * deterministic across the suite.
 */

// Concept demo date — the fixed editorial date used across the prototype.
const DEFAULT_NOW = new Date("2026-08-03T08:30:00+05:30");

let injected: Date | null = null;

/** The current demo instant: the injected test date, or the concept default. */
export function demoNow(): Date {
  return injected ?? DEFAULT_NOW;
}

/** Test hook: pin the clock. Pass null to restore the concept default. */
export function setDemoNow(date: Date | null): void {
  injected = date;
}

export function demoNowIso(): string {
  return demoNow().toISOString();
}

const FOLIO_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

type FolioParts = {
  weekday: string;
  day: string;
  month: string;
  year: string;
};

function demoDateParts(date: Date): FolioParts {
  const parts = FOLIO_FORMATTER.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: value("weekday"),
    day: value("day"),
    month: value("month"),
    year: value("year"),
  };
}

/** Short uppercase label for folios, e.g. "MONDAY, 3 AUGUST 2026". */
export function demoTodayLabel(): string {
  const { weekday, day, month, year } = demoDateParts(demoNow());
  return `${weekday.toUpperCase()}, ${day.toUpperCase()} ${month.toUpperCase()} ${year.toUpperCase()}`;
}

/** Weekday name used by the timetable's "today" (e.g. "Monday"). */
export function demoWeekday(): string {
  return demoDateParts(demoNow()).weekday;
}

/** Static label for contexts that cannot call the function (equals the default). */
export const DEMO_DATE_LABEL = "MONDAY, 3 AUGUST 2026";
