/** Provider-neutral storage/scanning contracts.
 *
 * The browser may receive a signed upload token, but only a server worker
 * calls stat/upload/remove and attests to the bytes that reached storage.
 * Domain records and authorization remain outside this provider boundary.
 */

import { createHash } from "node:crypto";
import { connect } from "node:net";

import {
  DEFAULT_SCANNER_TIMEOUT_MS,
  documentScannerProvider,
  scannerTimeoutMs,
} from "@/modules/services/document-scanner-config";

export type { DocumentScannerProviderName } from "@/modules/services/document-scanner-config";
export { documentScannerProvider, documentScannerReadiness, scannerTimeoutMs } from "@/modules/services/document-scanner-config";

export type StorageObjectStat = {
  contentType: string;
  sizeBytes: number;
  /** SHA-256 calculated from the bytes returned by the provider. */
  checksumSha256: string;
  bytes: Uint8Array;
};

export type StorageObject = {
  bucket: string;
  objectKey: string;
  sizeBytes: number;
  contentType: string;
  checksumSha256: string;
};

export interface StorageProvider {
  createSignedUpload(input: { bucket: string; objectKey: string; expiresInSeconds: number }): Promise<{ token: string }>;
  stat(input: { bucket: string; objectKey: string }): Promise<StorageObjectStat>;
  upload(input: { bucket: string; objectKey: string; bytes: Uint8Array; contentType: string; upsert?: boolean }): Promise<{ etag?: string | null }>;
  remove(input: { bucket: string; objectKey: string }): Promise<void>;
  list(input: { bucket: string; prefix?: string; limit?: number }): Promise<StorageObject[]>;
  createSignedDownload(input: { bucket: string; objectKey: string; expiresInSeconds: number }): Promise<string>;
}

export type ScanResult = { state: "ready" | "quarantined" | "failed"; detail?: string };

/** Authoritative server-read object bytes plus the metadata the storage stat
 *  attested. Provider adapters receive the bytes they are asked to scan; a
 *  scanner must never be able to report `ready` without an explicit clean
 *  provider answer. */
export type ScanInput = {
  bucket: string;
  objectKey: string;
  declaredMimeType: string;
  sizeBytes: number;
  /** SHA-256 of the bytes as returned by the storage provider. */
  checksumSha256: string;
  bytes: Uint8Array;
};

export interface DocumentScanner {
  scan(input: ScanInput): Promise<ScanResult>;
}

/** Provider responses are metadata, never documents; keep the read bounded. */
export const SCANNER_MAX_RESPONSE_BYTES = 8_192;
export const CLAMAV_MAX_RESPONSE_BYTES = 4_096;
export const CLAMAV_CHUNK_BYTES = 65_536;
export const CLAMAV_DEFAULT_PORT = 3_310;

/** Raised by the manual provider when no trigger endpoint is configured: the
 *  authenticated callback route is the only authority for the result, so the
 *  worker records the handoff and leaves the document `pending_scan`. */
export class ManualScanDeferredError extends Error {
  constructor() {
    super("Manual scan provider: the result must arrive through the authenticated scan callback route.");
    this.name = "ManualScanDeferredError";
  }
}


/** Deterministic local fake used by local contract/component tests only. */
export class FakeStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async createSignedUpload(): Promise<{ token: string }> {
    return { token: "fake-signed-upload-token" };
  }

  async stat(input: { bucket: string; objectKey: string }): Promise<StorageObjectStat> {
    const existing = this.objects.get(`${input.bucket}/${input.objectKey}`);
    const bytes = existing?.bytes ?? new TextEncoder().encode(input.objectKey);
    const copy = new Uint8Array(bytes);
    return {
      contentType: existing?.contentType ?? (/\.pdf$/i.test(input.objectKey) ? "application/pdf" : detectContentType(copy)),
      sizeBytes: copy.byteLength,
      checksumSha256: sha256(copy),
      bytes: copy,
    };
  }

  async upload(input: { bucket: string; objectKey: string; bytes: Uint8Array; contentType: string; upsert?: boolean }): Promise<{ etag?: string | null }> {
    const key = `${input.bucket}/${input.objectKey}`;
    if (this.objects.has(key) && input.upsert !== true) throw new Error("already exists");
    this.objects.set(key, { bytes: new Uint8Array(input.bytes), contentType: input.contentType });
    return { etag: sha256(input.bytes) };
  }

  async remove(input: { bucket: string; objectKey: string }): Promise<void> {
    this.objects.delete(`${input.bucket}/${input.objectKey}`);
  }

  async list(input: { bucket: string; prefix?: string; limit?: number }): Promise<StorageObject[]> {
    const prefix = `${input.bucket}/${input.prefix ?? ""}`;
    const output: StorageObject[] = [];
    for (const [key, value] of this.objects.entries()) {
      if (!key.startsWith(prefix)) continue;
      const objectKey = key.slice(`${input.bucket}/`.length);
      const bytes = new Uint8Array(value.bytes);
      output.push({ bucket: input.bucket, objectKey, sizeBytes: bytes.byteLength, contentType: value.contentType, checksumSha256: sha256(bytes) });
      if (output.length >= (input.limit ?? 1000)) break;
    }
    return output;
  }

  async createSignedDownload(input: { bucket: string; objectKey: string }): Promise<string> {
    return `fake-private://${input.bucket}/${input.objectKey}`;
  }
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Magic-byte detection is intentionally small and allow-list based.
 *
 * The text/CSV branch mirrors the upload-finalize boundary: no NUL bytes,
 * decodable UTF-8, and at least one field/line separator. Without it the
 * storage.finalize worker classified a school-data import CSV as
 * application/octet-stream and permanently failed the scan, stranding the
 * batch in `uploaded`. */
