import type { Metadata } from "next";

import { DEFAULT_SCHOOL_LIFE_BODY } from "@fass/contracts";
import SchoolLifeContent from "@/components/public/pages/SchoolLifeContent";
import { loadServerSchoolLifeBody } from "@/lib/supabase/server-loaders";

export const metadata: Metadata = {
  title: "School Life",
  description:
    "Sports, arts, service, assemblies, trips, and facilities at Faiz E Aam Secondary School, Bandipora.",
  alternates: { canonical: "/school-life" },
};

/**
 * The School life page is managed content: staff publish structured
 * page-sections versions (kind 'page', slug 'school-life'). When no published
 * version exists — or a stored body predates the structured format — the page
 * renders the default copy it shipped with, never an empty shell.
 */
export default async function SchoolLifePage() {
  const body = (await loadServerSchoolLifeBody()) ?? DEFAULT_SCHOOL_LIFE_BODY;
  return <SchoolLifeContent body={body} />;
}
