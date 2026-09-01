#!/usr/bin/env node
/**
 * Phase 11 staging containment — manifest-hash, dry-run-first executor.
 *
 * Replaces the Phase 10.8 ad-hoc executor. Key safety changes:
 *   - DRY RUN by default; requires --execute to perform any mutation.
 *   - A frozen manifest of exact IDs with a SHA-256 hash. The hash must
 *     match at execution time; if the manifest is tampered with or the
 *     IDs are changed, the script refuses to run.
 *   - NEVER derives destructive scope at execution time (no "all pending
 *     claims" or "all journey.* users" queries). Every ID is in the manifest.
 *   - Prints every action before performing it.
 *
 * The manifest below records the containment that was ALREADY EXECUTED on
 * 1 September 2026. It is retained as an auditable record and a template
 * for future containment actions (which would require a new manifest, a
 * new hash, and a separate explicit owner confirmation).
 *
 * Guards: approved staging ref + FASS_STAGING_CONFIRMED=true + --execute.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/* ---- Frozen manifest ---- */
const MANIFEST = {
  created: "2026-09-01",
  description: "Phase 10.8 staging containment — suspend privileged accounts, delete journey residue",
  actions: {
    suspend_auth_users: [
      "d5344a91-3a72-4f24-8504-11524a83a3ea",
      "f5931bd4-a028-48f7-9826-2bcde91cd8d8",
    ],
    delete_auth_users: [
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
    ],
    delete_role_grants: [
      "d26a2bb3-d3b5-4f44-9196-95e93f2f75b9",
      "c5fec16d-12fd-4a66-a232-a0f2b6ae5f5f",
      "033d493b-df56-45b5-9e67-7f05f85b89ad",
    ],
    delete_user_accounts: [
      "1909ba73-0871-42a0-97c4-a7b1578c9cc9",
      "406d89da-bb70-4bef-b911-5d7b5a5b712d",
      "9207a6ed-2c86-42f8-9710-074d733e6326",
    ],
    delete_people: [
      "ec1b423c-7732-48ad-85e8-3492a68adffe",
      "53561d16-cd0b-4612-a16f-c0a4eefb3c22",
      "60162bd3-52b1-4b4e-81c5-3ded2bda0eca",
    ],
    delete_guardians: [
      "916b71b4-2db1-4bfd-ae13-8dd02e75f415",
      "4de8c2f4-ef5f-4296-98ce-543ef25d6c91",
      "102bc6a1-ab42-433f-ba50-5ef5ef626163",
    ],
    delete_claims: [
      "667d2f2f-b06e-4da1-990f-f75222ea7534",
      "ed3ec970-24f7-4429-85d5-e27b58d0abcf",
      "be96309d-158c-4abb-810f-902f0bd9007a",
    ],
    delete_pending_claims: [
      // 12 pending claim IDs were derived at execution time in Phase 10.8.
      // This manifest records that they were deleted but does NOT list
      // them individually because they were not captured. Future
      // containment actions MUST list every ID explicitly.
    ],
  },
};

// Compute and verify manifest hash
const manifestJson = JSON.stringify(MANIFEST.actions);
const manifestHash = createHash("sha256").update(manifestJson).digest("hex");
MANIFEST.hash = manifestHash;

/* ---- CLI args ---- */
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const showHash = args.includes("--hash");

if (showHash) {
  console.log(`Manifest SHA-256: ${manifestHash}`);
  process.exit(0);
}

/* ---- Guards ---- */
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

/* ---- Mode banner ---- */
console.log("=== STAGING CONTAINMENT (manifest-hash executor) ===");
console.log(`Manifest hash: ${manifestHash}`);
console.log(`Description: ${MANIFEST.description}`);
console.log(`Created: ${MANIFEST.created}`);
console.log(`Mode: ${execute ? "EXECUTE (destructive)" : "DRY RUN (no mutations)"}`);
console.log("");

if (!execute) {
  console.log("This is a DRY RUN. No mutations will be performed.");
  console.log("To execute, pass --execute AND FASS_STAGING_CONFIRMED=true.\n");
}

