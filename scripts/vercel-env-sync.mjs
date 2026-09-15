#!/usr/bin/env node
/**
 * FASS -> Vercel environment sync.
 *
 * Reads the required runtime names from `.env.local` and, on request, upserts
 * them into the linked Vercel project for the Preview and Production
 * environments with `vercel env add`.
 *
 * Safety contract:
 * - Dry-run by default. `--execute` is required before anything is written.
 * - Refuses to run when the repository is not linked to a Vercel project.
 * - Refuses to run when a required name is missing or empty in `.env.local`.
 * - Never prints a value. Values travel to the Vercel CLI over stdin, never as
 *   command-line arguments, and any captured CLI output is redacted before it
 *   is shown.
 * - `APP_URL` must be the deployed URL. When `.env.local` still holds a
 *   localhost value, `--execute` refuses unless `--app-url <url>` (an explicit
 *   override used for both targets) or `--allow-local-app-url` is supplied.
 *
 * Usage:
 *   node scripts/vercel-env-sync.mjs                        # dry-run report
 *   node scripts/vercel-env-sync.mjs --execute              # upsert Preview+Production
 *   node scripts/vercel-env-sync.mjs --execute --app-url https://fass.vercel.app
 *   node scripts/vercel-env-sync.mjs --execute --allow-local-app-url
 *
 * The dashboard remains the source of truth; this script only automates the
 * first pass. Rotate or correct a value in the Vercel dashboard instead of
 * re-running it when only one variable has changed.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const envFileUrl = new URL("../.env.local", import.meta.url);
const projectLinkUrl = new URL("../.vercel/project.json", import.meta.url);
const repoLinkUrl = new URL("../.vercel/repo.json", import.meta.url);

const TARGETS = "preview,production";
const LOCAL_APP_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i;

/**
 * The required Vercel runtime inventory. Order matches the deployment
 * checklist; `sensitive` marks server-only secrets that must be unreadable
 * after creation. `fallback` documents a safe value used when `.env.local`
 * does not set the name (for example the default adapter or scanner mode).
 */
const VARIABLES = [
  { name: "NEXT_PUBLIC_SUPABASE_URL" },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" },
  { name: "SUPABASE_SECRET_KEY", sensitive: true },
  { name: "APP_URL" },
  { name: "CRON_SECRET", sensitive: true },
  { name: "RESEND_API_KEY", sensitive: true },
  { name: "EMAIL_FROM" },
  { name: "RESEND_WEBHOOK_SECRET", sensitive: true },
  { name: "DOCUMENT_SCANNER_PROVIDER", fallback: "manual" },
  { name: "DOCUMENT_SCANNER_SECRET", sensitive: true },
  { name: "FASS_DATA_ADAPTER", fallback: "supabase" },
  { name: "NEXT_PUBLIC_FASS_DATA_ADAPTER", fallback: "supabase" },
];

/* --- flags --------------------------------------------------------------- */

const argv = process.argv.slice(2);

function flagValue(name) {
  const withEquals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (withEquals) return withEquals.slice(name.length + 1).trim();
  const index = argv.indexOf(name);
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith("--")) return argv[index + 1].trim();
  return null;
}

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`Usage: node scripts/vercel-env-sync.mjs [--execute] [--app-url <url>] [--allow-local-app-url]

  (default)               dry-run report; no Vercel changes
  --execute               upsert every required name for Preview and Production
  --app-url <url>         override APP_URL for both targets (deployed URL)
  --allow-local-app-url   permit a localhost APP_URL (not for client demos)
`);
  process.exit(0);
}

const execute = argv.includes("--execute");
const allowLocalAppUrl = argv.includes("--allow-local-app-url");
const appUrlOverride = flagValue("--app-url");

/* --- preconditions (linked project) -------------------------------------- */

const linked = existsSync(projectLinkUrl) || existsSync(repoLinkUrl);
if (!linked) {
  console.error(
    "Refusing to run: this repository is not linked to a Vercel project.\n" +
      "Run `vercel link --yes --project fass` first (or `vercel link --repo` for a\n" +
      "multi-project repository link), then re-run this script.",
  );
  process.exit(1);
}

let linkedName = "linked project";
try {
  const link = JSON.parse(readFileSync(projectLinkUrl, "utf8"));
  if (typeof link.projectName === "string" && link.projectName) linkedName = link.projectName;
} catch {
  /* `vercel link --repo` stores only .vercel/repo.json; the CLI resolves the rest. */
}

