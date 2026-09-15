/**
 * Pure document-scanner configuration and names-only readiness.
 *
 * This module must stay free of Node built-ins: `lib/supabase/env.ts` imports
 * it and is bundled into the browser through the Supabase browser client.
 * The provider implementations (fetch, TCP sockets, byte handling) live in
 * `document-providers.ts`, which is server-only.
 */

export type DocumentScannerProviderName = "manual" | "http" | "clamav";

export type ScannerEnvReadiness = {
  provider: DocumentScannerProviderName | null;
  ready: boolean;
  missing: string[];
  detail?: string;
};

export const DEFAULT_SCANNER_TIMEOUT_MS = 15_000;
export const MIN_SCANNER_TIMEOUT_MS = 1_000;
export const MAX_SCANNER_TIMEOUT_MS = 120_000;

export function documentScannerProvider(env: Record<string, string | undefined> = process.env): DocumentScannerProviderName {
  const raw = env.DOCUMENT_SCANNER_PROVIDER?.trim().toLowerCase();
  if (raw === undefined || raw === "") return "manual";
  if (raw === "manual" || raw === "http" || raw === "clamav") return raw;
  throw new Error("DOCUMENT_SCANNER_PROVIDER must be manual, http, or clamav.");
}

function configuredSecret(env: Record<string, string | undefined>, name: string): boolean {
  return (env[name]?.trim().length ?? 0) >= 16;
}

function configuredValue(env: Record<string, string | undefined>, name: string): boolean {
  return (env[name]?.trim().length ?? 0) > 0;
}

export function scannerTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DOCUMENT_SCANNER_TIMEOUT_MS?.trim();
  if (raw === undefined || raw === "") return DEFAULT_SCANNER_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SCANNER_TIMEOUT_MS;
  return Math.min(Math.max(parsed, MIN_SCANNER_TIMEOUT_MS), MAX_SCANNER_TIMEOUT_MS);
}

/** Names-only readiness for the selected provider. It never returns values.
 *  manual needs only the callback secret; http needs URL + secret; clamav
 *  needs its host (the port defaults to 3310). */
export function documentScannerReadiness(env: Record<string, string | undefined> = process.env): ScannerEnvReadiness {
  let provider: DocumentScannerProviderName;
  try {
    provider = documentScannerProvider(env);
  } catch {
    return { provider: null, ready: false, missing: ["DOCUMENT_SCANNER_PROVIDER"], detail: "DOCUMENT_SCANNER_PROVIDER must be manual, http, or clamav." };
  }
  if (provider === "manual") {
    return configuredSecret(env, "DOCUMENT_SCANNER_SECRET")
      ? { provider, ready: true, missing: [] }
      : { provider, ready: false, missing: ["DOCUMENT_SCANNER_SECRET"] };
  }
  if (provider === "http") {
    const missing: string[] = [];
    if (!configuredValue(env, "DOCUMENT_SCANNER_URL")) missing.push("DOCUMENT_SCANNER_URL");
    if (!configuredSecret(env, "DOCUMENT_SCANNER_SECRET")) missing.push("DOCUMENT_SCANNER_SECRET");
    return { provider, ready: missing.length === 0, missing };
  }
  return configuredValue(env, "DOCUMENT_SCANNER_CLAMAV_HOST")
    ? { provider, ready: true, missing: [] }
    : { provider, ready: false, missing: ["DOCUMENT_SCANNER_CLAMAV_HOST"] };
}