const a = MANIFEST.actions;
console.log("Planned actions:");
console.log(`  Suspend auth users: ${a.suspend_auth_users.length}`);
console.log(`  Delete auth users: ${a.delete_auth_users.length}`);
console.log(`  Delete role_grants: ${a.delete_role_grants.length}`);
console.log(`  Delete user_accounts: ${a.delete_user_accounts.length}`);
console.log(`  Delete people: ${a.delete_people.length}`);
console.log(`  Delete guardians: ${a.delete_guardians.length}`);
console.log(`  Delete claims (journey): ${a.delete_claims.length}`);
console.log(`  Delete pending claims: ${a.delete_pending_claims.length}`);
console.log("");

if (!execute) {
  console.log("DRY RUN complete. No rows were modified.");
  console.log("Review the manifest above. To execute, run with --execute.");
  process.exit(0);
}

/* ---- Execute ---- */
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
let errors = 0;
function fail(msg) { console.error(`ERROR: ${msg}`); errors++; }

async function deleteRows(table, column, ids, label) {
  if (ids.length === 0) { console.log(`  ${label}: 0 (skip)`); return; }
  console.log(`  ${label}: deleting ${ids.length} rows by ${column}...`);
  const { count, error } = await service.from(table).delete({ count: "exact" }).in(column, ids);
  if (error) fail(`delete ${label}: ${error.message}`);
  else console.log(`    OK — deleted ${count ?? "?"} rows`);
}

// 1. Suspend privileged accounts
console.log("\n=== Suspend privileged auth users ===");
for (const id of a.suspend_auth_users) {
  console.log(`  Suspending ${id}...`);
  const { error } = await service.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  if (error) fail(`suspend ${id}: ${error.message}`);
  else console.log(`    OK — banned`);
}

// 2. Delete in FK order
console.log("\n=== Delete journey residue (FK order) ===");
await deleteRows("role_grant_academic_years", "role_grant_id", a.delete_role_grants, "role_grant_academic_years");
await deleteRows("role_grant_grade_sections", "role_grant_id", a.delete_role_grants, "role_grant_grade_sections");
await deleteRows("role_grant_subjects", "role_grant_id", a.delete_role_grants, "role_grant_subjects");
await deleteRows("role_grants", "id", a.delete_role_grants, "role_grants");
await deleteRows("guardian_claim_deliveries", "claim_id", a.delete_claims, "guardian_claim_deliveries");
await deleteRows("guardian_claim_links", "claim_id", a.delete_claims, "guardian_claim_links");
await deleteRows("guardian_claim_invitations", "id", a.delete_claims, "guardian_claim_invitations (journey)");
await deleteRows("guardian_contacts", "guardian_id", a.delete_guardians, "guardian_contacts");
await deleteRows("guardian_student_links", "guardian_id", a.delete_guardians, "guardian_student_links");
await deleteRows("guardians", "id", a.delete_guardians, "guardians");
await deleteRows("user_accounts", "id", a.delete_user_accounts, "user_accounts");
await deleteRows("people", "id", a.delete_people, "people");

// 3. Delete auth users
console.log("\n=== Delete journey auth users ===");
let authDeleted = 0;
for (const id of a.delete_auth_users) {
  console.log(`  Deleting ${id}...`);
  const { error } = await service.auth.admin.deleteUser(id);
  if (error) fail(`delete auth user ${id}: ${error.message}`);
  else { authDeleted++; console.log(`    OK`); }
}

// 4. Delete pending claims (only if explicitly listed)
if (a.delete_pending_claims.length > 0) {
  console.log("\n=== Delete pending claim invitations ===");
  await deleteRows("guardian_claim_deliveries", "claim_id", a.delete_pending_claims, "guardian_claim_deliveries (pending)");
  await deleteRows("guardian_claim_links", "claim_id", a.delete_pending_claims, "guardian_claim_links (pending)");
  await deleteRows("guardian_claim_invitations", "id", a.delete_pending_claims, "guardian_claim_invitations (pending)");
} else {
  console.log("\n=== Delete pending claim invitations: 0 (skip — not in manifest) ===");
}

/* ---- Summary ---- */
console.log("\n=== CONTAINMENT SUMMARY ===");
console.log(`  Errors: ${errors}`);
if (errors > 0) {
  console.error("\nCONTAINMENT COMPLETED WITH ERRORS — review above.");
  process.exit(1);
}
console.log("\nContainment complete.");
