/**
 * Structured body contract for the managed public `/school-life` page.
 *
 * The page is stored as a `content_items` row (kind `page`, slug
 * `school-life`) whose immutable `content_versions.body` matches
 * `schoolLifePageBodySchema`. The public route renders the latest published
 * version; when none exists — or a stored body no longer parses — it falls
 * back to `DEFAULT_SCHOOL_LIFE_BODY`, which mirrors the copy the page shipped
 * with before it became editable.
 */

import { z } from "zod";

/** Programme icon choices, all inside the self-hosted Material Symbols subset. */
export const SCHOOL_LIFE_ICON_NAMES = [
  "sports_cricket",
  "palette",
  "volunteer_activism",
  "record_voice_over",
  "map",
  "science",
  "calendar_month",
  "campaign",
  "article",
  "workspace_premium",
  "group",
  "history",
] as const;
export type SchoolLifeIconName = (typeof SCHOOL_LIFE_ICON_NAMES)[number];

/** Gallery artwork keys; the app maps each to its SVG scene component. */
export const SCHOOL_LIFE_ART_KEYS = ["read", "play", "assembly", "lake", "campus", "chinar"] as const;
export type SchoolLifeArtKey = (typeof SCHOOL_LIFE_ART_KEYS)[number];

export const SCHOOL_LIFE_LIMITS = {
  introEyebrow: { min: 1, max: 40 },
  introTitle: { min: 1, max: 120 },
  introDeck: { min: 1, max: 400 },
  programmes: { min: 1, max: 8 },
  programmeTitle: { min: 1, max: 60 },
  programmeLine: { min: 1, max: 400 },
  facilities: { min: 1, max: 8 },
  facilityTitle: { min: 1, max: 60 },
  facilityLine: { min: 1, max: 300 },
  gallery: { min: 1, max: 6 },
  galleryCaption: { min: 1, max: 120 },
  note: { max: 300 },
} as const;

export const schoolLifePageBodySchema = z.object({
  schemaVersion: z.literal(1),
  page: z.literal("school-life"),
  intro: z.object({
    eyebrow: z.string().min(SCHOOL_LIFE_LIMITS.introEyebrow.min).max(SCHOOL_LIFE_LIMITS.introEyebrow.max),
    title: z.string().min(SCHOOL_LIFE_LIMITS.introTitle.min).max(SCHOOL_LIFE_LIMITS.introTitle.max),
    deck: z.string().min(SCHOOL_LIFE_LIMITS.introDeck.min).max(SCHOOL_LIFE_LIMITS.introDeck.max),
  }),
  programmes: z
    .array(
      z.object({
        id: z.string().min(1),
        icon: z.enum(SCHOOL_LIFE_ICON_NAMES),
        title: z.string().min(SCHOOL_LIFE_LIMITS.programmeTitle.min).max(SCHOOL_LIFE_LIMITS.programmeTitle.max),
        line: z.string().min(SCHOOL_LIFE_LIMITS.programmeLine.min).max(SCHOOL_LIFE_LIMITS.programmeLine.max),
      }),
    )
    .min(SCHOOL_LIFE_LIMITS.programmes.min)
    .max(SCHOOL_LIFE_LIMITS.programmes.max),
  facilities: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(SCHOOL_LIFE_LIMITS.facilityTitle.min).max(SCHOOL_LIFE_LIMITS.facilityTitle.max),
        line: z.string().min(SCHOOL_LIFE_LIMITS.facilityLine.min).max(SCHOOL_LIFE_LIMITS.facilityLine.max),
      }),
    )
    .min(SCHOOL_LIFE_LIMITS.facilities.min)
    .max(SCHOOL_LIFE_LIMITS.facilities.max),
  gallery: z
    .array(
      z.object({
        id: z.string().min(1),
        art: z.enum(SCHOOL_LIFE_ART_KEYS),
        caption: z.string().min(SCHOOL_LIFE_LIMITS.galleryCaption.min).max(SCHOOL_LIFE_LIMITS.galleryCaption.max),
      }),
    )
    .min(SCHOOL_LIFE_LIMITS.gallery.min)
    .max(SCHOOL_LIFE_LIMITS.gallery.max),
  note: z.string().max(SCHOOL_LIFE_LIMITS.note.max),
});
export type SchoolLifePageBody = z.infer<typeof schoolLifePageBodySchema>;

