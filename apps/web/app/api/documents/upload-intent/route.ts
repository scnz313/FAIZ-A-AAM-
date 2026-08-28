import { NextResponse } from "next/server";

import { getServerActor } from "@/lib/auth/actor";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";
import { callAppRpc } from "@/lib/supabase/rpc";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_BYTES = 10 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

type UploadInput = {
  ownerDomain: "admission_application" | "job_application" | "student";
  ownerRecordRef?: string;
  attachmentCode: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

async function resolveOwnerId(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  actorId: string,
  input: UploadInput,
): Promise<string | null> {
  const ref = input.ownerRecordRef;
  if (input.ownerDomain === "admission_application") {
    let query = client.from("admission_applications").select("id").eq("owner_account_id", actorId);
    if (ref) query = query.eq("reference", ref);
    else return null;
    const { data } = await query.maybeSingle();
    return data?.id ?? null;
  }
  if (input.ownerDomain === "job_application") {
    let query = client.from("job_applications").select("id").eq("owner_account_id", actorId);
    if (ref) query = query.eq("reference", ref);
    else return null;
    const { data } = await query.maybeSingle();
    return data?.id ?? null;
  }
  let query = client.from("students").select("id");
  if (ref) query = query.eq("reference", ref);
  else return null;
  const { data } = await query.maybeSingle();
  if (!data) return null;
  const { data: link } = await client.from("guardian_student_links").select("id").eq("student_id", data.id).eq("status", "active").maybeSingle();
  return link ? data.id : null;
}

export async function POST(request: Request) {
  const correlationId = crypto.randomUUID();
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) return NextResponse.json({ error: "Cross-origin requests are not accepted." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ error: "document uploads are not active in demo mode" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const actor = await getServerActor();
  if (actor === null) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  let input: UploadInput;
  try {
    const body = (await request.json()) as Partial<UploadInput>;
    if (
      (body.ownerDomain !== "admission_application" && body.ownerDomain !== "job_application" && body.ownerDomain !== "student") ||
      typeof body.ownerRecordRef !== "string" ||
      typeof body.attachmentCode !== "string" || typeof body.filename !== "string" ||
      typeof body.mimeType !== "string" || typeof body.sizeBytes !== "number"
    ) throw new Error("invalid payload");
    input = body as UploadInput;
  } catch {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!MIME_EXTENSIONS[input.mimeType] || input.sizeBytes <= 0 || input.sizeBytes > MAX_BYTES) {
    return NextResponse.json({ error: "File type, size, or owner reference is not allowed." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }

  const userClient = await createSupabaseServerClient();
  const ownerRecordId = await resolveOwnerId(userClient, actor.accountId, input);
  if (!ownerRecordId) return NextResponse.json({ error: "The document owner is not accessible to this account." }, { status: 404, headers: { "Cache-Control": "no-store" } });

  const extension = MIME_EXTENSIONS[input.mimeType];
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || `upload.${extension}`;
  const objectKey = `uploads/${crypto.randomUUID()}.${extension}`;
  const metadata = await callAppRpc<{ id: string; reference: string; objectKey: string; status: string }>(userClient, "documents_create_upload_intent", {
    p_owner_domain: input.ownerDomain,
    p_owner_record_id: ownerRecordId,
    p_attachment_code: input.attachmentCode,
    p_safe_filename: safeName,
    p_declared_mime_type: input.mimeType,
    p_declared_size: input.sizeBytes,
    p_allowed_mime_types: [input.mimeType],
    p_max_bytes: MAX_BYTES,
    p_object_key: objectKey,
  });
  if (metadata.error !== null || metadata.data === null) return NextResponse.json({ error: "Upload record could not be created.", correlationId }, { status: 422, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } });

  const signed = await createSupabaseAdminClient().storage.from("fass-private-documents").createSignedUploadUrl(objectKey);
  if (signed.error !== null || signed.data === null) return NextResponse.json({ error: "Upload service is temporarily unavailable.", correlationId }, { status: 503, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } });
  return NextResponse.json(
    { ok: true, documentRef: metadata.data.reference, objectKey, token: signed.data.token, bucket: "fass-private-documents", status: metadata.data.status },
    { headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } },
  );
}
