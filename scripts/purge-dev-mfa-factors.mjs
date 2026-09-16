#!/usr/bin/env node
/**
 * Purge "Dev auto-elevation" TOTP factors from every user on the LINKED
 * staging project.
 *
 * WHEN TO RUN: exactly once, after the hosted demo has served its purpose and
 * BEFORE `FASS_DEMO_NO_TOTP` is removed from the Vercel environment. While the
 * flag is set, every staff sign-in creates a disposable verified TOTP factor
 * whose secret is never shown. If the flag were removed with those factors
 * still present, staff would be asked for a code nobody knows and locked out.
 * Running this script leaves real "Staff access" factors untouched; users
 * with no remaining factor simply enrol a fresh authenticator on next sign-in.
 *
 * Safety: refuses to run unless .env.local points at the approved staging
 * project ref AND FASS_STAGING_CONFIRMED=true. Defaults to a dry run; pass
 * --apply to delete. No factor secrets or keys are printed — counts only.
 *
 * Usage:
 *   FASS_STAGING_CONFIRMED=true node scripts/purge-dev-mfa-factors.mjs            # dry run
 *   FASS_STAGING_CONFIRMED=true node scripts/purge-dev-mfa-factors.mjs --apply    # delete
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DEV_FACTOR_NAME = "Dev auto-elevation";
const apply = process.argv.includes("--apply");

/* --- env parsing (no dotenv dependency) --------------------------------- */

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

/* Hard target guard: this script deletes auth factors on a remote project. */
const PROJECT_REF = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) ?? [])[1];
const APPROVED_STAGING_REF = "jxegiamjcawdywqyutdz";
if (PROJECT_REF !== APPROVED_STAGING_REF || env.FASS_STAGING_CONFIRMED !== "true") {
  console.error(
    `Refusing to run: this script modifies MFA factors on a remote project.\n` +
      `Expected project ${APPROVED_STAGING_REF} with FASS_STAGING_CONFIRMED=true ` +
      `(got ${PROJECT_REF ?? "unknown"}, FASS_STAGING_CONFIRMED=${env.FASS_STAGING_CONFIRMED ?? "unset"}).`,
  );
  process.exit(1);
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const adminAuth = admin.auth.admin;

/* --- run ----------------------------------------------------------------- */

console.log(`${apply ? "Purging" : "Dry run — would purge"} "${DEV_FACTOR_NAME}" factors on project ${PROJECT_REF}`);
if (!apply) console.log("Pass --apply to delete.");

let users = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await adminAuth.listUsers({ page, perPage: 200 });
  if (error) {
    console.error(`Could not list users: ${error.message}`);
    process.exit(1);
  }
  users = users.concat(data.users);
  if (data.users.length < 200) break;
}

let affectedUsers = 0;
let removed = 0;
let failures = 0;

for (const user of users) {
  const { data, error } = await adminAuth._listFactors({ userId: user.id });
  if (error) {
    failures += 1;
    console.error(`  ✗ list factors for ${user.id}: ${error.message}`);
    continue;
  }
  const devFactors = (data?.factors ?? []).filter((f) => f.friendly_name === DEV_FACTOR_NAME);
  if (devFactors.length === 0) continue;
  affectedUsers += 1;
  for (const factor of devFactors) {
    if (!apply) {
      removed += 1;
      continue;
    }
    const { error: deleteError } = await adminAuth._deleteFactor({ userId: user.id, id: factor.id });
    if (deleteError) {
      failures += 1;
      console.error(`  ✗ delete factor ${factor.id} for ${user.id}: ${deleteError.message}`);
    } else {
      removed += 1;
    }
  }
}

console.log(`\nUsers scanned: ${users.length}`);
console.log(`Users with dev factors: ${affectedUsers}`);
console.log(`${apply ? "Deleted" : "Would delete"}: ${removed} factor(s)`);
if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
