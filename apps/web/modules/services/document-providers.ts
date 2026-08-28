/** Provider-neutral storage/scanning contracts.
 *
 * The browser may receive a signed upload token, but only a server worker
 * calls stat/upload/remove and attests to the bytes that reached storage.
 * Domain records and authorization remain outside this provider boundary.
 */

import { createHash } from "node:crypto";

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

export interface DocumentScanner {
  scan(input: { bucket: string; objectKey: string; declaredMimeType: string; sizeBytes: number; checksumSha256: string }): Promise<ScanResult>;
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

/** Magic-byte detection is intentionally small and allow-list based. */
export function detectContentType(bytes: Uint8Array): string {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) return "image/png";
  return "application/octet-stream";
}

export class FakeDocumentScanner implements DocumentScanner {
  constructor(private readonly result: ScanResult = { state: "ready", detail: "local fake scanner" }) {}

  async scan(_input: { bucket: string; objectKey: string; declaredMimeType: string; sizeBytes: number; checksumSha256: string }): Promise<ScanResult> {
    return this.result;
  }
}

/**
 * Scanner boundary for a school-approved scanning service.  The scanner is
 * called by the worker with a server-side secret; it is never constructed by
 * browser code.  Leaving the URL unset is a configuration error rather than
 * an implicit clean/ready result.
 */
export class HttpDocumentScanner implements DocumentScanner {
  constructor(private readonly input: { endpoint: string; secret: string; fetchImpl?: typeof fetch }) {}

  async scan(input: { bucket: string; objectKey: string; declaredMimeType: string; sizeBytes: number; checksumSha256: string }): Promise<ScanResult> {
    const response = await (this.input.fetchImpl ?? fetch)(this.input.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.input.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await response.json().catch(() => ({}))) as { status?: unknown; detail?: unknown };
    if (!response.ok) throw new Error(`scanner provider ${response.status}`);
    if (body.status !== "ready" && body.status !== "quarantined" && body.status !== "failed") throw new Error("scanner returned an invalid state");
    return { state: body.status, detail: typeof body.detail === "string" ? body.detail : undefined };
  }
}

export function createConfiguredDocumentScanner(): DocumentScanner {
  const endpoint = process.env.DOCUMENT_SCANNER_URL?.trim();
  const secret = process.env.DOCUMENT_SCANNER_SECRET?.trim();
  if (!endpoint || !secret) throw new Error("DOCUMENT_SCANNER_URL and DOCUMENT_SCANNER_SECRET are required for provider scanning.");
  return new HttpDocumentScanner({ endpoint, secret });
}
