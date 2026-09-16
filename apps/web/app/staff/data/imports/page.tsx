import type { Metadata } from "next";

import { providerEnvReadiness } from "@/lib/supabase/env";

import { DataImportsWorkspace } from "./ImportsWorkspace";

export const metadata: Metadata = {
  title: "Data imports",
  description: "Upload, validate, and commit school-data imports.",
};

export default function DataImportsPage() {
  /* Server-side provider readiness decides whether the workspace can ever
     advance past "awaiting scan"; the client cannot read the scanner secret.
     The selected provider (manual/http/clamav) owns which names are needed. */
  const { scanner } = providerEnvReadiness();
  return <DataImportsWorkspace scannerConfigured={scanner.ready} scannerProvider={scanner.provider} />;
}
