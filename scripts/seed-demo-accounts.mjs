#!/usr/bin/env node
/**
 * Create the short-email demo staff accounts in the linked Supabase project
 * (Phase 11 staging demo preparation, 15 September 2026). Mirrors the
 * account-creation chain used by scripts/seed-test-accounts.mjs:
 *
 *   auth.users  ->  people  ->  user_accounts  ->  role_grants  ->  staff_members
 *
 * Idempotent: accounts are keyed by a deterministic email, so re-runs skip
 * accounts that already exist instead of creating duplicates. Synthetic data
 * only — never real people.
 *
 * Profile bundles are read from `staff_access_profile_roles` at runtime, so
 * the granted roles always match the authoritative database definition.
 *
 * Usage: node scripts/seed-demo-accounts.mjs
 *
 * Guardian note: the companion data agent creates `guardian@test.com`. This
 * script only creates `guardian2@test.com` when that companion guardian
 * already exists (see the guardian section below); otherwise it creates no
 * guardian account at all.
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

/* --- demo accounts ------------------------------------------------------ */

/** Shared demo password. Staging-only synthetic account password; it can be
 * overridden with DEMO_ACCOUNT_PASSWORD but has a working default so the demo
 * is reproducible. Never use these accounts with real data. */
const PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD || "Fass@313";

const DEMO_ACCOUNTS = [
  {
    profile: "administrator",
    email: "admin@test.com",
    displayName: "Demo Administrator",
    givenName: "Demo",
    familyName: "Administrator",
    title: "Administrator",
  },
  {
    profile: "administrator",
    email: "admin2@test.com",
    displayName: "Second Administrator",
    givenName: "Second",
    familyName: "Administrator",
    title: "Administrator",
  },
  {
    profile: "principal",
    email: "principal@test.com",
    displayName: "Demo Principal",
    givenName: "Demo",
    familyName: "Principal",
    title: "Principal",
  },
];

/* --- helpers ------------------------------------------------------------ */

async function findAuthUserByEmail(email) {
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = (data.users ?? []).find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if ((data.users ?? []).length < perPage) return null;
    page += 1;
  }
}

/** Authoritative role bundle for a staff access profile. */
const profileRoleCache = new Map();
async function fetchProfileRoles(profileCode) {
  if (profileRoleCache.has(profileCode)) return profileRoleCache.get(profileCode);
  const { data, error } = await admin
    .from("staff_access_profile_roles")
    .select("role_code, sort_order")
    .eq("profile_code", profileCode)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  const roles = (data ?? []).map((row) => row.role_code);
  if (roles.length === 0) {
    throw new Error(`staff_access_profile_roles has no roles for profile "${profileCode}"`);
  }
  profileRoleCache.set(profileCode, roles);
  return roles;
}

/* --- run ---------------------------------------------------------------- */

console.log(`Creating demo staff accounts in ${url} (synthetic data only)\n`);

let created = 0;
let skipped = 0;
const failures = [];

for (const { profile, email, displayName, givenName, familyName, title } of DEMO_ACCOUNTS) {
  const label = `${profile.padEnd(14)} ${email}`;

  try {
    const roles = await fetchProfileRoles(profile);

    // 1. Auth user — reuse if it already exists.
    let authUser = await findAuthUserByEmail(email);
    if (authUser) {
      const { data: existingAccount } = await admin
        .from("user_accounts")
        .select("id, person_id")
        .eq("verified_contact", email)
        .maybeSingle();
      if (existingAccount) {
        console.log(`  = ${label}  (already exists)`);
        skipped += 1;
        continue;
      }
      // Auth user exists but the DB chain is missing — rebuild it using the
      // existing auth user id.
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
        reason: `Fictional demo account (${profile} profile, synthetic seed)`,
      });
      if (grantError) throw grantError;
    }

    // 5. Staff member with the profile marker (directory-listed identity).
    const { error: memberError } = await admin.from("staff_members").insert({
      person_id: person.id,
      employment_status: "active",
      title,
      access_profile_code: profile,
      access_profile_version: 1,
    });
    if (memberError) throw memberError;

    console.log(`  + ${label}  (created · ${roles.length} role grants)`);
    created += 1;
  } catch (error) {
    console.error(`  x ${label}  ${error.message}`);
    failures.push({ profile, email, message: error.message });
  }
}

/* --- guardian2 (only when the companion guardian already exists) -------- */

