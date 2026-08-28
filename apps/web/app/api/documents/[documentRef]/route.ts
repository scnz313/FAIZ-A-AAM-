import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerActor } from "@/lib/auth/actor";
import { dataAdapter } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentRef: string }> },
) {
  const correlationId = crypto.randomUUID();
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ error: "document delivery is not active in demo mode" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const actor = await getServerActor();
  if (actor === null) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const { documentRef } = await params;
  const userClient = await createSupabaseServerClient();
  const db = userClient as unknown as SupabaseClient;
  const { data: document, error } = await db
    .from("documents")
    .select("reference, object_key, storage_bucket, mime_type, safe_filename, scan_status, visibility")
    .eq("reference", documentRef)
    .maybeSingle();
  if (error !== null || document === null || !["ready", "clean"].includes(document.scan_status)) {
    return NextResponse.json({ error: "Document not found or unavailable." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const { data: signed, error: signedError } = await createSupabaseAdminClient()
    .storage
    .from(document.storage_bucket)
    .createSignedUrl(document.object_key, 60);
  if (signedError !== null || signed?.signedUrl === undefined) {
    return NextResponse.json(
      { error: "Document delivery is temporarily unavailable.", correlationId },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } },
    );
  }

  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "private, no-store", "X-Correlation-Id": correlationId },
  });
}
