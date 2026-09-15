// @vitest-environment node
/**
 * Document scanner provider boundary: provider selection, manual deferral,
 * HTTP byte-posting, live clamd INSTREAM framing over a real local TCP
 * server, and bounded timeouts. Fictional bytes only.
 */
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ClamAvDocumentScanner,
  HttpDocumentScanner,
  ManualDocumentScanner,
  ManualScanDeferredError,
  createConfiguredDocumentScanner,
  documentScannerProvider,
  documentScannerReadiness,
  parseClamAvResponse,
  scannerTimeoutMs,
  type ScanInput,
} from "@/modules/services/document-providers";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 fictional scanner fixture");

function scanInput(overrides: Partial<ScanInput> = {}): ScanInput {
  return {
    bucket: "fass-private-documents",
    objectKey: "uploads/00000000-0000-4000-8000-000000000001.pdf",
    declaredMimeType: "application/pdf",
    sizeBytes: PDF_BYTES.byteLength,
    checksumSha256: "a".repeat(64),
    bytes: PDF_BYTES,
    ...overrides,
  };
}

type FakeClamd = {
  port: number;
  requests: Buffer[];
  payloads: Buffer[];
  close: () => Promise<void>;
};

/** A tiny clamd-compatible server: parses `zINSTREAM\0` length-prefixed
 *  chunks and answers with the supplied response line (null = stay silent). */
