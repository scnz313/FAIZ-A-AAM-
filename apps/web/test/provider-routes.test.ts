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
    expect(vercel).toContain('"schedule": "* * * * *"');
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
    expect(route).not.toContain("getServerActor");
  });

  it("webhook route persists processing/failed states and retry path", () => {
    const route = source("app/api/email/webhook/route.ts");
    expect(route).toContain('status: "processing"');
    expect(route).toContain('status: "failed"');
    expect(route).toContain('existing?.status === "processed"');
    expect(route).toContain("verifyResendWebhook");
  });
});
