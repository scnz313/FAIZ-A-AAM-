/**
 * Link crawl: fetch every route, extract internal hrefs, and report
 * any href that does not resolve to a 200. Run with:
 *   node scripts/link-crawl.mjs <base-url>
 * Exits 1 when any route fails or any HTTP dead link exists; mailto:/tel:
 * links are intentionally skipped (validated separately).
 */
const base = process.argv[2] ?? "http://localhost:3000";

const routes = [
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
  "/careers/english-teacher",
  "/careers/laboratory-assistant",
  "/careers/unknown-vacancy",
  "/contact",
  "/policies/privacy",
  "/policies/accessibility",
  "/policies/fees-and-refunds",
  "/policies/terms",
  "/apply/student",
  "/apply/student/APP-2026-0417",
  "/apply/student/APP-2026-0417/status",
  "/apply/student/APP-2026-0999",
  "/apply/job/mathematics-teacher",
  "/apply/job/JOB-2026-0112/status",
  "/apply/job/JOB-2026-0999/status",
  "/portal",
  "/portal/fees",
  "/portal/fees/INV-2026-0101",
  "/portal/fees/INV-2026-0103",
  "/portal/fees/INV-9999",
  "/portal/receipts/RC-2026-0102",
  "/portal/receipts/RC-9999",
  "/portal/results",
  "/portal/results/PUB-2026-002",
  "/portal/results/PUB-9999",
  "/portal/timetable",
  "/portal/notices",
  "/portal/documents",
  "/portal/profile",
  "/portal/security",
  "/portal/support",
  "/staff",
  "/staff/admissions",
  "/staff/admissions/APP-2026-0417",
  "/staff/admissions/APP-9999",
  "/staff/careers",
  "/staff/careers/JOB-2026-0112",
  "/staff/careers/JOB-9999",
  "/staff/finance",
  "/staff/finance/invoices",
  "/staff/finance/payments",
  "/staff/finance/reconciliation",
  "/staff/results",
  "/staff/results/RB-2026-0142",
  "/staff/results/RB-9999",
  "/staff/timetables",
  "/staff/notices",
  "/staff/content",
  "/staff/users",
  "/staff/audit",
  "/staff/settings",
  "/staff/support",
  "/staff/link-requests",
  "/sign-in/invite",
  "/ui-states",
];

const seen = new Set();
const failures = [];
const hrefs = new Set();

for (const route of routes) {
  try {
    const res = await fetch(base + route);
    if (res.status !== 200) failures.push(`${route} → ${res.status}`);
    const html = await res.text();
    seen.add(route);
    for (const match of html.matchAll(/href="([^"#]+)"/g)) {
      const href = match[1];
      if (href.startsWith("http")) continue;
      hrefs.add(href);
    }
  } catch (error) {
    failures.push(`${route} → FETCH ERROR ${error.message}`);
  }
}

console.log(`Routes checked: ${seen.size}`);
console.log(`Unique internal hrefs found: ${hrefs.size}`);

const dead = [];
for (const href of [...hrefs].sort()) {
  /* Non-HTTP protocols are validated separately (or intentionally excluded). */
  if (href.startsWith("mailto:") || href.startsWith("tel:")) continue;
  try {
    const res = await fetch(base + href, { redirect: "follow" });
    if (res.status !== 200) dead.push(`${href} → ${res.status}`);
  } catch (error) {
    dead.push(`${href} → FETCH ERROR`);
  }
}

console.log("--- Dead links ---");
console.log(dead.length === 0 ? "none" : dead.join("\n"));
console.log("--- Route failures ---");
console.log(failures.length === 0 ? "none" : failures.join("\n"));

/* Fail loudly when any route or dead link is broken. */
if (failures.length > 0 || dead.length > 0) {
  process.exit(1);
}