const COMPANION_GUARDIAN_EMAIL = "guardian@test.com";
const GUARDIAN2_EMAIL = "guardian2@test.com";

const companion = await findAuthUserByEmail(COMPANION_GUARDIAN_EMAIL);
const { data: companionAccount } = companion
  ? await admin.from("user_accounts").select("id, person_id").eq("verified_contact", COMPANION_GUARDIAN_EMAIL).maybeSingle()
  : { data: null };

if (companionAccount === null) {
  console.log(`\n  = ${GUARDIAN2_EMAIL}  (skipped: companion guardian ${COMPANION_GUARDIAN_EMAIL} not present)`);
} else {
  try {
    let guardian2 = await findAuthUserByEmail(GUARDIAN2_EMAIL);
    const { data: existingAccount } = await admin
      .from("user_accounts")
      .select("id, person_id")
      .eq("verified_contact", GUARDIAN2_EMAIL)
      .maybeSingle();
    if (existingAccount) {
      console.log(`\n  = ${GUARDIAN2_EMAIL}  (already exists)`);
      skipped += 1;
    } else {
      if (guardian2 === null) {
        const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
          email: GUARDIAN2_EMAIL,
          password: PASSWORD,
          email_confirm: true,
        });
        if (createError) throw createError;
        guardian2 = createdUser.user;
      }

      const { data: person, error: personError } = await admin
        .from("people")
        .insert({ given_name: "Second", family_name: "Guardian", display_name: "Second Guardian" })
        .select("id")
        .single();
      if (personError) throw personError;

      const { error: accountError } = await admin.from("user_accounts").insert({
        id: guardian2.id,
        person_id: person.id,
        status: "active",
        verified_contact: GUARDIAN2_EMAIL,
      });
      if (accountError) throw accountError;

      const { error: grantError } = await admin.from("role_grants").insert({
        account_id: guardian2.id,
        role_code: "guardian",
        status: "active",
        effective_from: new Date().toISOString(),
        reason: "Fictional demo account (guardian companion account)",
      });
      if (grantError) throw grantError;

      const { data: guardian, error: guardianError } = await admin
        .from("guardians")
        .insert({ person_id: person.id, status: "active" })
        .select("id")
        .single();
      if (guardianError) throw guardianError;

      // Mirror the companion guardian's approved student links so the new
      // account has the same children available in the portal.
      const { data: companionGuardian } = await admin
        .from("guardians")
        .select("id")
        .eq("person_id", companionAccount.person_id)
        .maybeSingle();
      if (companionGuardian) {
        const { data: links, error: linkReadError } = await admin
          .from("guardian_student_links")
          .select("student_id, relationship_label, verification_source, contact_priority, is_emergency_contact, is_billing_contact")
          .eq("guardian_id", companionGuardian.id)
          .eq("status", "active");
        if (linkReadError) throw linkReadError;
        for (const link of links ?? []) {
          const { error: linkError } = await admin.from("guardian_student_links").insert({
            guardian_id: guardian.id,
            student_id: link.student_id,
            relationship_label: link.relationship_label,
            status: "active",
            verification_source: link.verification_source,
            contact_priority: link.contact_priority,
            is_emergency_contact: link.is_emergency_contact,
            is_billing_contact: link.is_billing_contact,
            effective_from: new Date().toISOString(),
          });
          if (linkError) throw linkError;
        }
      }

      console.log(`\n  + ${GUARDIAN2_EMAIL}  (created from companion guardian)`);
      created += 1;
    }
  } catch (error) {
    console.error(`\n  x ${GUARDIAN2_EMAIL}  ${error.message}`);
    failures.push({ profile: "guardian", email: GUARDIAN2_EMAIL, message: error.message });
  }
}

/* --- summary ------------------------------------------------------------ */

console.log(`\nDone: ${created} created, ${skipped} skipped, ${failures.length} failed.`);
console.log("\nDemo staff sign-in (password: from DEMO_ACCOUNT_PASSWORD / Fass@313):");
for (const { profile, email } of DEMO_ACCOUNTS) {
  const roles = profileRoleCache.get(profile) ?? [];
  console.log(`  ${email.padEnd(22)} profile=${profile.padEnd(14)} roles=${roles.join(",")}`);
}
console.log("  /sign-in/staff\n");

if (failures.length > 0) process.exitCode = 1;
