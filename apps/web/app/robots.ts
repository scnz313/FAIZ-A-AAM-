import type { MetadataRoute } from "next";

/* Concept domain — the platform is not yet deployed. `.example` is an
   IANA-reserved documentation domain; set NEXT_PUBLIC_SITE_URL (or replace
   this fallback) with the real school domain at launch. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://faizaam.example";

/* Indexing protection, not authentication: portal, staff, applicant,
   identity, and demo-state routes are private by policy and excluded from
   crawling. These controls never replace the server-side authorization the
   backend phase must implement. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/portal",
          "/staff",
          "/apply",
          "/sign-in",
          "/session-expired",
          "/access-denied",
          "/ui-states",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
