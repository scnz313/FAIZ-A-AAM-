import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";
import { callAppRpc } from "@/lib/supabase/rpc";

function serviceAuthorized(request: Request): boolean {
  const expected = process.env.DOCUMENT_SCANNER_SECRET;
  const authorization = request.headers.get("authorization");
  return typeof expected === "string" && expected.length >= 16 && authorization === `Bearer ${expected}`;
}

export async function POST(request: Request, { params }: { params: Promise<{ documentRef: string }> }) {
  if (!serviceAuthorized(request)) return NextResponse.json({ error: "Scanner authorization required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (dataAdapter() !== "supabase") return NextResponse.json({ error: "Document scanning is not active in demo mode." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const { documentRef } = await params;
  const body = (await request.json().catch(() => null)) as { status?: unknown; detail?: unknown } | null;
  const status = body?.status === "quarantined" || body?.status === "failed" ? body.status : body?.status === "ready" ? "ready" : null;
  if (!status) return NextResponse.json({ error: "Invalid scanner result." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const admin = createSupabaseAdminClient();
  const { data: document } = await admin.from("documents").select("id, reference").eq("reference", documentRef).maybeSingle();
  if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const result = await callAppRpc<{ reference: string; status: string }>(admin, "documents_apply_scan", { p_document_id: document.id, p_status: status, p_detail: typeof body?.detail === "string" ? body.detail : null });
  if (result.error !== null || result.data === null) return NextResponse.json({ error: "Scanner result could not be recorded." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ ok: true, documentRef: result.data.reference, status: result.data.status }, { headers: { "Cache-Control": "no-store" } });
}

