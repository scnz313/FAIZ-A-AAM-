#!/usr/bin/env node
/**
 * Create one simple test account for every staff role in the linked Supabase
 * project (plan.md §11 / C5 staging). Mirrors the account-creation chain used
 * by scripts/auth-browser-staging.mjs:
 *
 *   auth.users  ->  people  ->  user_accounts  ->  role_grants  ->  staff_members
 *
 * Idempotent: accounts are keyed by a deterministic email
 * (`test.<role>@faizaam.example`), so re-runs skip accounts that already exist
 * instead of creating duplicates. Synthetic data only — never real people.
 *
 * Usage: node scripts/seed-test-accounts.mjs
 *
 * After this runs, each account can sign in at /sign-in/staff with the printed
 * email and the shared password. First sign-in still enrolls TOTP (plan.md §4),
 * so the first login per account is the enrollment step.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/* --- env parsing (no dotenv dependency) -------------------------------- */

const envRaw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !match[2].startsWith("#")) env[match[1]] = match[2].trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

/* Hard target guard: this script mutates a remote project. It must point at
   the approved staging ref and the operator must have confirmed staging. */
const PROJECT_REF = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) ?? [])[1];
const APPROVED_STAGING_REF = "jxegiamjcawdywqyutdz";
if (PROJECT_REF !== APPROVED_STAGING_REF || env.FASS_STAGING_CONFIRMED !== "true") {
  console.error(
    `Refusing to run: this script changes remote accounts.\n` +
      `Expected project ${APPROVED_STAGING_REF} with FASS_STAGING_CONFIRMED=true ` +
      `(got ${PROJECT_REF ?? "unknown"}, FASS_STAGING_CONFIRMED=${env.FASS_STAGING_CONFIRMED ?? "unset"}).`,
  );
  process.exit(1);
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* --- test accounts ------------------------------------------------------ */

/** Shared password for every test account (staff sign-in requires 8+ chars).
 * There is NO committed fallback: the operator must supply
 * TEST_ACCOUNT_PASSWORD (min 16 chars, not a known/default value). */
const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD || "";
const FORBIDDEN_PASSWORDS = new Set([
  "faizaam-test-2026",
  "password",
  "password1",
  "test1234",
  "faizaam",
]);

if (PASSWORD.length < 16) {
  console.error("TEST_ACCOUNT_PASSWORD must be set and at least 16 characters (no committed fallback).");
  process.exit(1);
}
if (FORBIDDEN_PASSWORDS.has(PASSWORD.toLowerCase())) {
  console.error("TEST_ACCOUNT_PASSWORD matches a known/default value — choose a secret random password.");
  process.exit(1);
}

/**
 * Profile-based synthetic staff accounts (three-portal consolidation): one
 * Administrator and one Principal, each holding the exact profile bundle of
 * role grants. Legacy per-role accounts are DB-only denial fixtures for
 * authorization tests, not portal personas.
 */
const PROFILE_ACCOUNTS = [
  {
    profile: "administrator",
    email: "test.administrator@faizaam.example",
    givenName: "Aam",
    familyName: "Admin",
    title: "Administrator",
    roles: [
      "system_administrator",
      "content_publisher",
      "admissions_approver",
      "finance_approver",
      "hr_approver",
      "exam_reviewer",
      "result_publisher",
      "auditor",
    ],
  },
  {
    profile: "principal",
    email: "test.principal@faizaam.example",
    givenName: "Aam",
    familyName: "Principal",
    title: "Principal",
    roles: [
      "content_editor",
      "admissions_officer",
      "finance_officer",
      "hr_reviewer",
      "result_entry_officer",
      "timetable_manager",
      "support_officer",
    ],
  },
];

function emailFor(profile) {
  return `test.${profile}@faizaam.example`;
}

/* --- helpers ------------------------------------------------------------ */

async function findAuthUserByEmail(email) {
  // Page through auth.users looking for a matching email. The admin listUsers
  // endpoint is paginated; for a small staging project one page is usually
  // enough, but we loop to be safe.
  let page = 1;
  let perPage = 1000;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = (data.users ?? []).find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if ((data.users ?? []).length < perPage) return null;
    page += 1;
  }
}

/* --- run ---------------------------------------------------------------- */

console.log(`Creating test staff accounts in ${url} (synthetic data only)\n`);

let created = 0;
let skipped = 0;
const failures = [];

for (const { profile, givenName, familyName, title, roles } of PROFILE_ACCOUNTS) {
  const email = emailFor(profile);
  const displayName = `${givenName} ${familyName}`;
  const label = `${profile.padEnd(16)} ${email}`;

  try {
    // 1. Auth user — reuse if it already exists.
    let authUser = await findAuthUserByEmail(email);
    if (authUser) {
      // Account already provisioned; ensure the DB chain is complete.
      const { data: existingAccount } = await admin
        .from("user_accounts")
        .select("id, person_id")
        .eq("verified_contact", email)
        .maybeSingle();
      if (existingAccount) {
        console.log(`  ✓ ${label}  (already exists)`);
        skipped += 1;
        continue;
      }
      // Auth user exists but DB chain is missing — fall through and rebuild it
      // using the existing auth user id.
    } else {
      const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (createError) throw createError;
      authUser = createdUser.user;
    }

    // 2. Person.
    const { data: person, error: personError } = await admin
      .from("people")
      .insert({ given_name: givenName, family_name: familyName, display_name: displayName })
      .select("id")
      .single();
    if (personError) throw personError;

    // 3. User account (1:1 with auth.users.id).
    const { error: accountError } = await admin.from("user_accounts").insert({
      id: authUser.id,
      person_id: person.id,
      status: "active",
      verified_contact: email,
    });
    if (accountError) throw accountError;

    // 4. Exact profile role bundle (active, effective now).
    for (const role of roles) {
      const { error: grantError } = await admin.from("role_grants").insert({
        account_id: authUser.id,
        role_code: role,
        status: "active",
        effective_from: new Date().toISOString(),
        reason: `Fictional test account (${profile} profile, synthetic seed)`,
      });
      if (grantError) throw grantError;
    }

    // 5. Staff member with the profile marker (directory-listed identity).
    const { error: memberError } = await admin
      .from("staff_members")
      .insert({
        person_id: person.id,
        employment_status: "active",
        title,
        access_profile_code: profile,
        access_profile_version: 1,
      });
    if (memberError) throw memberError;

    console.log(`  ✓ ${label}  (created)`);
    created += 1;
  } catch (error) {
    console.error(`  ✗ ${label}  ${error.message}`);
    failures.push({ profile, email, message: error.message });
  }
}

console.log(`\nDone: ${created} created, ${skipped} already existed, ${failures.length} failed.`);
console.log("\nTest staff sign-in (Administrator/Principal profiles):");
for (const { profile } of PROFILE_ACCOUNTS) console.log(`  ${emailFor(profile)}`);
console.log("  /sign-in/staff  ·  first login enrolls TOTP (plan.md §4)\n");

if (failures.length > 0) process.exitCode = 1;