async function startFakeClamd(respond: (payload: Buffer) => string | null): Promise<FakeClamd> {
  const requests: Buffer[] = [];
  const payloads: Buffer[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let raw: Buffer[] = [];
    let payload: Buffer[] = [];
    let stage: "command" | "length" | "data" | "terminated" = "command";
    let remaining = 0;
    let responded = false;
    socket.on("data", (chunk) => {
      raw.push(chunk);
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (stage === "command") {
          const nul = buffer.indexOf(0);
          if (nul < 0) return;
          if (buffer.subarray(0, nul).toString("utf8") !== "zINSTREAM") {
            socket.destroy();
            return;
          }
          buffer = buffer.subarray(nul + 1);
          stage = "length";
        } else if (stage === "length") {
          if (buffer.length < 4) return;
          const length = buffer.readUInt32BE(0);
          buffer = buffer.subarray(4);
          if (length === 0) {
            stage = "terminated";
            break;
          }
          remaining = length;
          stage = "data";
        } else if (stage === "data") {
          const take = Math.min(remaining, buffer.length);
          payload.push(Buffer.from(buffer.subarray(0, take)));
          buffer = buffer.subarray(take);
          remaining -= take;
          if (remaining === 0) stage = "length";
          if (buffer.length === 0) return;
        } else {
          return;
        }
      }
      if (stage === "terminated" && !responded) {
        responded = true;
        requests.push(Buffer.concat(raw));
        payloads.push(Buffer.concat(payload));
        const answer = respond(Buffer.concat(payload));
        if (answer !== null) socket.write(`${answer}\0`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake clamd did not bind a TCP port");
  return {
    port: address.port,
    requests,
    payloads,
    close: () => new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}

/** Parse the raw INSTREAM frame the scanner wrote, for framing assertions. */
function parseInstreamFrames(raw: Buffer): { command: string; chunks: Buffer[]; terminated: boolean } {
  const nul = raw.indexOf(0);
  const command = raw.subarray(0, nul).toString("utf8");
  const chunks: Buffer[] = [];
  let cursor = nul + 1;
  let terminated = false;
  while (cursor + 4 <= raw.length) {
    const length = raw.readUInt32BE(cursor);
    cursor += 4;
    if (length === 0) {
      terminated = true;
      break;
    }
    chunks.push(Buffer.from(raw.subarray(cursor, cursor + length)));
    cursor += length;
  }
  return { command, chunks, terminated };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("scanner provider selection and readiness", () => {
  it("defaults to manual so existing environments do not change", () => {
    expect(documentScannerProvider({})).toBe("manual");
    expect(documentScannerProvider({ DOCUMENT_SCANNER_PROVIDER: "  " })).toBe("manual");
    expect(documentScannerProvider({ DOCUMENT_SCANNER_PROVIDER: "CLAMAV" })).toBe("clamav");
  });

  it("rejects an unknown provider name in both the factory and readiness", () => {
    expect(() => documentScannerProvider({ DOCUMENT_SCANNER_PROVIDER: "vendor-x" })).toThrow(/must be manual, http, or clamav/);
    expect(() => createConfiguredDocumentScanner({ DOCUMENT_SCANNER_PROVIDER: "vendor-x" })).toThrow(/must be manual, http, or clamav/);
    const readiness = documentScannerReadiness({ DOCUMENT_SCANNER_PROVIDER: "vendor-x" });
    expect(readiness).toMatchObject({ provider: null, ready: false, missing: ["DOCUMENT_SCANNER_PROVIDER"] });
  });

  it("reports names-only readiness per provider", () => {
    expect(documentScannerReadiness({}).missing).toEqual(["DOCUMENT_SCANNER_SECRET"]);
    expect(documentScannerReadiness({ DOCUMENT_SCANNER_SECRET: "short" }).ready).toBe(false);
    expect(documentScannerReadiness({ DOCUMENT_SCANNER_SECRET: "s".repeat(32) })).toMatchObject({ provider: "manual", ready: true, missing: [] });
    expect(documentScannerReadiness({ DOCUMENT_SCANNER_PROVIDER: "http" }).missing).toEqual(["DOCUMENT_SCANNER_URL", "DOCUMENT_SCANNER_SECRET"]);
    expect(documentScannerReadiness({ DOCUMENT_SCANNER_PROVIDER: "http", DOCUMENT_SCANNER_URL: "https://scanner.example.test/scan", DOCUMENT_SCANNER_SECRET: "s".repeat(32) })).toMatchObject({ ready: true, missing: [] });
    expect(documentScannerReadiness({ DOCUMENT_SCANNER_PROVIDER: "clamav" }).missing).toEqual(["DOCUMENT_SCANNER_CLAMAV_HOST"]);
    expect(documentScannerReadiness({ DOCUMENT_SCANNER_PROVIDER: "clamav", DOCUMENT_SCANNER_CLAMAV_HOST: "clamd.internal" })).toMatchObject({ ready: true, missing: [] });
  });

  it("builds the selected adapter and refuses an incomplete configuration", () => {
    expect(createConfiguredDocumentScanner({ DOCUMENT_SCANNER_SECRET: "s".repeat(32) })).toBeInstanceOf(ManualDocumentScanner);
    expect(createConfiguredDocumentScanner({
      DOCUMENT_SCANNER_PROVIDER: "manual",
      DOCUMENT_SCANNER_URL: "http://127.0.0.1:3999/scan",
      DOCUMENT_SCANNER_SECRET: "s".repeat(32),
    })).toBeInstanceOf(ManualDocumentScanner);
    expect(createConfiguredDocumentScanner({
      DOCUMENT_SCANNER_PROVIDER: "http",
      DOCUMENT_SCANNER_URL: "https://scanner.example.test/scan",
      DOCUMENT_SCANNER_SECRET: "s".repeat(32),
    })).toBeInstanceOf(HttpDocumentScanner);
    expect(createConfiguredDocumentScanner({ DOCUMENT_SCANNER_PROVIDER: "clamav", DOCUMENT_SCANNER_CLAMAV_HOST: "127.0.0.1" })).toBeInstanceOf(ClamAvDocumentScanner);
    expect(() => createConfiguredDocumentScanner({})).toThrow(/DOCUMENT_SCANNER_SECRET/);
    expect(() => createConfiguredDocumentScanner({ DOCUMENT_SCANNER_PROVIDER: "http", DOCUMENT_SCANNER_SECRET: "s".repeat(32) })).toThrow(/DOCUMENT_SCANNER_URL/);
    expect(() => createConfiguredDocumentScanner({ DOCUMENT_SCANNER_PROVIDER: "clamav" })).toThrow(/DOCUMENT_SCANNER_CLAMAV_HOST/);
  });

  it("bounds the provider timeout to a safe range", () => {
    expect(scannerTimeoutMs({})).toBe(15_000);
    expect(scannerTimeoutMs({ DOCUMENT_SCANNER_TIMEOUT_MS: "500" })).toBe(1_000);
    expect(scannerTimeoutMs({ DOCUMENT_SCANNER_TIMEOUT_MS: "60000" })).toBe(60_000);
    expect(scannerTimeoutMs({ DOCUMENT_SCANNER_TIMEOUT_MS: "9999999" })).toBe(120_000);
    expect(scannerTimeoutMs({ DOCUMENT_SCANNER_TIMEOUT_MS: "not-a-number" })).toBe(15_000);
  });
});

describe("manual scanner path", () => {
  it("defers to the authenticated callback without a trigger and never reports ready", async () => {
    const scanner = new ManualDocumentScanner(null);
    await expect(scanner.scan(scanInput())).rejects.toBeInstanceOf(ManualScanDeferredError);
  });

  it("POSTs metadata only to the legacy trigger stub, then defers", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const scanner = new ManualDocumentScanner({ endpoint: "http://127.0.0.1:3999/scan", secret: "s".repeat(32), fetchImpl });
    await expect(scanner.scan(scanInput())).rejects.toBeInstanceOf(ManualScanDeferredError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe("http://127.0.0.1:3999/scan");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${"s".repeat(32)}` });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      bucket: "fass-private-documents",
      objectKey: "uploads/00000000-0000-4000-8000-000000000001.pdf",
      declaredMimeType: "application/pdf",
      sizeBytes: PDF_BYTES.byteLength,
      checksumSha256: "a".repeat(64),
    });
    expect(JSON.stringify(body)).not.toContain("%PDF");
  });

  it("treats a failing trigger as a retryable error instead of a scan result", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    const scanner = new ManualDocumentScanner({ endpoint: "http://127.0.0.1:3999/scan", secret: "s".repeat(32), fetchImpl });
    await expect(scanner.scan(scanInput())).rejects.toThrow(/scanner trigger responded 503/);
  });

  it("drives a live local callback stub with metadata only, then defers", async () => {
    const received: Array<{ authorization: string | undefined; body: string }> = [];
    const stub: HttpServer = createHttpServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk as Buffer));
      request.on("end", () => {
        received.push({ authorization: request.headers.authorization, body: Buffer.concat(chunks).toString("utf8") });
        response.writeHead(202);
        response.end();
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const address = stub.address();
    if (address === null || typeof address === "string") throw new Error("trigger stub did not bind a TCP port");
    try {
      const secret = "t".repeat(32);
      const scanner = createConfiguredDocumentScanner({
        DOCUMENT_SCANNER_PROVIDER: "manual",
        DOCUMENT_SCANNER_URL: `http://127.0.0.1:${address.port}/scan`,
        DOCUMENT_SCANNER_SECRET: secret,
      });
      await expect(scanner.scan(scanInput())).rejects.toBeInstanceOf(ManualScanDeferredError);
      expect(received).toHaveLength(1);
      const trigger = received[0]!;
      expect(trigger.authorization).toBe(`Bearer ${secret}`);
      expect(JSON.parse(trigger.body)).toEqual({
        bucket: "fass-private-documents",
        objectKey: "uploads/00000000-0000-4000-8000-000000000001.pdf",
        declaredMimeType: "application/pdf",
        sizeBytes: PDF_BYTES.byteLength,
        checksumSha256: "a".repeat(64),
      });
      expect(trigger.body).not.toContain("%PDF");
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
  });
});

describe("http scanner provider", () => {
  it("posts the object bytes with metadata headers and maps a clean result", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "ready" }), { status: 200 }));
    const scanner = new HttpDocumentScanner({ endpoint: "https://scanner.example.test/scan", secret: "s".repeat(32), fetchImpl });
    await expect(scanner.scan(scanInput())).resolves.toEqual({ state: "ready", detail: undefined });
    const [endpoint, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe("https://scanner.example.test/scan");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${"s".repeat(32)}`,
      "Content-Type": "application/octet-stream",
      "X-FASS-Document-Bucket": "fass-private-documents",
      "X-FASS-Document-Object-Key": "uploads/00000000-0000-4000-8000-000000000001.pdf",
      "X-FASS-Document-Mime-Type": "application/pdf",
      "X-FASS-Document-Size-Bytes": String(PDF_BYTES.byteLength),
      "X-FASS-Document-Checksum-Sha256": "a".repeat(64),
    });
    expect(init.body).toBe(PDF_BYTES);
  });

  it("maps quarantine with the provider signature detail", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "quarantined", detail: "signature: Eicar-Test-Signature" }), { status: 200 }));
    const scanner = new HttpDocumentScanner({ endpoint: "https://scanner.example.test/scan", secret: "s".repeat(32), fetchImpl });
    await expect(scanner.scan(scanInput())).resolves.toEqual({ state: "quarantined", detail: "signature: Eicar-Test-Signature" });
  });

  it("maps an explicit provider failure and never upgrades it to ready", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "failed", detail: "unreadable document" }), { status: 200 }));
    const scanner = new HttpDocumentScanner({ endpoint: "https://scanner.example.test/scan", secret: "s".repeat(32), fetchImpl });
    await expect(scanner.scan(scanInput())).resolves.toEqual({ state: "failed", detail: "unreadable document" });
  });

  it("throws for non-2xx, malformed, invalid, and oversized provider responses", async () => {
    const options = { endpoint: "https://scanner.example.test/scan", secret: "s".repeat(32) };
    const cases: Array<[string, typeof fetch]> = [
      ["responded 500", vi.fn(async () => new Response("server error", { status: 500 })) as unknown as typeof fetch],
      ["unreadable response", vi.fn(async () => new Response("not json", { status: 200 })) as unknown as typeof fetch],
      ["invalid result state", vi.fn(async () => new Response(JSON.stringify({ status: "clean" }), { status: 200 })) as unknown as typeof fetch],
      ["exceeded the size limit", vi.fn(async () => new Response("x".repeat(9_000), { status: 200 })) as unknown as typeof fetch],
    ];
    for (const [message, fetchImpl] of cases) {
      await expect(new HttpDocumentScanner({ ...options, fetchImpl }).scan(scanInput())).rejects.toThrow(new RegExp(message));
    }
  });

  it("aborts on the provider timeout instead of waiting forever", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    })) as unknown as typeof fetch;
    const scanner = new HttpDocumentScanner({ endpoint: "https://scanner.example.test/scan", secret: "s".repeat(32), timeoutMs: 50, fetchImpl });
    await expect(scanner.scan(scanInput())).rejects.toThrow(/aborted/i);
  });
});

describe("clamav scanner provider over live TCP", () => {
  const servers: FakeClamd[] = [];
  async function fakeClamd(respond: (payload: Buffer) => string | null): Promise<FakeClamd> {
    const server = await startFakeClamd(respond);
    servers.push(server);
    return server;
  }
  afterEach(async () => {
    while (servers.length > 0) await servers.pop()!.close();
  });

  it("frames INSTREAM as length-prefixed chunks with a zero terminator and maps OK", async () => {
    const clamd = await fakeClamd(() => "stream: OK");
    const scanner = new ClamAvDocumentScanner({ host: "127.0.0.1", port: clamd.port, timeoutMs: 3_000, chunkBytes: 8 });
    await expect(scanner.scan(scanInput())).resolves.toEqual({ state: "ready" });
    expect(clamd.payloads[0]).toEqual(Buffer.from(PDF_BYTES));
    const frames = parseInstreamFrames(clamd.requests[0]!);
    expect(frames.command).toBe("zINSTREAM");
    expect(frames.terminated).toBe(true);
    expect(frames.chunks).toHaveLength(Math.ceil(PDF_BYTES.byteLength / 8));
    expect(Buffer.concat(frames.chunks)).toEqual(Buffer.from(PDF_BYTES));
    for (const chunk of frames.chunks) expect(chunk.byteLength).toBeLessThanOrEqual(8);
  });

  it("maps a FOUND signature to quarantine without echoing raw bytes", async () => {
    const clamd = await fakeClamd(() => "stream: Eicar-Test-Signature FOUND");
    const scanner = new ClamAvDocumentScanner({ host: "127.0.0.1", port: clamd.port, timeoutMs: 3_000 });
    await expect(scanner.scan(scanInput())).resolves.toEqual({ state: "quarantined", detail: "signature: Eicar-Test-Signature" });
  });

  it("strips control characters from a quarantined signature", () => {
    expect(parseClamAvResponse("stream: Bad\u0007Sig FOUND")).toEqual({ state: "quarantined", detail: "signature: Bad Sig" });
    expect(parseClamAvResponse("stream: OK")).toEqual({ state: "ready" });
    expect(parseClamAvResponse("stream: Heuristic.Archive ERROR")).toBeNull();
    expect(parseClamAvResponse("INSTREAM size limit exceeded. ERROR")).toBeNull();
  });

  it("rejects an unrecognized clamd response instead of guessing", async () => {
    const clamd = await fakeClamd(() => "stream: Heuristic.Archive ERROR");
    const scanner = new ClamAvDocumentScanner({ host: "127.0.0.1", port: clamd.port, timeoutMs: 3_000 });
    await expect(scanner.scan(scanInput())).rejects.toThrow(/unrecognized result/);
  });

  it("rejects an oversized clamd response without buffering it all", async () => {
    const clamd = await fakeClamd(() => "x".repeat(10_000));
    const scanner = new ClamAvDocumentScanner({ host: "127.0.0.1", port: clamd.port, timeoutMs: 3_000, maxResponseBytes: 64 });
    await expect(scanner.scan(scanInput())).rejects.toThrow(/exceeded the size limit/);
  });

  it("times out a clamd endpoint that never answers", async () => {
    const clamd = await fakeClamd(() => null);
    const scanner = new ClamAvDocumentScanner({ host: "127.0.0.1", port: clamd.port, timeoutMs: 100 });
    await expect(scanner.scan(scanInput())).rejects.toThrow(/timed out/);
  });

  it("reports an unreachable clamd endpoint for the worker's transient retry", async () => {
    const clamd = await fakeClamd(() => "stream: OK");
    const port = clamd.port;
    await clamd.close();
    servers.pop();
    const scanner = new ClamAvDocumentScanner({ host: "127.0.0.1", port, timeoutMs: 1_000 });
    await expect(scanner.scan(scanInput())).rejects.toThrow(/connection failed/);
  });
});
