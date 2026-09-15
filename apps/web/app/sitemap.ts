import type { MetadataRoute } from "next";

/* Concept domain — the platform is not yet deployed. `.example` is an
   IANA-reserved documentation domain; set NEXT_PUBLIC_SITE_URL (or replace
   this fallback) with the real school domain at launch. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://faizaam.example";

const absolute = (path: string) => `${SITE_URL}${path}`;

type Entry = MetadataRoute.Sitemap[number];

const publicEntry = (path: string): Entry => ({
  url: absolute(path),
  changeFrequency: "monthly",
  priority: 0.8,
});

/* Only genuinely public pages appear here (plan.md Phase 0): marketing,
   notices, mandatory disclosure, admissions information, public career
   vacancies, and contact. Portal, staff, applicant, status, result,
   invoice, receipt, document, and application-reference routes are private
   and must never be discoverable through the sitemap. */
const PUBLIC_PATHS: readonly string[] = [
  "/about",
  "/academics",
  "/admissions",
  "/school-life",
  "/notices",
  "/disclosure",
  "/careers",
  "/contact",
  "/policies/accessibility",
  "/policies/fees-and-refunds",
  "/policies/privacy",
  "/policies/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  /* Notice deep links are discovered through the notices board and on-page
     navigation, so the sitemap never hardcodes a fixture record. */
  return [
    { url: absolute("/"), changeFrequency: "monthly", priority: 1 },
    ...PUBLIC_PATHS.map(publicEntry),
  ];
}
