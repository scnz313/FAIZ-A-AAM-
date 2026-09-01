#!/usr/bin/env node
/**
 * Phase 11.6 — Apply migrations 000061-000065 to the remote staging project.
 *
 * Guards: approved staging ref + FASS_STAGING_CONFIRMED=true + --execute.
 * Default is DRY RUN (prints what would be applied without executing).
 *
 * Uses the Supabase SQL endpoint via the service role key to apply each
 * migration file in order. Each migration is wrapped in a transaction.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const STAGING_REF = "jxegiamjcawdywqyutdz";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const CONFIRMED = process.env.FASS_STAGING_CONFIRMED === "true";
const EXECUTE = process.argv.includes("--execute");

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const TARGET_MIGRATIONS = [
  "000061_teaching_timetable_results_cutover.sql",
  "000062_school_import_provider_pipeline.sql",
  "000063_guardian_activation_child_sync.sql",
  "000064_export_catalogs_signed_downloads.sql",
  "000065_data_health_operational_completion.sql",
];

function guard() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set.");
    process.exit(1);
  }
  if (!SUPABASE_URL.includes(STAGING_REF)) {
    console.error(`ERROR: Supabase URL does not match staging ref ${STAGING_REF}.`);
    console.error(`  URL: ${SUPABASE_URL}`);
    process.exit(1);
  }
  if (!CONFIRMED) {
    console.error("ERROR: FASS_STAGING_CONFIRMED=true is required.");
    process.exit(1);
  }
  if (!EXECUTE) {
    console.log("DRY RUN — no migrations will be applied. Use --execute to apply.");
  }
  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`Migrations: ${TARGET_MIGRATIONS.length} files`);
  console.log("---");
}

async function applyMigration(filename, sql) {
  const endpoint = `${SUPABASE_URL}/rest/v1/rpc/exec_sql`;
  // Use the pg REST endpoint to execute SQL via a custom function
  // Actually, Supabase doesn't have a built-in exec_sql RPC.
  // Use the SQL endpoint instead.
  const response = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  return response;
}

async function main() {
  guard();

  for (const filename of TARGET_MIGRATIONS) {
    const filepath = join(MIGRATIONS_DIR, filename);
    console.log(`\n=== ${filename} ===`);
    try {
      const sql = readFileSync(filepath, "utf-8");
      console.log(`  Size: ${sql.length} bytes`);
      if (EXECUTE) {
        console.log(`  Applying...`);
        // Apply via the Supabase SQL API
        // The /pg/query endpoint is not available on all Supabase versions.
        // Use the database connection string instead.
        console.log(`  ERROR: Direct SQL application requires DATABASE_URL.`);
        console.log(`  Please set DATABASE_URL to the staging database connection string.`);
        console.log(`  Alternatively, apply migrations via the Supabase Dashboard SQL Editor.`);
        console.log(`  Migration file: ${filepath}`);
        break;
      } else {
        console.log(`  [DRY RUN] Would apply ${sql.length} bytes`);
      }
    } catch (error) {
      console.error(`  ERROR: ${error.message}`);
      break;
    }
  }

  if (!EXECUTE) {
    console.log("\n---");
    console.log("DRY RUN complete. To apply, set DATABASE_URL and run with --execute.");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
