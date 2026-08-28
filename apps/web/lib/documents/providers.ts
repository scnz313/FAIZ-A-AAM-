import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { detectContentType, sha256, type StorageObject, type StorageObjectStat, type StorageProvider } from "@/modules/services/document-providers";

/** Real private Supabase Storage boundary.  Callers receive object bytes only
 * server-side so size, magic type, and SHA-256 are authoritative. */
export class SupabaseStorageProvider implements StorageProvider {
  constructor(private readonly admin = createSupabaseAdminClient()) {}

  async createSignedUpload(input: { bucket: string; objectKey: string; expiresInSeconds: number }) {
    const { data, error } = await this.admin.storage.from(input.bucket).createSignedUploadUrl(input.objectKey);
    if (error || !data) throw new Error("storage upload intent unavailable");
    return { token: data.token };
  }

  async stat(input: { bucket: string; objectKey: string }): Promise<StorageObjectStat> {
    const { data, error } = await this.admin.storage.from(input.bucket).download(input.objectKey);
    if (error || !data) throw new Error("storage object unavailable");
    const bytes = new Uint8Array(await data.arrayBuffer());
    return {
      // Storage metadata is advisory.  The worker trusts only the magic-byte
      // type and bytes returned by the private bucket.
      contentType: detectContentType(bytes),
      sizeBytes: bytes.byteLength,
      checksumSha256: sha256(bytes),
      bytes,
    };
  }

  async upload(input: { bucket: string; objectKey: string; bytes: Uint8Array; contentType: string; upsert?: boolean }): Promise<{ etag?: string | null }> {
    const { data, error } = await this.admin.storage.from(input.bucket).upload(input.objectKey, input.bytes as unknown as ArrayBuffer, {
      contentType: input.contentType,
      upsert: input.upsert ?? false,
    });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
    return { etag: data?.id ?? null };
  }

  async remove(input: { bucket: string; objectKey: string }): Promise<void> {
    const { error } = await this.admin.storage.from(input.bucket).remove([input.objectKey]);
    if (error) throw new Error(`storage object removal failed: ${error.message}`);
  }

  async list(input: { bucket: string; prefix?: string; limit?: number }): Promise<StorageObject[]> {
    const output: StorageObject[] = [];
    const limit = Math.min(Math.max(input.limit ?? 1000, 1), 1000);
    const walk = async (prefix: string, depth: number): Promise<void> => {
      if (output.length >= limit || depth > 8) return;
      const { data, error } = await this.admin.storage.from(input.bucket).list(prefix, {
        limit,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`storage listing failed: ${error.message}`);
      for (const object of data ?? []) {
        if (!object.name) continue;
        const objectKey = `${prefix ? `${prefix.replace(/\/$/, "")}/` : ""}${object.name}`;
        // Supabase returns directory entries without a file id/metadata.
        if (!object.id && object.metadata === null) {
          await walk(`${objectKey}/`, depth + 1);
          continue;
        }
        try {
          const stat = await this.stat({ bucket: input.bucket, objectKey });
          output.push({ bucket: input.bucket, objectKey, sizeBytes: stat.sizeBytes, contentType: stat.contentType, checksumSha256: stat.checksumSha256 });
        } catch {
          // A concurrently removed object is not an orphan candidate.
        }
        if (output.length >= limit) break;
      }
    };
    await walk(input.prefix ?? "", 0);
    return output;
  }

  async createSignedDownload(input: { bucket: string; objectKey: string; expiresInSeconds: number }) {
    const { data, error } = await this.admin.storage.from(input.bucket).createSignedUrl(input.objectKey, input.expiresInSeconds);
    if (error || !data?.signedUrl) throw new Error("storage download unavailable");
    return data.signedUrl;
  }
}
