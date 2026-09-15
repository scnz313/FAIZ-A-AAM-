// @vitest-environment node
/**
 * Live callback boundary: the real route handler, the real supabase-js admin
 * client, and a local PostgREST-shaped HTTP server. This proves the manual
 * contract end to end (authenticated POST -> document lookup -> scan RPC)
 * without mocks of the route's collaborators.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/documents/[documentRef]/scan/route";

const SECRET = "scanner-secret-0123456789abcdef";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000401";

type Recorded = { method: string; path: string; search: string; body: unknown };

let server: Server;
const requests: Recorded[] = [];

function requestFor(reference: string, options: { authorization?: string | null; body?: unknown } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.authorization !== undefined && options.authorization !== null) headers.set("Authorization", options.authorization);
  return new Request(`http://localhost/api/documents/${reference}/scan`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? { status: "ready" }),
  });
}

function contextFor(reference: string) {
  return { params: Promise.resolve({ documentRef: reference }) };
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      requests.push({ method: request.method ?? "", path: url.pathname, search: url.search, body });
      const send = (status: number, payload: unknown) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      if (request.method === "GET" && url.pathname === "/rest/v1/documents") {
        const filter = url.searchParams.get("reference") ?? "";
        const reference = filter.startsWith("eq.") ? filter.slice(3) : "";
        send(200, reference === "DOC-2026-FICTION" ? [{ id: DOCUMENT_ID, reference: "DOC-2026-FICTION" }] : []);
        return;
      }
      if (request.method === "POST" && url.pathname === "/rest/v1/rpc/documents_apply_scan") {
        const args = (body ?? {}) as { p_status?: string };
        send(200, { reference: "DOC-2026-FICTION", status: args.p_status, replayed: false });
        return;
      }
      send(404, { message: "fake PostgREST has no route for this request" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake PostgREST did not bind a TCP port");
  vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fiction");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_fiction");
  vi.stubEnv("DOCUMENT_SCANNER_SECRET", SECRET);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("live manual scan callback", () => {
  it("authenticates, reads the document, and records the scan RPC over HTTP", async () => {
    requests.length = 0;
    const response = await POST(
      requestFor("DOC-2026-FICTION", { authorization: `Bearer ${SECRET}`, body: { status: "ready", detail: "live fixture" } }),
      contextFor("DOC-2026-FICTION"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, documentRef: "DOC-2026-FICTION", status: "ready" });
    const lookup = requests.find((entry) => entry.method === "GET" && entry.path === "/rest/v1/documents");
    expect(lookup?.search).toContain("reference=eq.DOC-2026-FICTION");
    const apply = requests.find((entry) => entry.method === "POST" && entry.path === "/rest/v1/rpc/documents_apply_scan");
    expect(apply?.body).toMatchObject({ p_document_id: DOCUMENT_ID, p_status: "ready", p_detail: "live fixture" });
  });

  it("records quarantine and failure exactly as reported", async () => {
    for (const status of ["quarantined", "failed"] as const) {
      requests.length = 0;
      const response = await POST(
        requestFor("DOC-2026-FICTION", { authorization: `Bearer ${SECRET}`, body: { status } }),
        contextFor("DOC-2026-FICTION"),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, documentRef: "DOC-2026-FICTION", status });
      expect(requests.find((entry) => entry.path === "/rest/v1/rpc/documents_apply_scan")?.body).toMatchObject({ p_status: status });
    }
  });

  it("returns not-found without writing a scan result for an unknown reference", async () => {
    requests.length = 0;
    const response = await POST(
      requestFor("DOC-2026-MISSING", { authorization: `Bearer ${SECRET}` }),
      contextFor("DOC-2026-MISSING"),
    );
    expect(response.status).toBe(404);
    expect(requests.some((entry) => entry.path === "/rest/v1/rpc/documents_apply_scan")).toBe(false);
  });

  it("rejects a wrong secret before any backend request", async () => {
    requests.length = 0;
    const response = await POST(
      requestFor("DOC-2026-FICTION", { authorization: `Bearer ${"x".repeat(SECRET.length)}` }),
      contextFor("DOC-2026-FICTION"),
    );
    expect(response.status).toBe(401);
    expect(requests).toHaveLength(0);
  });
});
