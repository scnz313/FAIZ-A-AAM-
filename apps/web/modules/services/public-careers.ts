"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Public job-application intake boundary (owner requirement, 15 September
 * 2026). The applicant has no account: the browser calls the same-origin
 * intake routes, which own same-origin checks, rate limiting, honeypot
 * rejection, and service-role persistence. No session, no account, and no
 * service credential is ever needed or exposed here.
 */

export const PUBLIC_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PUBLIC_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export type PublicJobApplicationInput = {
  vacancyRef: string;
  vacancyVersion: number;
  fullName: string;
  email: string;
  phone?: string;
  location?: string;
  qualification?: string;
  subject?: string;
  year?: string;
  institution?: string;
  experience?: string;
  currentRole?: string;
  message?: string;
  consent: true;
};

export type PublicJobApplicationResult = { reference: string | null };

export class PublicIntakeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PublicIntakeError";
    this.code = code;
  }
}

async function responseBody(response: Response): Promise<Record<string, unknown> | null> {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

/** Submit the application. The honeypot value is always sent so the server
 * can reject bot-shaped submissions without the client knowing. */
export async function submitPublicJobApplication(
  input: PublicJobApplicationInput,
  honeypot = "",
): Promise<PublicJobApplicationResult> {
  const response = await fetch("/api/careers/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ ...input, website: honeypot }),
  });
  const body = await responseBody(response);
  if (!response.ok) {
    throw new PublicIntakeError(
      typeof body?.code === "string" ? body.code : "unavailable",
      typeof body?.error === "string" ? body.error : "We could not submit your application right now. Your details are still on this page · please try again.",
    );
  }
  return { reference: typeof body?.reference === "string" && body.reference.length > 0 ? body.reference : null };
}

function photoTypeError(file: File): string | null {
  if (!PUBLIC_PHOTO_MIME_TYPES.includes(file.type as (typeof PUBLIC_PHOTO_MIME_TYPES)[number])) {
    return "Choose a JPEG, PNG, or WebP image.";
  }
  if (file.size <= 0) return "The chosen image is empty. Choose another file.";
  if (file.size > PUBLIC_PHOTO_MAX_BYTES) return "The photo must be 2 MB or smaller.";
  return null;
}

/**
 * Attach the one optional profile photo after the application exists. The
 * server issues a signed upload URL for an opaque key, then re-reads the
 * stored bytes to verify the real type and size before linking the document.
 */
export async function uploadPublicApplicationPhoto(input: { reference: string; file: File }): Promise<{ documentRef: string; state: string }> {
  const typeError = photoTypeError(input.file);
  if (typeError !== null) throw new PublicIntakeError("validation", typeError);

  const intentResponse = await fetch("/api/careers/apply/photo-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      reference: input.reference,
      filename: input.file.name,
      mimeType: input.file.type,
      sizeBytes: input.file.size,
    }),
  });
  const intent = await responseBody(intentResponse);
  if (
    !intentResponse.ok
    || typeof intent?.documentRef !== "string"
    || typeof intent.objectKey !== "string"
    || typeof intent.token !== "string"
    || typeof intent.bucket !== "string"
  ) {
    throw new PublicIntakeError(
      typeof intent?.code === "string" ? intent.code : "unavailable",
      typeof intent?.error === "string" ? intent.error : "The photo could not be prepared for upload.",
    );
  }

  const storage = createSupabaseBrowserClient();
  const { error: uploadError } = await storage.storage
    .from(intent.bucket)
    .uploadToSignedUrl(intent.objectKey, intent.token, input.file, { contentType: input.file.type });
  if (uploadError !== null) {
    throw new PublicIntakeError("unavailable", "The photo could not be uploaded. Your application is not affected.");
  }

  const finalizeResponse = await fetch("/api/careers/apply/photo-finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ reference: input.reference, documentRef: intent.documentRef }),
  });
  const finalized = await responseBody(finalizeResponse);
  if (!finalizeResponse.ok) {
    throw new PublicIntakeError(
      typeof finalized?.code === "string" ? finalized.code : "unavailable",
      typeof finalized?.error === "string" ? finalized.error : "The photo could not be verified. Your application is not affected.",
    );
  }
  return {
    documentRef: intent.documentRef,
    state: typeof finalized?.state === "string" ? finalized.state : "pending_scan",
  };
}
