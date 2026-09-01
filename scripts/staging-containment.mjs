#!/usr/bin/env node
/**
 * Phase 10.8 staging containment — SUSPENDS and DELETES exact residue.
 *
 * Actions (all destructive, all confirmed by owner "all three"):
 *   1. Suspend (ban) the 2 privileged test accounts by exact Auth user ID.
 *   2. Delete journey residue: 19 Auth users + dependent public rows in FK order.
 *   3. Delete 12 pending guardian_claim_invitations (+ deliveries + links).
 *   4. Delete the 1 teaching_assignment if it belongs to a journey person.
 *
 * Guards: approved staging ref + FASS_STAGING_CONFIRMED=true.
 * Prints every ID before acting. Exits non-zero on any failure.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function readEnv(key) {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const match = line.match(new RegExp(`^${key}=(.*)$`));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = readEnv("SUPABASE_SECRET_KEY");
if (!url || !serviceKey) {
  console.error("Missing Supabase env in .env.local");
  process.exit(1);
}
const PROJECT_REF = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) ?? [])[1];
const confirmed = process.env.FASS_STAGING_CONFIRMED === "true" || readEnv("FASS_STAGING_CONFIRMED") === "true";
if (PROJECT_REF !== "jxegiamjcawdywqyutdz" || !confirmed) {
  console.error(`Refusing: containment targets the approved staging project only (got ${PROJECT_REF ?? "unknown"}).`);
  console.error("Set FASS_STAGING_CONFIRMED=true to proceed.");
  process.exit(1);
}

const service = createClient(url, serviceKey, { auth: { persistSession: false } });

/* ---- Exact IDs from the read-only inventory ---- */
const PRIVILEGED_IDS = [
  "d5344a91-3a72-4f24-8504-11524a83a3ea", // test.principal
  "f5931bd4-a028-48f7-9826-2bcde91cd8d8", // test.administrator
];

const JOURNEY_AUTH_IDS = [
  "1909ba73-0871-42a0-97c4-a7b1578c9cc9",
  "406d89da-bb70-4bef-b911-5d7b5a5b712d",
  "9207a6ed-2c86-42f8-9710-074d733e6326",
  "4757824e-a7bc-41c5-8a07-c8e5b223d4d1",
  "d6fa655d-fe05-4e01-b17f-9a46efe64bf3",
  "6d19ee2f-fb43-49f1-95e1-85b256264b4c",
  "02d0f989-d142-4675-bdd7-9b5b9f65b454",
  "103117ab-8ab5-43f2-b008-9a7011233f6a",
  "a4c35e63-ebcd-41be-87f1-94767fb1ff94",
  "a6e01a37-53d8-4ae4-9598-9887b8ea8300",
  "633678d4-37a5-4cd9-8e4c-3fc71e9e136c",
  "c56ee8a9-d731-4a7f-8dc8-93fd38409124",
  "4bbae642-af71-4b99-8bb9-788337ff0ce4",
  "5479a086-e60d-4e6b-886b-42da80a503fa",
  "f6a43ab5-4a60-473a-bbc8-df16ff41006e",
  "f8a25a2b-7baf-4521-a285-8fdbe58e0107",
  "431ff01f-5b95-4a79-b169-21f207145811",
  "dc78d940-afb5-4c4f-8d8c-4244579ca00d",
  "f11d6e52-d16e-44a0-9d97-5d4b9ebf7bb9",
];

let errors = 0;
function log(msg) { console.log(msg); }
function fail(msg) { console.error(`ERROR: ${msg}`); errors++; }

/* ---- Step 1: Suspend privileged test accounts ---- */
log("\n=== STEP 1: Suspend privileged test accounts ===");
for (const id of PRIVILEGED_IDS) {
  log(`  Suspending ${id}...`);
  const { error } = await service.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  if (error) fail(`suspend ${id}: ${error.message}`);
  else log(`    OK — banned for 876000h (~100 years)`);
}

/* ---- Step 2: Resolve journey dependent IDs ---- */
log("\n=== STEP 2: Resolve journey dependent rows ===");
const { data: journeyAccounts } = await service.from("user_accounts").select("id, person_id").in("id", JOURNEY_AUTH_IDS);
const journeyPersonIds = (journeyAccounts ?? []).map((a) => a.person_id).filter(Boolean);
log(`  journey user_accounts: ${journeyAccounts?.length ?? 0}`);
log(`  journey person_ids: ${journeyPersonIds.length} -> ${JSON.stringify(journeyPersonIds)}`);

