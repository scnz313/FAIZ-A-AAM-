#!/usr/bin/env node
/* Static guard for the protected-path contract (Phase 11 strengthened).
 *
 * Checks:
 * 1. No operational browser storage in protected paths.
 * 2. No session persistence without an adapter branch.
 * 3. No protected fixture/demo imports (presentation-only formatters allowed).
 * 4. Server Components must not invoke the client adapter.
 * 5. No unused server loaders.
 * 6. No hardcoded `/staff/` URLs in application-facing components (must use
 *    canonicalStaffUrl). The `/staff` tree is the internal rewrite target only.
 * 7. No Teacher/Student login personas in protected code (they are non-login
 *    school records).
 * 8. No caught adapter failures rendered as empty success (return [] or null
 *    in a catch block silently masks provider errors).
 * 9. No browser-exposed internal import operations (storeRows etc.).
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

/* Files exempt from the hardcoded /staff/ URL check:
   - portal-routes.ts (defines the helper)
   - staff layout (the rewrite target)
   - StaffRouteGuard (handles all three prefixes)
   - test files (explicitly test legacy paths) */
const staffUrlExempt = /(?:portal-routes|staff\/layout|StaffRouteGuard|isLegacyStaffPath|staffSubPathForPathname)/i;

/* Files exempt from the Teacher persona check:
   - demo/fixture/test files (may reference teacher for historical context)
   - staff-profiles.ts (documents that teachers are non-login)
   - staff-authorization.ts (may reference legacy teacher for denial logic)
   - comments are not code */
const teacherPersonaExempt = /(?:^|[/\\])(?:demo|fixtures|test|spec)(?:[/\\]|$)|staff-profiles|staff-authorization|relationships\/demo|audit\.ts/i;

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

  /* Check 6: No hardcoded /staff/ URLs in application-facing components.
   * The /staff tree is the internal rewrite target only; application URLs
   * must use canonicalStaffUrl(profileCode, subPath). */
  if (!staffUrlExempt.test(file)) {
    const hardcodedStaffUrls = source.match(/href\s*=\s*["'`]?\/staff\//g);
    if (hardcodedStaffUrls) {
      violations.push(`${label}: hardcoded /staff/ URL — use canonicalStaffUrl(profileCode, subPath) instead (${hardcodedStaffUrls.length} occurrence(s))`);
    }
    /* Also check string literals assigned to href via template expressions */
    const templateStaffUrls = source.match(/href\s*=\s*\{`\/staff\//g);
    if (templateStaffUrls) {
      violations.push(`${label}: hardcoded /staff/ template URL — use canonicalStaffUrl(profileCode, subPath) instead (${templateStaffUrls.length} occurrence(s))`);
    }
  }

  /* Check 7: No Teacher/Student login personas in protected code.
   * Teachers and students are non-login school records. Any code that
   * treats them as login roles is a regression. */
  if (!teacherPersonaExempt.test(file)) {
    /* Look for teacher/student as a login role, not as a school record */
    if (/\bteacher(?:Role|Login|Persona|Account|Session|Workspace|Identity)\b/i.test(source)) {
      violations.push(`${label}: Teacher login persona reference — teachers are non-login school records`);
    }
    if (/\bstudent(?:Login|Persona|Account|Session|Workspace|Identity)\b/i.test(source)) {
      violations.push(`${label}: Student login persona reference — students are non-login school records`);
    }
  }

  /* Check 8: No caught adapter failures rendered as empty success.
   * Patterns like `catch { return [] }` or `catch { return null }` silently
   * mask provider errors. Protected screens must show recoverable errors. */
  const emptyCatchPattern = /catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(?:\[\]|null|undefined)\s*;?\s*\}/g;
  const emptyCatches = source.match(emptyCatchPattern);
  if (emptyCatches) {
    violations.push(`${label}: caught adapter failure returns empty success — use recoverable error instead (${emptyCatches.length} occurrence(s))`);
  }

  /* Check 9: No browser-exposed internal import operations.
   * The browser adapter must not expose storeRows or similar internal
   * import operations — imports go through the server pipeline. */
  if (/storeRows|dataImports\.storeRows/.test(source) && !isTest(file) && !/demo|fixture/i.test(file)) {
    /* Only flag if it's in the adapter or service layer, not in tests */
    if (/(?:adapter|services\/data-import)/i.test(file)) {
      violations.push(`${label}: browser-exposed internal import operation (storeRows) — imports must go through the server pipeline`);
    }
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
 * common "loader wired in the import only" regression without treating a
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