export function detectContentType(bytes: Uint8Array): string {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) return "image/png";
  const sample = bytes.slice(0, 4096);
  if (sample.length > 0 && !sample.includes(0)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(sample);
      if (/[,\n\r]/.test(text)) return "text/csv";
    } catch {
      /* not valid UTF-8 text */
    }
  }
  return "application/octet-stream";
}

export class FakeDocumentScanner implements DocumentScanner {
  constructor(private readonly result: ScanResult = { state: "ready", detail: "local fake scanner" }) {}

  async scan(_input: ScanInput): Promise<ScanResult> {
    return this.result;
  }
}

export function parseClamAvResponse(line: string): ScanResult | null {
  const match = /^stream:\s*(.*)$/i.exec(line.trim());
  if (match === null) return null;
  const payload = (match[1] ?? "").trim();
  if (/^OK$/i.test(payload)) return { state: "ready" };
  if (/FOUND$/i.test(payload)) {
    /* Keep the signature name for the audit trail, never the raw response. */
    const signature = payload.replace(/\s+FOUND\s*$/i, "").replace(/[^\x20-\x7e]/g, " ").trim().slice(0, 120);
    return { state: "quarantined", detail: signature.length > 0 ? `signature: ${signature}` : "malware signature detected" };
  }
  return null;
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("scanner provider response exceeded the size limit");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function scannerResultFromBody(body: unknown): ScanResult {
  const record = body !== null && typeof body === "object" ? (body as { status?: unknown; detail?: unknown }) : {};
  if (record.status !== "ready" && record.status !== "quarantined" && record.status !== "failed") {
    throw new Error("scanner provider returned an invalid result state");
  }
  return { state: record.status, detail: typeof record.detail === "string" ? record.detail : undefined };
}

/**
 * Manual provider (default). No scan is performed by the worker:
 *   · with `DOCUMENT_SCANNER_URL` the worker POSTs a metadata-only trigger to
 *     the configured stub, which scans out of band and reports the result to
 *     `POST /api/documents/<ref>/scan` with the shared secret;
 *   · without the URL the worker records the handoff immediately.
 * Either way the document stays `pending_scan` until that authenticated
 * callback applies an explicit result.
 */
export class ManualDocumentScanner implements DocumentScanner {
  constructor(private readonly trigger: { endpoint: string; secret: string; timeoutMs?: number; fetchImpl?: typeof fetch } | null = null) {}

  async scan(input: ScanInput): Promise<ScanResult> {
    if (this.trigger !== null) {
      const response = await (this.trigger.fetchImpl ?? fetch)(this.trigger.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.trigger.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          bucket: input.bucket,
          objectKey: input.objectKey,
          declaredMimeType: input.declaredMimeType,
          sizeBytes: input.sizeBytes,
          checksumSha256: input.checksumSha256,
        }),
        signal: AbortSignal.timeout(this.trigger.timeoutMs ?? DEFAULT_SCANNER_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`scanner trigger responded ${response.status}`);
      await response.body?.cancel().catch(() => undefined);
    }
    throw new ManualScanDeferredError();
  }
}

/**
 * HTTP provider. The worker POSTs the authoritative object bytes with the
 * metadata headers below and maps `{ status: ready|quarantined|failed }` to
 * the pipeline. Non-2xx, timeouts, unreadable bodies, and oversized bodies
 * are transient errors: the document stays `pending_scan` and is retried.
 */
export class HttpDocumentScanner implements DocumentScanner {
  constructor(private readonly input: { endpoint: string; secret: string; timeoutMs?: number; maxResponseBytes?: number; fetchImpl?: typeof fetch }) {}

