#!/usr/bin/env node
/**
 * Accessibility gate for the retained frontend routes.
 *
 *   NODE_PATH=/tmp/fass-shots/node_modules node scripts/accessibility-check.cjs
 *
 * Uses axe-core against the production server. The UI demo intentionally has
 * no authentication boundary yet, so protected demo shells are included.
 */
const path = require("node:path");

function loadModule(name) {
  try {
    return require(name);
  } catch {
    const candidates = [];
    if (process.env.NODE_PATH) candidates.push(...process.env.NODE_PATH.split(path.delimiter).filter(Boolean));
    candidates.push("/tmp/fass-shots/node_modules");
    for (const directory of candidates) {
      try {
        return require(require.resolve(name, { paths: [directory] }));
      } catch {
        /* Try the next QA install. */
      }
    }
    return null;
  }
}

const playwright = loadModule("playwright");
const axePath = (() => {
  try {
    return require.resolve("axe-core/axe.min.js");
  } catch {
    return null;
  }
})();

if (!playwright || !axePath) {
  console.error("FAIL accessibility — playwright and axe-core are required.");
  process.exit(1);
}

const BASE = process.argv[2] ?? "http://localhost:3000";
const ROUTES = [
  "/",
  "/about",
  "/academics",
  "/admissions",
  "/admissions/apply",
  "/school-life",
  "/notices",
  "/notices/winter-air-quality-advisory",
  "/disclosure",
  "/careers",
  "/careers/mathematics-teacher",
  "/contact",
  "/policies/privacy",
  "/policies/accessibility",
  "/policies/fees-and-refunds",
  "/policies/terms",
  "/apply/student",
  "/apply/job/mathematics-teacher",
  "/portal",
  "/portal/documents",
  "/portal/fees",
  "/portal/fees/INV-2026-0103",
  "/portal/receipts/RC-2026-0102",
  "/portal/results",
  "/portal/timetable",
  "/portal/notices",
  "/portal/profile",
  "/portal/security",
  "/portal/support",
  "/administrator",
  "/principal/admissions",
  "/principal/admissions/APP-2026-0417",
  "/principal/careers",
  "/principal/careers/JOB-2026-0112",
  "/principal/finance",
  "/principal/finance/invoices",
  "/principal/finance/payments",
  "/principal/finance/reconciliation",
  "/principal/results",
  "/principal/timetables",
  "/principal/notices",
  "/principal/content",
  "/administrator/users",
  "/administrator/audit",
  "/administrator/settings",
  "/principal/support",
  "/administrator/link-requests",
  "/sign-in",
  "/sign-in/invite",
  "/sign-in/verify",
  "/sign-in/recovery",
  "/session-expired",
  "/access-denied",
];

(async () => {
  const browser = await playwright.chromium.launch();
  const failures = [];
  try {
    for (const route of ROUTES) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const response = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
        if (!response || response.status() !== 200) {
          failures.push(`${route}: HTTP ${response?.status() ?? "no response"}`);
          continue;
        }
        await page.addScriptTag({ path: axePath });
        const result = await page.evaluate(async () => window.axe.run(document, {
          runOnly: ["wcag2a", "wcag2aa", "best-practice"],
        }));
        for (const violation of result.violations) {
          const targets = violation.nodes.map((node) => node.target.join(" ")).join("; ");
          failures.push(`${route}: ${violation.id} — ${violation.help} (${violation.nodes.length} nodes) [${targets}]`);
        }
      } catch (error) {
        failures.push(`${route}: ${String(error).slice(0, 220)}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`Routes scanned: ${ROUTES.length}`);
  if (failures.length === 0) {
    console.log("NO ACCESSIBILITY VIOLATIONS ✓");
    process.exit(0);
  }
  console.log("--- Violations ---");
  console.log(failures.join("\n"));
  process.exit(1);
})();
