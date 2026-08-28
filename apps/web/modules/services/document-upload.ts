"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type DocumentUploadInput = {
  ownerDomain: "admission_application" | "job_application" | "student";
  ownerRecordRef: string;
  attachmentCode: string;
  file: File;
  allowedMimeTypes?: string[];
  maxBytes?: number;
};

export type DocumentUploadResult = {
  documentRef: string;
  status: "pending_scan" | "ready";
};

/**
 * Browser upload boundary. Business authorization remains in the server
 * intent route and signed object upload. A browser checksum or MIME claim is
 * evidence for UX only; finalisation is queued for the service worker so the
 * browser never becomes the authority for bytes/type/size/checksum.
 */
export async function uploadDocumentFile(input: DocumentUploadInput): Promise<DocumentUploadResult> {
  if (input.file.size <= 0 || (input.maxBytes !== undefined && input.file.size > input.maxBytes)) {
    throw new Error("This file is larger than the configured document limit.");
  }
  if (input.allowedMimeTypes !== undefined && !input.allowedMimeTypes.includes(input.file.type)) {
    throw new Error("This file type is not allowed for the selected document.");
  }
  const intentResponse = await fetch("/api/documents/upload-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ownerDomain: input.ownerDomain,
      ownerRecordRef: input.ownerRecordRef,
      attachmentCode: input.attachmentCode,
      filename: input.file.name,
      mimeType: input.file.type,
      sizeBytes: input.file.size,
    }),
  });
  const intent = (await intentResponse.json().catch(() => null)) as { documentRef?: string; objectKey?: string; token?: string; bucket?: string; error?: string } | null;
  if (!intentResponse.ok || !intent?.documentRef || !intent.objectKey || !intent.token || !intent.bucket) {
    throw new Error(intent?.error ?? "Upload intent could not be created.");
  }

  const storage = createSupabaseBrowserClient();
  const { error: uploadError } = await storage.storage.from(intent.bucket).uploadToSignedUrl(intent.objectKey, intent.token, input.file);
  if (uploadError !== null) throw new Error("The document could not be uploaded. Please try again.");

  return { documentRef: intent.documentRef, status: "pending_scan" };
}
