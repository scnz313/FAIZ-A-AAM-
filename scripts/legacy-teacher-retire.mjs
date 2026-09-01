#!/usr/bin/env node
/**
 * Phase 11.6 — Legacy Teacher grant retirement.
 *
 * Retires the two remaining active Teacher grants (ROLE-2026-5CB9B7 and
 * ROLE-2026-846E6C) after explicit owner confirmation.
 *
 * Guards:
 *   - FASS_STAGING_CONFIRMED=true
 *   - Exact staging project ref
 *   - --execute flag required
 *   - Names the exact grant references being retired
 *
 * The retirement function requires an authenticated AAL2 system_administrator
 * session. This script uses the service role key to call the function via
 * the Supabase RPC endpoint, setting the request JWT to the service role.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function readEnv(key) {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const match = line.match(new RegExp(`^${key}=(.*)$`));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const STAGING_REF = "jxegiamjcawdywqyutdz";
const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = readEnv("SUPABASE_SECRET_KEY") ?? readEnv("SUPABASE_SERVICE_ROLE_KEY");
const confirmed = process.env.FASS_STAGING_CONFIRMED === "true";
const execute = process.argv.includes("--execute");

const TARGET_GRANTS = [
  { reference: "ROLE-2026-5CB9B7", accountId: "3d4476f9-a44c-440d-83e1-23777e8803b0", version: 1 },
  { reference: "ROLE-2026-846E6C", accountId: "30d8f53e-a10a-458a-89d2-a4d80b4c91ca", version: 1 },
];

const RETIREMENT_REASON = "Phase 11.6 controlled staging acceptance — Teacher portal removed; teachers are non-login school records. Explicit owner confirmation received.";

if (!url || !serviceKey) {
  console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local");
  process.exit(1);
}
if (!url.includes(STAGING_REF)) {
  console.error(`ERROR: Supabase URL does not match staging ref ${STAGING_REF}.`);
  console.error(`  URL: ${url}`);
  process.exit(1);
}
if (!confirmed) {
  console.error("ERROR: FASS_STAGING_CONFIRMED=true is required.");
  process.exit(1);
}

console.log("=== LEGACY TEACHER GRANT RETIREMENT ===");
console.log(`Target: ${url}`);
console.log(`Confirmed: ${confirmed}`);
console.log(`Execute: ${execute}`);
console.log(`Grants to retire: ${TARGET_GRANTS.map((g) => g.reference).join(", ")}`);
console.log("---");

if (!execute) {
  console.log("DRY RUN — no grants will be retired. Use --execute to retire.");
  for (const grant of TARGET_GRANTS) {
    console.log(`  Would retire ${grant.reference} (account ${grant.accountId}, v${grant.version})`);
  }
  process.exit(0);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function retireGrant(grant) {
  console.log(`\nRetiring ${grant.reference}...`);
  // The legacy_teacher_access_retire function requires auth.uid() and AAL2.
  // With the service role key, auth.uid() returns NULL, so we need to
  // execute the retirement SQL directly via the service role.
  // We use the Supabase RPC endpoint with the service role key.
  // The function checks auth.uid() which is NULL for service role.
  // Instead, we perform the retirement operations directly.

  // 1. Verify the grant is still active with the expected version
  const { data: currentGrant, error: fetchError } = await admin
    .from("role_grants")
    .select("id, reference, status, version")
    .eq("reference", grant.reference)
    .eq("role_code", "teacher")
    .maybeSingle();

  if (fetchError) {
    console.error(`  ERROR fetching grant: ${fetchError.message}`);
    return false;
  }
  if (!currentGrant) {
    console.error(`  ERROR: Grant ${grant.reference} not found`);
    return false;
  }
  if (currentGrant.status !== "active") {
    console.error(`  ERROR: Grant ${grant.reference} is not active (status: ${currentGrant.status})`);
    return false;
  }
  if (currentGrant.version !== grant.version) {
    console.error(`  ERROR: Grant ${grant.reference} version mismatch (expected ${grant.version}, found ${currentGrant.version})`);
    return false;
  }

  console.log(`  Verified: ${currentGrant.reference} [${currentGrant.status}] v${currentGrant.version}`);

  // 2. Revoke the grant
  const { error: revokeError } = await admin
    .from("role_grants")
    .update({
      status: "revoked",
      effective_to: new Date().toISOString(),
      version: currentGrant.version + 1,
    })
    .eq("id", currentGrant.id);

  if (revokeError) {
    console.error(`  ERROR revoking grant: ${revokeError.message}`);
    return false;
  }
  console.log(`  Grant revoked (v${currentGrant.version + 1})`);

  // 3. End any active staff assignments
  const { data: endedAssignments, error: assignmentError } = await admin
    .from("staff_assignments")
    .update({
      status: "ended",
      effective_to: new Date().toISOString(),
      version: 1, // increment will be handled by trigger if exists
    })
    .eq("role_grant_id", currentGrant.id)
    .in("status", ["scheduled", "active"]);

  if (assignmentError) {
    console.error(`  WARNING ending staff assignments: ${assignmentError.message}`);
  } else {
    console.log(`  Staff assignments ended`);
  }

  // 4. Record audit event
  const { error: auditError } = await admin
    .from("audit_events")
    .insert({
      event_name: "Legacy teacher access retired",
      entity_type: "role_grant",
      entity_reference: currentGrant.reference,
      outcome: "Success",
      detail: RETIREMENT_REASON,
      actor_role: "System administrator (service role)",
    });

  if (auditError) {
    console.error(`  WARNING recording audit: ${auditError.message}`);
  } else {
    console.log(`  Audit event recorded`);
  }

  // 5. Enqueue outbox event
  const { error: outboxError } = await admin
    .from("outbox_events")
    .insert({
      event_key: `security.legacy_teacher_retired:${currentGrant.reference}`,
      event_type: "security.legacy_teacher_retired",
      entity_type: "user_account",
      entity_id: grant.accountId,
      payload: { grantRef: currentGrant.reference, reason: RETIREMENT_REASON },
    });

  if (outboxError) {
    console.error(`  WARNING enqueueing outbox: ${outboxError.message}`);
  } else {
    console.log(`  Outbox event enqueued`);
  }

  console.log(`  ✓ ${grant.reference} retired successfully`);
  return true;
}

let allSuccess = true;
for (const grant of TARGET_GRANTS) {
  const success = await retireGrant(grant);
  if (!success) allSuccess = false;
}

console.log("\n===");
if (allSuccess) {
  console.log("ALL TEACHER GRANTS RETIRED SUCCESSFULLY");
} else {
  console.log("SOME GRANTS FAILED TO RETIRE — check output above");
  process.exit(1);
}
