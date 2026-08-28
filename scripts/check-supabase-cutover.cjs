#!/usr/bin/env node
/* Static guard for the C2.5 protected-path contract.
 *
 * This is intentionally conservative: demo-only modules and tests are valid
 * places for fixtures/session storage, while protected route/components must
 * prove their adapter branch and keep private data on the server boundary.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "apps", "web");
const protectedRoots = [
  path.join(root, "app", "portal"),
  path.join(root, "app", "staff"),
  path.join(root, "components", "portal"),
  path.join(root, "components", "staff"),
];
const violations = [];

function filesUnder(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(target));
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) result.push(target);
  }
  return result;
}

function relative(file) { return path.relative(process.cwd(), file); }
function isTest(file) { return /(?:^|[./])(?:test|tests|spec)(?:[./]|$)|\.(?:test|spec)\.[^.]+$/.test(file); }
function isDemoOnly(file, source) {
  return isTest(file)
    || /(?:^|[/\\])(?:demo|fixtures)(?:[/\\]|\.[^.]+$)/i.test(file)
    || /@(?:demo-only|fixture-only)|cutover:\s*demo-only/i.test(source);
}

function hasAdapterBranch(source) {
  return /\b(?:clientAdapterMode|dataAdapter)\s*\(\s*\)/.test(source)
    || /FASS_DATA_ADAPTER|NEXT_PUBLIC_FASS_DATA_ADAPTER/.test(source);
}

function scanProtected(file) {
  const source = fs.readFileSync(file, "utf8");
  if (isDemoOnly(file, source)) return;
  const label = relative(file);

  if (/\b(?:sessionStorage|localStorage)\b/.test(source)) {
    violations.push(`${label}: operational browser storage in a protected path`);
  }
  if (/\b(?:sessionGet|sessionSet|sessionRemove)\s*\(/.test(source) && !hasAdapterBranch(source)) {
    violations.push(`${label}: session persistence without an adapter branch`);
  }

  /* A protected component can import presentation-only demo formatters/notes,
   * but importing fixture records is an operational fallback. Type imports are
   * contracts, not data sources, and are therefore explicitly allowed. */
  const importPattern = /import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const isType = Boolean(match[1]);
    const clause = match[2] ?? "";
    const specifier = match[3] ?? "";
    if (isType || !/(?:\/demo(?:$|\/)|\/fixtures?(?:$|\/))/.test(specifier)) continue;
    const presentationOnly = clause
      .split(",")
      .map((part) => part.replace(/[{}]/g, "").trim())
      .filter(Boolean)
      .every((name) => /^(?:type\s+)?(?:format[A-Z]|[A-Z0-9_]+_DEMO_NOTE|INVOICE_STATUS_META|STATUS_TONE|demoTodayLabel)$/.test(name));
    if (!presentationOnly) violations.push(`${label}: protected fixture/demo import (${specifier})`);
  }
}

for (const dir of protectedRoots) for (const file of filesUnder(dir)) scanProtected(file);

/* Server Components must use server-loaders/serverAdapterCall. A direct client
 * adapter import would lose the incoming Auth cookie and silently turn a
 * protected render into an unauthenticated relative fetch. */
for (const file of filesUnder(path.join(root, "app"))) {
  const source = fs.readFileSync(file, "utf8");
  if (isDemoOnly(file, source) || /^\s*["']use client["']/.test(source)) continue;
  if (/from\s+["'][^"']*adapter-client["']|\badapterCall\s*\(/.test(source)) {
    violations.push(`${relative(file)}: Server Component invokes the client adapter`);
  }
}

/* Detect an imported server loader that is never invoked. This catches the
 * common “loader wired in the import only” regression without treating a
 * deliberately exported loader as an error before a route consumes it. */
const appSources = filesUnder(path.join(root, "app"))
  .filter((file) => !isDemoOnly(file, fs.readFileSync(file, "utf8")))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
for (const file of filesUnder(path.join(root, "lib", "supabase"))) {
  if (!file.endsWith("server-loaders.ts")) continue;
  const source = fs.readFileSync(file, "utf8");
  const exports = [...source.matchAll(/export\s+async\s+function\s+(loadServer\w+)/g)].map((match) => match[1]);
  for (const loader of exports) {
    const occurrences = appSources.match(new RegExp(`\\b${loader}\\b`, "g")) ?? [];
    if (occurrences.length === 0) violations.push(`${relative(file)}: unused server loader ${loader}`);
  }
}

if (violations.length > 0) {
  console.error("Supabase protected-path cutover guard failed:");
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}
console.log("Supabase protected-path cutover guard passed.");
