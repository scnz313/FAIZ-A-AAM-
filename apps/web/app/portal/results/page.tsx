import type { Metadata } from "next";

import { ResultsPageClient } from "@/components/portal/ResultsPageClient";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerFamilyContext, loadServerResultPublications } from "@/lib/supabase/server-loaders";
import type { Publication } from "@/modules/services/academics";

export const metadata: Metadata = { title: "Results · Portal" };

function mapRelease(value: unknown): Publication | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as { id?: unknown; reference?: unknown; term?: unknown; version?: unknown; status?: unknown; publishedAt?: unknown; items?: unknown };
  if (typeof row.reference !== "string" || typeof row.term !== "string" || typeof row.version !== "number") return null;
  return { ref: row.reference, term: row.term, version: row.version, status: row.status === "provisional" ? "provisional" : "final", publishedAtIso: typeof row.publishedAt === "string" ? row.publishedAt : null, releaseId: typeof row.id === "string" ? row.id : undefined, items: Array.isArray(row.items) ? row.items.filter((item): item is { publicationId: string; subjectId: string; snapshot: unknown } => typeof item === "object" && item !== null && typeof (item as { publicationId?: unknown }).publicationId === "string" && typeof (item as { subjectId?: unknown }).subjectId === "string") : [] };
}

export default async function PortalResultsPage() {
  if (dataAdapter() !== "supabase") return <ResultsPageClient initialPublications={null} />;
  const context = await loadServerFamilyContext();
  const rows = await loadServerResultPublications(context.activeStudentId ?? undefined);
  const initialPublications = rows.map(mapRelease).filter((item): item is Publication => item !== null);
  return <ResultsPageClient initialPublications={initialPublications} />;
}
