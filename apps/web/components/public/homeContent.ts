/**
 * Home-page managed-content selection (slice C6).
 *
 * Published `kind='page'` rows (`home-hero`, `home-services`, `home-story`,
 * `home-life`) override the institutional copy section by section. This
 * module is pure: the home page loads the raw page bodies and these helpers
 * map them onto each section's fields, so a missing, empty, or unpublished
 * page always falls back to today's copy. Nothing here invents counts,
 * names, dates, or statistics.
 *
 * Authoring convention (one paragraph per row, matching the content
 * workspace editor):
 *   home-hero     page title → headline; body[0] → kicker; body[1] → lede;
 *                 body[2] → primary CTA; body[3] → secondary CTA;
 *                 body[4] → note
 *   home-services per row: first line title, remaining lines the line
 *   home-story    page title → heading; body[0] → sub; body[1..] → narrative
 *   home-life     per row: first line title, remaining lines the line
 */

import type { AdmissionConfiguration } from "@/modules/services/school-config";

export type ManagedPage = { title: string; body: string[] };

export type ManagedHomePages = {
  hero: ManagedPage | null;
  services: ManagedPage | null;
  story: ManagedPage | null;
  life: ManagedPage | null;
};

export const HOME_CONTENT_SLUGS = {
  hero: "home-hero",
  services: "home-services",
  story: "home-story",
  life: "home-life",
} as const;

export type HeroFields = {
  kicker?: string;
  title?: string;
  lede?: string;
  primaryCta?: string;
  secondaryCta?: string;
  note?: string;
};

export type StoryFields = {
  heading?: string;
  sub?: string;
  narrative?: string[];
};

export type ManagedItem = {
  title: string;
  line: string;
};

function cleanBody(body: readonly string[]): string[] {
  return body.map((entry) => entry.trim()).filter((entry) => entry !== "");
}

function cleanTitle(title: string): string | undefined {
  const trimmed = title.trim();
  return trimmed === "" ? undefined : trimmed;
}

function hasFields(fields: HeroFields | StoryFields): boolean {
  return Object.values(fields).some((value) => value !== undefined);
}

/**
 * Merge two hero-copy sources left to right, keeping only the fields a
 * source actually supplies. `selectHeroFields` always returns every key (with
 * `undefined` for absent lines), so a plain object spread would blank a
 * computed fallback; this keeps the computed values unless a managed page
 * overrides them by name.
 */
export function mergeHeroCopy(base: HeroFields | null, overlay: HeroFields | null): HeroFields | null {
  const merged: HeroFields = {};
  for (const source of [base, overlay]) {
    if (source === null) continue;
    for (const [key, value] of Object.entries(source) as Array<[keyof HeroFields, string | undefined]>) {
      if (value !== undefined && value !== "") merged[key] = value;
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * Public-safe hero kicker and note derived from the live admission
 * configuration. An open window names the year, the eligible classes, and
 * the real close date; otherwise the copy points to the notices board
 * rather than inventing a registration date. Passing `null` (no readable
 * configuration) keeps the same honest generic line.
 */
export function selectAdmissionHeroCopy(configuration: AdmissionConfiguration | null): HeroFields {
  const currentYear =
    configuration?.academicYears.find((year) => year.status === "current") ?? configuration?.academicYears[0];
  const openWindows =
    configuration?.windows.filter((window) => window.status === "open" && window.academicYearId === currentYear?.id) ?? [];
  if (configuration === null || currentYear === undefined || openWindows.length === 0) {
    return {
      kicker: "Admissions · dates announced on the notices board",
      note: "Admission dates for the next session are published on the notices board.",
    };
  }
  const classes = configuration.grades
    .filter((grade) => openWindows.some((window) => window.gradeId === grade.id))
    .map((grade) => grade.label);
  const closesAtIso = [...openWindows].map((window) => window.closesAtIso).sort().at(-1);
  const closeDate = closesAtIso === undefined ? null : new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(closesAtIso));
  return {
    kicker: `Admissions ${currentYear.label} · open for ${classes.join(", ") || "the configured grades"}`,
    note:
      closeDate === null
        ? "Seats per grade are limited and filled in order."
        : `Applications close ${closeDate}. Seats per grade are limited and filled in order.`,
  };
}

export function selectHeroFields(page: ManagedPage | null): HeroFields | null {
  if (page === null) return null;
  const body = cleanBody(page.body);
  const fields: HeroFields = {
    kicker: body[0],
    title: cleanTitle(page.title),
    lede: body[1],
    primaryCta: body[2],
    secondaryCta: body[3],
    note: body[4],
  };
  return hasFields(fields) ? fields : null;
}

export function selectStoryFields(page: ManagedPage | null): StoryFields | null {
  if (page === null) return null;
  const body = cleanBody(page.body);
  const fields: StoryFields = {
    heading: cleanTitle(page.title),
    sub: body[0],
    narrative: body.length > 1 ? body.slice(1) : undefined,
  };
  return hasFields(fields) ? fields : null;
}

/**
 * Read managed rows for the service rail and the life index. A row's first
 * line is its title; any remaining lines are its supporting line. A single
 * line may also carry both as "Title · line". Returns null when the page is
 * absent, empty, or yields no usable rows, so callers keep the fallback.
 */
export function selectManagedItems(page: ManagedPage | null): ManagedItem[] | null {
  if (page === null) return null;
  const items: ManagedItem[] = [];
  for (const entry of cleanBody(page.body)) {
    const lines = entry
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    if (lines.length === 0) continue;
    const first = lines[0];
    if (first === undefined) continue;
    if (lines.length === 1) {
      const dot = first.split(" · ");
      const head = dot[0];
      if (dot.length > 1 && head !== undefined && head.trim() !== "") {
        items.push({ title: head.trim(), line: dot.slice(1).join(" · ").trim() });
      } else {
        items.push({ title: first, line: "" });
      }
      continue;
    }
    items.push({ title: first, line: lines.slice(1).join(" ") });
  }
  return items.length > 0 ? items : null;
}
