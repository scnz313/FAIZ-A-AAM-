import type { Metadata } from "next";

import { PublicationPageClient } from "@/components/portal/PublicationPageClient";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerFamilyContext, loadServerResultPublications } from "@/lib/supabase/server-loaders";
import type { Publication } from "@/modules/services/academics";

export const metadata: Metadata = { title: "Released report · Portal" };

function mapRelease(value: unknown): Publication | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as { id?: unknown; reference?: unknown; term?: unknown; version?: unknown; status?: unknown; publishedAt?: unknown };
  if (typeof row.reference !== "string" || typeof row.term !== "string" || typeof row.version !== "number") return null;
  return { ref: row.reference, term: row.term, version: row.version, status: row.status === "provisional" ? "provisional" : "final", publishedAtIso: typeof row.publishedAt === "string" ? row.publishedAt : null, releaseId: typeof row.id === "string" ? row.id : undefined };
}

export default async function PortalPublicationPage({ params }: { params: Promise<{ publicationRef: string }> }) {
  const { publicationRef } = await params;
  if (dataAdapter() !== "supabase") return <PublicationPageClient publicationRef={publicationRef} initialPublication={null} />;
  const context = await loadServerFamilyContext();
  const rows = await loadServerResultPublications(context.activeStudentId ?? undefined);
  const initialPublication = rows.map(mapRelease).find((item) => item?.ref === publicationRef) ?? null;
  return <PublicationPageClient publicationRef={publicationRef} initialPublication={initialPublication} />;
}
