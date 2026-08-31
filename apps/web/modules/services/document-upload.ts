"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeDocumentProcessingState, type DocumentProcessingState } from "@/modules/services/documents";

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

export type DocumentUploadStatus = {
  documentRef: string;
  state: DocumentProcessingState;
  checksumVerified: boolean;
};

async function responseBody(response: Response): Promise<Record<string, unknown> | null> {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

/** Read the authoritative server finalization/scan state for recovery UI. */
export async function getDocumentUploadStatus(documentRef: string): Promise<DocumentUploadStatus> {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentRef)}/stat`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await responseBody(response);
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Document status could not be checked.");
  return {
    documentRef,
    state: normalizeDocumentProcessingState(body?.state ?? body?.scanState),
    checksumVerified: body?.checksumVerified === true,
  };
}

/**
 * Browser upload boundary: authorized intent → signed private upload → server
 * byte finalization. The browser never supplies authoritative MIME, size, or
 * checksum values; the finalize route reads the stored bytes itself, links the
 * verified document to its owner, and leaves scanning asynchronous.
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
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      ownerDomain: input.ownerDomain,
      ownerRecordRef: input.ownerRecordRef,
      attachmentCode: input.attachmentCode,
      filename: input.file.name,
      mimeType: input.file.type,
      sizeBytes: input.file.size,
    }),
  });
  const intent = await responseBody(intentResponse) as {
    documentRef?: unknown;
    objectKey?: unknown;
    token?: unknown;
    bucket?: unknown;
    error?: unknown;
  } | null;
  if (
    !intentResponse.ok
    || typeof intent?.documentRef !== "string"
    || typeof intent.objectKey !== "string"
    || typeof intent.token !== "string"
    || typeof intent.bucket !== "string"
  ) {
    throw new Error(typeof intent?.error === "string" ? intent.error : "Upload intent could not be created.");
  }

  const storage = createSupabaseBrowserClient();
  const { error: uploadError } = await storage.storage
    .from(intent.bucket)
    .uploadToSignedUrl(intent.objectKey, intent.token, input.file, { contentType: input.file.type });
  if (uploadError !== null) throw new Error("The document could not be uploaded. Please try again.");

  const finalizeResponse = await fetch(`/api/documents/${encodeURIComponent(intent.documentRef)}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: "{}",
  });
  const finalized = await responseBody(finalizeResponse) as { state?: unknown; error?: unknown } | null;
  if (!finalizeResponse.ok) {
    throw new Error(typeof finalized?.error === "string" ? finalized.error : "The uploaded document could not be finalized.");
  }

  const finalState = normalizeDocumentProcessingState(finalized?.state);
  if (finalState === "quarantined" || finalState === "failed" || finalState === "denied" || finalState === "expired") {
    throw new Error(typeof finalized?.error === "string" ? finalized.error : "The document did not pass finalization.");
  }
  return { documentRef: intent.documentRef, status: finalState === "ready" ? "ready" : "pending_scan" };
}