/* --- preconditions (.env.local values) ----------------------------------- */

if (!existsSync(envFileUrl)) {
  console.error("Refusing to run: .env.local was not found at the repository root.");
  process.exit(1);
}

const env = {};
for (const line of readFileSync(envFileUrl, "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (!match || match[2].startsWith("#")) continue;
  env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
}

const resolved = [];
const missing = [];
for (const variable of VARIABLES) {
  let value = (env[variable.name] ?? "").trim();
  let source = ".env.local";
  if (!value && variable.fallback) {
    value = variable.fallback;
    source = `default (${variable.fallback})`;
  }
  if (variable.name === "APP_URL" && appUrlOverride) {
    value = appUrlOverride;
    source = "--app-url override";
  }
  if (!value) missing.push(variable.name);
  else resolved.push({ ...variable, value, source });
}

if (missing.length > 0) {
  console.error(
    `Refusing to run: .env.local is missing required values for: ${missing.join(", ")}.\n` +
      "Add them to .env.local (never committed) and re-run.",
  );
  process.exit(1);
}

const appUrlEntry = resolved.find((variable) => variable.name === "APP_URL");
const appUrlIsLocal = appUrlEntry ? LOCAL_APP_URL.test(appUrlEntry.value) : false;

if (appUrlIsLocal && execute && !allowLocalAppUrl) {
  console.error(
    "Refusing to run: APP_URL resolves to a local address, but Vercel must use the\n" +
      "deployed URL (confirmation and email links use it).\n" +
      "Re-run with `--app-url https://<deployed-url>` or, for a throwaway check only,\n" +
      "`--allow-local-app-url`.",
  );
  process.exit(1);
}

/* --- report -------------------------------------------------------------- */

const width = Math.max(...resolved.map((variable) => variable.name.length));
console.log(`FASS Vercel env sync — ${execute ? "EXECUTE" : "DRY RUN"} (values are never printed)`);
console.log(`  project:  ${linkedName}`);
console.log(`  source:   .env.local`);
console.log(`  targets:  preview, production`);
if (appUrlOverride) console.log(`  APP_URL:  overridden for both targets`);
if (appUrlIsLocal) console.log(`  warning:  APP_URL is a local address; set the deployed URL before a demo`);
console.log("");
for (const variable of resolved) {
  console.log(
    `  ${variable.name.padEnd(width)}  ${(variable.sensitive ? "sensitive" : "config").padEnd(9)}  ${variable.source}`,
  );
}

if (!execute) {
  console.log("\nCommands that --execute would run:");
  for (const variable of resolved) {
    const sensitive = variable.sensitive ? " --sensitive" : "";
    console.log(`  vercel env add ${variable.name} ${TARGETS} --force${sensitive}  < ${variable.source}`);
  }
  console.log("\nNothing was written. Re-run with --execute to upsert these values.");
  process.exit(0);
}

/* --- execute ------------------------------------------------------------- */

function redact(text, value) {
  return value ? text.split(value).join("[REDACTED]") : text;
}

console.log("\nUpserting Preview + Production ...");
const failures = [];
for (const [index, variable] of resolved.entries()) {
  const cliArgs = ["env", "add", variable.name, TARGETS, "--force", "--yes"];
  if (variable.sensitive) cliArgs.push("--sensitive");
  const result = spawnSync("vercel", cliArgs, {
    cwd: repoRoot,
    input: `${variable.value}\n`,
    encoding: "utf8",
    env: process.env,
  });
  const label = `[${index + 1}/${resolved.length}] ${variable.name}`;
  if (result.error || result.status !== 0) {
    const detail = redact(`${result.stdout ?? ""}${result.stderr ?? ""}`, variable.value).trim().split("\n").slice(-3).join(" | ");
    failures.push(variable.name);
    console.error(`  ${label}  FAILED${detail ? ` — ${detail}` : result.error ? ` — ${result.error.message}` : ""}`);
  } else {
    console.log(`  ${label}  preview+production set (${variable.sensitive ? "sensitive" : "config"})`);
  }
}

if (failures.length > 0) {
  console.error(
    `\nDone with failures: ${failures.length}/${resolved.length} variables failed (${failures.join(", ")}).\n` +
      "Fix the cause and re-run; successful variables are overwritten idempotently.",
  );
  process.exit(1);
}
console.log(
  `\nDone: ${resolved.length}/${resolved.length} variables set for preview,production.\n` +
    "Sensitive values cannot be read back; correct mistakes in the Vercel dashboard.",
);