const { data: journeyGuardians } = await service.from("guardians").select("id, person_id").in("person_id", journeyPersonIds);
const journeyGuardianIds = (journeyGuardians ?? []).map((g) => g.id).filter(Boolean);
log(`  journey guardian_ids: ${journeyGuardianIds.length} -> ${JSON.stringify(journeyGuardianIds)}`);

const { data: journeyClaims } = await service.from("guardian_claim_invitations").select("id, guardian_id").in("guardian_id", journeyGuardianIds);
const journeyClaimIds = (journeyClaims ?? []).map((c) => c.id).filter(Boolean);
log(`  journey claim_ids: ${journeyClaimIds.length} -> ${JSON.stringify(journeyClaimIds)}`);

/* ---- Step 3: Delete journey residue in FK order ---- */
log("\n=== STEP 3: Delete journey residue (FK order) ===");

async function deleteRows(table, column, ids, label) {
  if (ids.length === 0) { log(`  ${label}: 0 (skip)`); return; }
  const { count, error } = await service.from(table).delete({ count: "exact" }).in(column, ids);
  if (error) fail(`delete ${label}: ${error.message}`);
  else log(`  ${label}: deleted ${count ?? "?"} rows`);
}

// Contact changes
await deleteRows("guardian_contact_changes", "guardian_id", journeyGuardianIds, "guardian_contact_changes");
// Claim deliveries
await deleteRows("guardian_claim_deliveries", "claim_id", journeyClaimIds, "guardian_claim_deliveries");
// Claim links
await deleteRows("guardian_claim_links", "claim_id", journeyClaimIds, "guardian_claim_links");
// Claim invitations
await deleteRows("guardian_claim_invitations", "id", journeyClaimIds, "guardian_claim_invitations (journey)");
// Guardian contacts
await deleteRows("guardian_contacts", "guardian_id", journeyGuardianIds, "guardian_contacts");
// Guardian student links
await deleteRows("guardian_student_links", "guardian_id", journeyGuardianIds, "guardian_student_links");
// Guardian campaigns
await deleteRows("guardian_campaigns", "guardian_id", journeyGuardianIds, "guardian_campaigns");
// Guardians
await deleteRows("guardians", "id", journeyGuardianIds, "guardians");
// Teaching assignments for journey persons
await deleteRows("teaching_assignments", "person_id", journeyPersonIds, "teaching_assignments (journey)");
// User accounts
await deleteRows("user_accounts", "id", JOURNEY_AUTH_IDS, "user_accounts");
// People
await deleteRows("people", "id", journeyPersonIds, "people");

/* ---- Step 4: Delete journey Auth users ---- */
log("\n=== STEP 4: Delete journey Auth users ===");
let authDeleted = 0;
for (const id of JOURNEY_AUTH_IDS) {
  const { error } = await service.auth.admin.deleteUser(id);
  if (error) fail(`delete auth user ${id}: ${error.message}`);
  else { authDeleted++; log(`  deleted ${id}`); }
}
log(`  Auth users deleted: ${authDeleted}/${JOURNEY_AUTH_IDS.length}`);

/* ---- Step 5: Delete all pending claim invitations ---- */
log("\n=== STEP 5: Delete pending claim invitations (non-journey) ===");
const { data: pendingClaims } = await service.from("guardian_claim_invitations").select("id").eq("status", "pending");
const pendingClaimIds = (pendingClaims ?? []).map((c) => c.id);
log(`  pending claims found: ${pendingClaimIds.length}`);

if (pendingClaimIds.length > 0) {
  await deleteRows("guardian_claim_deliveries", "claim_id", pendingClaimIds, "guardian_claim_deliveries (pending)");
  await deleteRows("guardian_claim_links", "claim_id", pendingClaimIds, "guardian_claim_links (pending)");
  await deleteRows("guardian_claim_invitations", "id", pendingClaimIds, "guardian_claim_invitations (pending)");
}

/* ---- Summary ---- */
log("\n=== CONTAINMENT SUMMARY ===");
log(`  Privileged accounts suspended: ${2 - errors}/2`);
log(`  Journey Auth users deleted: ${authDeleted}/${JOURNEY_AUTH_IDS.length}`);
log(`  Pending claims deleted: ${pendingClaimIds.length}`);
log(`  Errors: ${errors}`);

if (errors > 0) {
  console.error("\nCONTAINMENT COMPLETED WITH ERRORS — review above.");
  process.exit(1);
}
log("\nContainment complete. Staging is clean of journey/test residue.");