/** The copy `/school-life` rendered before the page became managed. */
export const DEFAULT_SCHOOL_LIFE_BODY: SchoolLifePageBody = {
  schemaVersion: 1,
  page: "school-life",
  intro: {
    eyebrow: "School life",
    title: "The timetable is honest: play, art and service are on it.",
    deck: "Sports, arts, assemblies, trips and service rotate through the week and the year as scheduled parts of growing up, with the same standing as any lesson.",
  },
  programmes: [
    {
      id: "programme-sports",
      icon: "sports_cricket",
      title: "Sports",
      line: "Cricket and football lead the year with inter-house leagues; athletics day closes the first term. Evening coaching runs twice a week for the senior squads.",
    },
    {
      id: "programme-arts",
      icon: "palette",
      title: "Arts & crafts",
      line: "Calligraphy on Fridays; watercolour and craft through the term. The corridor gallery changes every month with each class taking its turn.",
    },
    {
      id: "programme-service",
      icon: "volunteer_activism",
      title: "Service",
      line: "Library duty, cleanliness rosters and the winter clothing collection run by the senior classes for the town's needs.",
    },
    {
      id: "programme-assemblies",
      icon: "record_voice_over",
      title: "Assemblies",
      line: "Eight minutes every morning: recitation, the day's news read by a student, and one class presenting each Friday.",
    },
    {
      id: "programme-trips",
      icon: "map",
      title: "Trips",
      line: "One day trip per class each year to the Wular fringe, the old town of Srinagar, and a senior excursion further afield in autumn.",
    },
    {
      id: "programme-clubs",
      icon: "science",
      title: "Clubs & laboratory",
      line: "A science club that keeps the laboratory honest, a quiz circle in winter, and reading hour for the middle school.",
    },
  ],
  facilities: [
    {
      id: "facility-lab",
      title: "Science laboratory",
      line: "One combined lab for physics, chemistry and biology practicals, capped at sensible group sizes.",
    },
    {
      id: "facility-library",
      title: "Library",
      line: "Reading room with Urdu, Kashmiri and English collections; extended hours before assessments.",
    },
    {
      id: "facility-computer-room",
      title: "Computer room",
      line: "Twenty working stations on a filtered connection, timetabled for every class weekly.",
    },
    {
      id: "facility-courtyard",
      title: "Covered courtyard",
      line: "Winter assembly, indoor games and a place to eat when the cold sets in.",
    },
  ],
  gallery: [
    { id: "gallery-read", art: "read", caption: "Reading hour under the chinar · concept art" },
    { id: "gallery-play", art: "play", caption: "Playground, winter sun · concept art" },
    { id: "gallery-assembly", art: "assembly", caption: "Morning assembly · concept art" },
    { id: "gallery-lake", art: "lake", caption: "Wular lake from the school road · concept art" },
    { id: "gallery-campus", art: "campus", caption: "The main block · concept art" },
    { id: "gallery-chinar", art: "chinar", caption: "Chinar in autumn · concept art" },
  ],
  note: "Programme and facility descriptions are concept copy pending the school's confirmation.",
};

/** Parse a stored version body; returns null for legacy/malformed shapes so
 * callers can fall back to the default copy instead of rendering garbage. */
export function parseSchoolLifePageBody(value: unknown): SchoolLifePageBody | null {
  const result = schoolLifePageBodySchema.safeParse(value);
  return result.success ? result.data : null;
}
