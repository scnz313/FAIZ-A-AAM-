#!/usr/bin/env node
/**
 * Complete local feature journeys — the permanent local-only feature gate
 * (plan: L1.0). Every retained feature is exercised end-to-end in demo mode
 * against a running local server:
 *
 *   node scripts/local-feature-journeys/index.cjs [base-url]
 *
 * Journey modules cover: public site, identity, guardian/student linking,
 * admissions (applicant + staff), careers (applicant + staff), finance
 * (portal + staff), results + timetable, content/documents/support, and
 * admin + facility. Each module opens its own browser page with isolated
 * session state and captures console/page errors; the runner exits 1 when
 * any check fails or any module throws.
 *
 * Nothing in this suite contacts Supabase, providers, or the network beyond
 * the local server under test.
 */

const { loadPlaywright } = require("./helpers.cjs");

const MODULES = [
  ["public-site", require("./feature-public.cjs")],
  ["identity", require("./feature-identity.cjs")],
  ["linking", require("./feature-linking.cjs")],
  ["admissions", require("./feature-admissions.cjs")],
  ["careers", require("./feature-careers.cjs")],
  ["finance", require("./feature-finance.cjs")],
  ["results-timetable", require("./feature-results-timetable.cjs")],
  ["content-documents-support", require("./feature-content-documents-support.cjs")],
  ["admin-facility", require("./feature-admin-facility.cjs")],
];

(async () => {
  const base = process.argv[2] ?? "http://127.0.0.1:3002";
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const total = { pass: 0, fail: 0 };
  const moduleFailures = [];

  for (const [name, module] of MODULES) {
    try {
      const result = await module.run(browser, base);
      for (const check of result.checks) {
        if (check.ok) total.pass += 1;
        else {
          total.fail += 1;
          moduleFailures.push(`[${name}] ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
        }
        console.log(`${check.ok ? "PASS" : "FAIL"} [${name}] ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
      }
      for (const error of result.consoleErrors ?? []) {
        total.fail += 1;
        moduleFailures.push(`[${name}] ${error}`);
        console.log(`FAIL [${name}] ${error}`);
      }
      if (result.consoleErrors?.length === 0) console.log(`PASS [${name}] no console errors`);
    } catch (error) {
      total.fail += 1;
      moduleFailures.push(`[${name}] module error: ${String(error.message).slice(0, 200)}`);
      console.log(`FAIL [${name}] module error — ${String(error.message).slice(0, 200)}`);
    }
  }

  await browser.close();
  console.log(`\nLocal feature journeys: ${total.pass} passed, ${total.fail} failed.`);
  if (total.fail > 0) {
    console.log("\nFailures:\n" + moduleFailures.join("\n"));
    process.exit(1);
  }
  console.log("ALL LOCAL FEATURES PASSED");
})();
