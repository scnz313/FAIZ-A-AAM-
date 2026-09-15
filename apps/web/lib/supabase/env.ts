/**
 * Supabase environment validation (plan.md §3, §10).
 *
 * `.env.example` carries NAMES AND PLACEHOLDERS ONLY. Real values live in
 * `.env.local` (local), or the Supabase/Resend/Vercel secret managers.
 *
 * Rules enforced here:
 * - Publishable keys may be browser-visible; secret keys are server-only and
 *   are never prefixed NEXT_PUBLIC_ (plan.md §3).
 * - `FASS_DATA_ADAPTER` switches the runtime between the demo and Supabase
 *   adapters; staging and production use `supabase` (plan.md §10).
 * - Server contexts assert the secret key only when the adapter is `supabase`,
 *   so the demo runtime never requires Supabase credentials.
 */

import { documentScannerReadiness, type ScannerEnvReadiness } from "@/modules/services/document-scanner-config";

export type DataAdapter = "demo" | "supabase";

function parseAdapter(value: string | undefined, name: string, fallback: DataAdapter): DataAdapter {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "demo" || value === "supabase") return value;
  throw new Error(`${name} must be demo or supabase.`);
}

function configuredPublicAdapter(): DataAdapter {
  return parseAdapter(process.env.NEXT_PUBLIC_FASS_DATA_ADAPTER, "NEXT_PUBLIC_FASS_DATA_ADAPTER", "demo");
}

/** The runtime data adapter for the current process. */
export function dataAdapter(): DataAdapter {
  const serverAdapter = parseAdapter(process.env.FASS_DATA_ADAPTER, "FASS_DATA_ADAPTER", "demo");
  const publicAdapter = configuredPublicAdapter();
  if (process.env.NEXT_PUBLIC_FASS_DATA_ADAPTER !== undefined && serverAdapter !== publicAdapter) {
    throw new Error(
      `Data adapter mismatch: FASS_DATA_ADAPTER=${serverAdapter} but NEXT_PUBLIC_FASS_DATA_ADAPTER=${publicAdapter}.`,
    );
  }
  return serverAdapter;
}

/** Public Supabase settings; null when the demo adapter is active. */
export function supabasePublicEnv(): { url: string | null; publishableKey: string | null } {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || null,
  };
}

/** Throws when the public Supabase settings are missing — callers must guard
 *  with `dataAdapter() === "supabase"` first. */
export function requireSupabasePublicEnv(): { url: string; publishableKey: string } {
  const { url, publishableKey } = supabasePublicEnv();
  if (url === null || publishableKey === null) {
    throw new Error(
      "Supabase public environment is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required when FASS_DATA_ADAPTER=supabase.",
    );
  }
  return { url, publishableKey };
}

/** Server-only secret-key settings; throws when missing or used on the client. */
export function requireSupabaseSecretEnv(): { secretKey: string } {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || null;
  if (secretKey === null) {
    throw new Error(
      "Supabase secret environment is not configured: SUPABASE_SECRET_KEY is required on the server when FASS_DATA_ADAPTER=supabase.",
    );
  }
  return { secretKey };
}

/** Canonical application URL (redirects, email links). */
export function requireAppEnv(): { appUrl: string } {
  const appUrl = process.env.APP_URL?.trim() || null;
  if (appUrl === null) {
    throw new Error("APP_URL is not configured.");
  }
  return { appUrl };
}

/** Cron dispatcher secret (protected scheduled endpoint). */
export function requireCronSecretEnv(): { cronSecret: string } {
  const cronSecret = process.env.CRON_SECRET?.trim() || null;
  if (cronSecret === null) {
    throw new Error("CRON_SECRET is not configured.");
  }
  return { cronSecret };
}

/** Whether TOTP/AAL2 is required for staff access. Production-like
 *  runtimes always require it; only `next dev` may use auto-elevation.
 *
 *  `FASS_DEMO_NO_TOTP=true` is an explicitly labelled demo escape hatch for
 *  a hosted client walkthrough: staff sign-in elevates server-side instead of
 *  asking for an authenticator code. It must never be set on the production
 *  environment; the default is unchanged and secure. */
export function totpRequired(): boolean {
  const demoNoTotp = process.env.FASS_DEMO_NO_TOTP?.trim().toLowerCase();
  if (demoNoTotp === "true" || demoNoTotp === "1" || demoNoTotp === "on") return false;
  if (process.env.NODE_ENV !== "development") return true;
  const value = process.env.FASS_TOTP_REQUIRED?.trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "off";
}

export function developmentAuthEnabled(): boolean {
  if (process.env.NODE_ENV !== "development" || dataAdapter() !== "supabase") return false;
  const value = process.env.FASS_DEV_AUTH_BYPASS?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "on";
}

export function requireDevelopmentTestPassword(): string {
  if (!developmentAuthEnabled()) throw new Error("Development quick sign-in is disabled.");
  const password = process.env.FASS_DEV_TEST_PASSWORD?.trim() ?? "";
  if (password.length < 8) throw new Error("FASS_DEV_TEST_PASSWORD must contain at least 8 characters.");
  return password;
}

/** Names-only Resend readiness. The outbox worker must not claim email work
 *  while the sender cannot be constructed. */
export function emailProviderReadiness(): { ready: boolean; missing: string[] } {
  const missing = ["RESEND_API_KEY", "EMAIL_FROM"].filter((name) => !process.env[name]?.trim());
  return { ready: missing.length === 0, missing };
}

export type { ScannerEnvReadiness } from "@/modules/services/document-scanner-config";

/** Names-only readiness check for server startup/health checks. The document
 *  scanner requirement depends on `DOCUMENT_SCANNER_PROVIDER`: manual needs
 *  only the callback secret, http needs URL + secret, clamav needs its host. */
export function providerEnvReadiness(): {
  ready: boolean;
  missing: string[];
  email: { ready: boolean; missing: string[] };
  scanner: ScannerEnvReadiness;
} {
  const adapter = dataAdapter();
  const scanner: ScannerEnvReadiness = documentScannerReadiness();
  const required = adapter === "supabase"
    ? ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "APP_URL", "CRON_SECRET", "RESEND_API_KEY", "EMAIL_FROM", "RESEND_WEBHOOK_SECRET"]
    : ["APP_URL"];
  const missing = [
    ...required.filter((name) => !process.env[name]?.trim()),
    ...scanner.missing,
  ];
  return { ready: missing.length === 0, missing, email: emailProviderReadiness(), scanner };
}
