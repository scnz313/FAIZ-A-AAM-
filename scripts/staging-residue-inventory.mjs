#!/usr/bin/env node
/**
 * Read-only staging residue inventory (Phase 10.0 containment gate).
 *
 * Lists exact Auth user IDs and dependent row counts for journey/test
 * residue WITHOUT printing names, emails, or contact values. Output is the
 * input for the separately-confirmed containment/cleanup manifest.
 *
 * Guards: approved staging ref + FASS_STAGING_CONFIRMED=true. Read-only —
 * no insert/update/delete anywhere in this script.
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
  console.error(`Refusing: inventory targets the approved staging project only (got ${PROJECT_REF ?? "unknown"}).`);
  process.exit(1);
}

const service = createClient(url, serviceKey, { auth: { persistSession: false } });

async function count(table, column, value) {
  const { count, error } = await service.from(table).select("id", { count: "exact", head: true }).eq(column, value);
  return error ? `error: ${error.message}` : count;
}

console.log("=== STAGING RESIDUE INVENTORY (read-only; IDs only, no PII) ===\n");

/* 1. Privileged profile test accounts (by exact email, IDs only). */
const { data: users, error: usersError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (usersError) {
  console.error(`auth list failed: ${usersError.message}`);
  process.exit(1);
}
const all = users.users ?? [];
const privileged = all.filter((u) =>
  ["test.administrator@faizaam.example", "test.principal@faizaam.example"].includes((u.email ?? "").toLowerCase()),
);
console.log(`auth_users_total: ${all.length}`);
console.log(`privileged_test_accounts: ${privileged.length}`);
for (const user of privileged) {
  console.log(`  id=${user.id} email=${user.email} last_sign_in=${user.last_sign_in_at ?? "never"} created=${user.created_at}`);
}
console.log("");

/* 2. Journey Auth users (email prefix journey.). */
const journeyUsers = all.filter((u) => (u.email ?? "").toLowerCase().startsWith("journey."));
console.log(`journey_auth_users: ${journeyUsers.length}`);
for (const user of journeyUsers) {
  console.log(`  id=${user.id} created=${user.created_at}`);
}
console.log("");

/* 3. Dependent row counts for the journey user IDs. */
const journeyIds = new Set(journeyUsers.map((u) => u.id));
const { data: accounts } = await service.from("user_accounts").select("id, person_id");
const journeyAccounts = (accounts ?? []).filter((a) => journeyIds.has(a.id));
const journeyPersonIds = new Set(journeyAccounts.map((a) => a.person_id));
console.log(`journey_user_accounts: ${journeyAccounts.length}`);

const { data: guardians } = await service.from("guardians").select("id, person_id");
const journeyGuardians = (guardians ?? []).filter((g) => journeyPersonIds.has(g.person_id));
const journeyGuardianIds = new Set(journeyGuardians.map((g) => g.id));
console.log(`journey_guardians: ${journeyGuardians.length}`);

const { data: students } = await service.from("students").select("id, person_id");
const journeyStudents = (students ?? []).filter((s) => journeyPersonIds.has(s.person_id));
const journeyStudentIds = new Set(journeyStudents.map((s) => s.id));
console.log(`journey_students: ${journeyStudents.length}`);

const { data: links } = await service.from("guardian_student_links").select("id, guardian_id, student_id, status");
const journeyLinks = (links ?? []).filter(
  (l) => journeyGuardianIds.has(l.guardian_id) || journeyStudentIds.has(l.student_id),
);
console.log(`journey_links: ${journeyLinks.length} (${journeyLinks.filter((l) => l.status === "active").length} active)`);

const { data: claims } = await service.from("guardian_claim_invitations").select("id, reference, guardian_id, status");
const journeyClaims = (claims ?? []).filter((c) => journeyGuardianIds.has(c.guardian_id));
console.log(`journey_claims: ${journeyClaims.length} (${journeyClaims.filter((c) => c.status === "pending").length} pending)`);

const { data: contacts } = await service.from("guardian_contacts").select("id, guardian_id");
const journeyContacts = (contacts ?? []).filter((c) => journeyGuardianIds.has(c.guardian_id));
console.log(`journey_contacts: ${journeyContacts.length}`);

const { data: people } = await service.from("people").select("id");
const journeyPeople = (people ?? []).filter((p) => journeyPersonIds.has(p.id));
console.log(`journey_people: ${journeyPeople.length}`);
console.log("");

/* 4. All claim invitations by status (any guardian). */
const claimStatus = {};
for (const claim of claims ?? []) claimStatus[claim.status] = (claimStatus[claim.status] ?? 0) + 1;
console.log(`all_claims_by_status: ${JSON.stringify(claimStatus)}`);

/* 5. Teaching/import/export residue. */
for (const [table, label] of [
  ["teaching_assignments", "teaching_assignments"],
  ["data_import_batches", "import_batches"],
  ["data_export_requests", "export_requests"],
]) {
  const { count, error } = await service.from(table).select("id", { count: "exact", head: true });
  console.log(`${label}: ${error ? `error: ${error.message}` : count}`);
}

console.log("\nNOTE: This inventory is the input for the containment manifest.");
console.log("No rows were modified. Cleanup requires a separate explicit confirmation");
console.log("naming these exact IDs.");
