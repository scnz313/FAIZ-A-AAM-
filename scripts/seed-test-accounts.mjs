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

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* --- test accounts ------------------------------------------------------ */

/** Shared password for every test account (staff sign-in requires 8+ chars). */
const PASSWORD = "FaizAam-Test-2026";

/** One account per staff role (packages/contracts/src/relationships.ts). */
const ACCOUNTS = [
  ["content_editor", "Content", "Editor", "Test content editor"],
  ["content_publisher", "Cara", "Publisher", "Test content publisher"],
  ["admissions_officer", "Aam", "Officer", "Test admissions officer"],
  ["admissions_approver", "Aam", "Approver", "Test admissions approver"],
  ["finance_officer", "Faisal", "Officer", "Test finance officer"],
  ["finance_approver", "Faisal", "Approver", "Test finance approver"],
  ["teacher", "Tariq", "Teacher", "Test teacher"],
  ["exam_reviewer", "Eshaal", "Reviewer", "Test exam reviewer"],
  ["result_publisher", "Rashid", "Publisher", "Test result publisher"],
  ["timetable_manager", "Tahir", "Manager", "Test timetable manager"],
  ["hr_reviewer", "Hina", "Reviewer", "Test HR reviewer"],
  ["hr_approver", "Haroon", "Approver", "Test HR approver"],
  ["support_officer", "Sana", "Officer", "Test support officer"],
  ["auditor", "Ayesha", "Auditor", "Test auditor"],
  ["system_administrator", "Sami", "Admin", "Test system administrator"],
];

function emailFor(role) {
  return `test.${role}@faizaam.example`;
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

for (const [role, givenName, familyName, title] of ACCOUNTS) {
  const email = emailFor(role);
  const displayName = `${givenName} ${familyName}`;
  const label = `${role.padEnd(22)} ${email}`;

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

    // 4. Role grant (active, effective now).
    const { error: grantError } = await admin.from("role_grants").insert({
      account_id: authUser.id,
      role_code: role,
      status: "active",
      effective_from: new Date().toISOString(),
      reason: "Fictional test account (synthetic seed)",
    });
    if (grantError) throw grantError;

    // 5. Staff member (so the account is a directory-listed staff identity).
    const { error: memberError } = await admin
      .from("staff_members")
      .insert({ person_id: person.id, employment_status: "active", title });
    if (memberError) throw memberError;

    console.log(`  ✓ ${label}  (created)`);
    created += 1;
  } catch (error) {
    console.error(`  ✗ ${label}  ${error.message}`);
    failures.push({ role, email, message: error.message });
  }
}

console.log(`\nDone: ${created} created, ${skipped} already existed, ${failures.length} failed.`);
console.log(`\nTest staff sign-in — ${PASSWORD}`);
console.log("  /sign-in/staff  ·  first login enrolls TOTP (plan.md §4)\n");

if (failures.length > 0) process.exitCode = 1;