  async scan(input: ScanInput): Promise<ScanResult> {
    const response = await (this.input.fetchImpl ?? fetch)(this.input.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.input.secret}`,
        "Content-Type": "application/octet-stream",
        "X-FASS-Document-Bucket": input.bucket,
        "X-FASS-Document-Object-Key": input.objectKey,
        "X-FASS-Document-Mime-Type": input.declaredMimeType,
        "X-FASS-Document-Size-Bytes": String(input.sizeBytes),
        "X-FASS-Document-Checksum-Sha256": input.checksumSha256,
      },
      body: input.bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(this.input.timeoutMs ?? DEFAULT_SCANNER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`scanner provider responded ${response.status}`);
    const text = await readBoundedResponseText(response, this.input.maxResponseBytes ?? SCANNER_MAX_RESPONSE_BYTES);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("scanner provider returned an unreadable response");
    }
    return scannerResultFromBody(body);
  }
}

/**
 * ClamAV provider: clamd INSTREAM over TCP. `zINSTREAM\0`, then 4-byte
 * big-endian length-prefixed chunks, then a zero-length terminator. `OK`
 * becomes `ready`, `<signature> FOUND` becomes `quarantined`; connection,
 * timeout, oversized, and protocol failures are thrown for the worker's
 * transient-retry policy.
 */
export class ClamAvDocumentScanner implements DocumentScanner {
  constructor(private readonly input: { host: string; port: number; timeoutMs?: number; chunkBytes?: number; maxResponseBytes?: number; connectImpl?: typeof connect }) {}

  scan(input: ScanInput): Promise<ScanResult> {
    const timeoutMs = this.input.timeoutMs ?? DEFAULT_SCANNER_TIMEOUT_MS;
    const chunkBytes = this.input.chunkBytes ?? CLAMAV_CHUNK_BYTES;
    const maxResponseBytes = this.input.maxResponseBytes ?? CLAMAV_MAX_RESPONSE_BYTES;
    return new Promise<ScanResult>((resolve, reject) => {
      const socket = (this.input.connectImpl ?? connect)({ host: this.input.host, port: this.input.port });
      let settled = false;
      let response = Buffer.alloc(0);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        socket.destroy();
        action();
      };
      timer = setTimeout(() => finish(() => reject(new Error("clamav scanner timed out"))), timeoutMs);
      socket.setNoDelay(true);
      socket.on("connect", () => {
        try {
          socket.write("zINSTREAM\0");
          for (let offset = 0; offset < input.bytes.byteLength; offset += chunkBytes) {
            const slice = input.bytes.subarray(offset, Math.min(offset + chunkBytes, input.bytes.byteLength));
            const header = Buffer.alloc(4);
            header.writeUInt32BE(slice.byteLength, 0);
            socket.write(header);
            socket.write(slice);
          }
          socket.write(Buffer.alloc(4));
        } catch {
          finish(() => reject(new Error("clamav scanner stream failed")));
        }
      });
      socket.on("data", (chunk: Buffer) => {
        response = Buffer.concat([response, chunk]);
        if (response.byteLength > maxResponseBytes) {
          finish(() => reject(new Error("clamav scanner response exceeded the size limit")));
          return;
        }
        const terminator = response.indexOf(0);
        if (terminator < 0) return;
        const parsed = parseClamAvResponse(response.subarray(0, terminator).toString("utf8"));
        if (parsed === null) finish(() => reject(new Error("clamav scanner returned an unrecognized result")));
        else finish(() => resolve(parsed));
      });
      socket.on("error", () => finish(() => reject(new Error("clamav scanner connection failed"))));
      socket.on("close", () => finish(() => reject(new Error("clamav scanner closed before reporting a result"))));
    });
  }
}

function clamavPort(env: Record<string, string | undefined>): number {
  const raw = env.DOCUMENT_SCANNER_CLAMAV_PORT?.trim();
  if (raw === undefined || raw === "") return CLAMAV_DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65_535) throw new Error("DOCUMENT_SCANNER_CLAMAV_PORT must be a TCP port between 1 and 65535.");
  return parsed;
}

export function createConfiguredDocumentScanner(env: Record<string, string | undefined> = process.env): DocumentScanner {
  const provider = documentScannerProvider(env);
  const timeoutMs = scannerTimeoutMs(env);
  if (provider === "manual") {
    const secret = env.DOCUMENT_SCANNER_SECRET?.trim() ?? "";
    if (secret.length < 16) throw new Error("DOCUMENT_SCANNER_SECRET (16+ characters) is required so an external scanner can report results through the callback route.");
    const endpoint = env.DOCUMENT_SCANNER_URL?.trim();
    return new ManualDocumentScanner(endpoint ? { endpoint, secret, timeoutMs } : null);
  }
  if (provider === "http") {
    const endpoint = env.DOCUMENT_SCANNER_URL?.trim() ?? "";
    const secret = env.DOCUMENT_SCANNER_SECRET?.trim() ?? "";
    if (endpoint.length === 0 || secret.length === 0) throw new Error("DOCUMENT_SCANNER_URL and DOCUMENT_SCANNER_SECRET are required for the http scanning provider.");
    return new HttpDocumentScanner({ endpoint, secret, timeoutMs });
  }
  const host = env.DOCUMENT_SCANNER_CLAMAV_HOST?.trim() ?? "";
  if (host.length === 0) throw new Error("DOCUMENT_SCANNER_CLAMAV_HOST is required for the clamav scanning provider.");
  return new ClamAvDocumentScanner({ host, port: clamavPort(env), timeoutMs });
}
