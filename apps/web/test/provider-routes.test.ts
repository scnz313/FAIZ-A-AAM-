// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET as outboxGet } from "@/app/api/outbox/route";
import { GET as healthGet } from "@/app/api/health/route";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("provider and operations route contracts", () => {
  it("cron GET requires the exact Bearer secret", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-for-test");
    const denied = await outboxGet(new NextRequest("http://localhost/api/outbox"));
    expect(denied.status).toBe(401);
    const wrong = await outboxGet(new NextRequest("http://localhost/api/outbox", { headers: { Authorization: "Bearer wrong" } }));
    expect(wrong.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("health response contains readiness only and no provider secret", async () => {
    vi.stubEnv("FASS_DATA_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "demo");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    const result = await healthGet(new NextRequest("http://localhost/api/health"));
    const body = await result.json();
    expect(body.adapter).toBe("demo");
    expect(body).not.toHaveProperty("RESEND_API_KEY");
    expect(body).not.toHaveProperty("SUPABASE_SECRET_KEY");
  });

  it("Vercel cron config invokes the processing GET endpoint", () => {
    const vercel = source("../../vercel.json");
    expect(vercel).toContain('"path": "/api/outbox"');
    /* Hobby accounts only accept daily crons; Pro should restore "* * * * *"
       (docs/VERCEL-DEPLOY.md). The endpoint contract below is unchanged. */
    expect(vercel).toMatch(/"schedule": "(\* \* \* \* \*|0 0 \* \* \*)"/);
    const route = source("app/api/outbox/route.ts");
    expect(route).toContain("export async function GET");
    expect(route).toContain("return run(request)");
    expect(route).toContain("Authorization");
    expect(route).not.toContain("x-cron-secret");
  });

  it("health output is safe and checks migration/worker readiness", () => {
    const route = source("app/api/health/route.ts");
    expect(route).toContain("migrationReady");
    expect(route).toContain("workerLastRunAt");
    expect(route).toContain("missing");
    expect(route).not.toContain("RESEND_API_KEY:");
    expect(route).not.toContain("SUPABASE_SECRET_KEY:");
  });

  it("storage finalisation has service authorization before byte attestation", () => {
    const route = source("app/api/documents/[documentRef]/finalize/route.ts");
    expect(route.indexOf("serviceAuthorized")).toBeLessThan(route.indexOf("new SupabaseStorageProvider"));
    expect(route).toContain("storage_bucket");
    expect(route.indexOf("serviceAuthorized")).toBeLessThan(route.indexOf("getServerActor()"));
    expect(route).toContain("documentRef");
    expect(route).toContain("checksumVerified");
  });

  it("webhook route persists processing/failed states and retry path", () => {
    const route = source("app/api/email/webhook/route.ts");
    expect(route).toContain('status: "processing"');
    expect(route).toContain('status: "failed"');
    expect(route).toContain('existing?.status === "processed"');
    expect(route).toContain("verifyResendWebhook");
  });

  it("protected Server Components dispatch adapter operations in process", () => {
    const loaders = source("lib/supabase/server-loaders.ts");
    const portalTimetable = source("app/portal/timetable/page.tsx");
    const portalTimetableClient = source("components/portal/TimetablePageClient.tsx");
    const adapter = source("lib/supabase/adapter-server.ts");
    expect(loaders).toContain("serverAdapterOperation");
    expect(loaders).not.toContain("serverAdapterCall");
    expect(loaders).toContain('"results.listReleases", studentId ? { studentId } : {}');
    expect(loaders).toContain('"timetable.effective", { gradeSectionId }');
    expect(loaders).toContain("result.value.map(mapServerResultBatch)");
    expect(loaders).toContain("result.value.map(mapServerAuditEvent)");
    expect(loaders).not.toContain("studentRef: studentId");
    expect(loaders).not.toContain("gradeSectionRef: gradeSectionId");
    /* The timetable page delegates to one active-child client projection; the
       server page only supplies the live "today" instant. */
    expect(portalTimetable).toContain("TimetablePageClient");
    expect(portalTimetable).toContain("todayIso");
    expect(portalTimetable).not.toContain("loadServerTimetable");
    expect(portalTimetableClient).toContain("getTimetablePortalProjection");
    expect(portalTimetableClient).toContain("classKeyForGradeSection");
    expect(adapter).toContain("parsed.operation.handle");
    expect(adapter).toContain("resolveAdapterReferences");
  });

  it("memoizes actor resolution per request and parallelizes authorization reads", () => {
    const actor = source("lib/auth/actor.ts");
    const middleware = source("middleware.ts");
    expect(actor).toContain("cache(resolveServerActor)");
    expect(actor).toContain("await Promise.all");
    expect(actor).toContain("auth.getClaims()");
    expect(actor).not.toContain("auth.getUser()");
    expect(middleware).toContain("auth.getClaims()");
    expect(middleware).not.toContain("auth.getUser()");
  });

  it("isolates and accelerates development output while accepting the configured image quality", () => {
    const config = source("next.config.mjs");
    const packageJson = source("package.json");
    expect(config).toContain('NODE_ENV === "development" ? ".next-dev" : ".next"');
    expect(config).toContain("qualities: [80]");
    expect(packageJson).toContain('"dev": "next dev --turbopack"');
  });

  it("keeps development quick sign-in unavailable outside next dev", () => {
    const env = source("lib/supabase/env.ts");
    const route = source("app/api/auth/dev-sign-in/route.ts");
    expect(env).toContain('process.env.NODE_ENV !== "development"');
    expect(route).toContain("developmentAuthEnabled()");
    expect(route).toContain("status: 404");
    expect(route).not.toContain("NEXT_PUBLIC_FASS_DEV_TEST_PASSWORD");
  });

  it("does not duplicate authoritative staff projections after hydration", () => {
    const home = source("components/staff/StaffHomeWorkspace.tsx");
    const queues = source("components/staff/DashboardQueues.tsx");
    const finance = source("app/staff/finance/FinanceWorkspace.tsx");
    expect(home.match(/admissionsService\.listStaffRecords\(\)/g)).toHaveLength(1);
    expect(home.match(/careersService\.listStaffRecords\(\)/g)).toHaveLength(1);
    expect(queues).not.toContain("listStaffRecords()");
    expect(finance).toContain('if (mode !== "demo") return');
  });
});
