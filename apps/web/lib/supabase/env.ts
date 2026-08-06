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

export type DataAdapter = "demo" | "supabase";

/** The runtime data adapter for the current process. */
export function dataAdapter(): DataAdapter {
  return process.env.FASS_DATA_ADAPTER === "supabase" ? "supabase" : "demo";
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
