import type { SupabaseClient } from "@supabase/supabase-js";

import type { ServerActor } from "@/lib/auth/actor";
import type { Database } from "@/lib/supabase/database.types";
import { callAppRpc } from "@/lib/supabase/rpc";

export type StoredDocumentAccessRecord = {
  owner_domain: string;
  owner_record_id: string;
  scan_status: string;
  checksum_verified: boolean;
  finalized_at: string | null;
  retention_until: string | null;
  legal_hold_until: string | null;
  deleted_at: string | null;
};

export type StoredDocumentAvailability = "ready" | "pending" | "quarantined" | "failed" | "expired";

/**
 * Resolve delivery readiness from authoritative metadata. A clean/ready label
 * is insufficient without server byte finalisation and checksum verification.
 */
export function storedDocumentAvailability(
  document: StoredDocumentAccessRecord,
  now: Date = new Date(),
): StoredDocumentAvailability {
  const retentionReached = document.retention_until !== null
    && new Date(document.retention_until).getTime() <= now.getTime()
    && (document.legal_hold_until === null || new Date(document.legal_hold_until).getTime() <= now.getTime());

  if (document.deleted_at !== null || retentionReached) return "expired";
  if (document.scan_status === "quarantined") return "quarantined";
  if (document.scan_status === "failed") return "failed";
  if (
    (document.scan_status === "ready" || document.scan_status === "clean")
    && document.finalized_at !== null
    && document.checksum_verified
  ) {
    return "ready";
  }
  return "pending";
}

/**
 * Explicit owning-record authorization for document routes. The database
 * helper evaluates applicant ownership, guardian capability, staff role/AAL,
 * and record scope. This call is required even when an RLS-filtered read would
 * also deny the row: signed delivery never treats RLS as its only check.
 */
export async function documentActorCanAccess(
  client: SupabaseClient<Database>,
  actor: ServerActor,
  document: Pick<StoredDocumentAccessRecord, "owner_domain" | "owner_record_id">,
): Promise<boolean> {
  if (actor.accountStatus !== "active" || actor.accountId !== actor.userId) return false;
  const authorization = await callAppRpc<boolean>(client, "document_actor_allowed", {
    p_owner_domain: document.owner_domain,
    p_owner_record_id: document.owner_record_id,
  });
  return authorization.error === null && authorization.data === true;
}
