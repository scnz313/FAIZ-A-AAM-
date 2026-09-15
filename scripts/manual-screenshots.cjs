const { chromium } = require("playwright");

/** Manual visual inspection: take high-quality screenshots of every guardian
 *  page so I can actually LOOK at them and find visual/UX issues. */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  // Sign in as Guardian
  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Guardian/i }).click();
  await page.waitForURL(/\/portal/, { timeout: 15000 });
  await page.waitForTimeout(3000);

  // Screenshot every guardian page at full quality
  const pages = [
    { path: "/portal", name: "01-overview" },
    { path: "/portal/fees", name: "02-fees" },
    { path: "/portal/fees/INV-2026-F55369", name: "03-invoice-detail" },
    { path: "/portal/timetable", name: "04-timetable" },
    { path: "/portal/results", name: "05-results" },
    { path: "/portal/documents", name: "06-documents" },
    { path: "/portal/notices", name: "07-notices" },
    { path: "/portal/profile", name: "08-profile" },
    { path: "/portal/security", name: "09-security" },
    { path: "/portal/support", name: "10-support" },
    { path: "/portal/link-child", name: "11-link-child" },
  ];

  for (const p of pages) {
    await page.goto(`http://localhost:3000${p.path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `/tmp/manual-${p.name}.png`, fullPage: true });
    console.log(`✓ ${p.name}`);
  }

  // Also capture mobile versions of key pages
  await page.setViewportSize({ width: 390, height: 844 });
  for (const p of ["01-overview", "02-fees", "04-timetable"]) {
    const path = pages.find(x => x.name === p).path;
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `/tmp/manual-mobile-${p}.png`, fullPage: true });
    console.log(`✓ mobile-${p}`);
  }

  await browser.close();
  console.log("\nAll screenshots ready in /tmp/manual-*.png");
})();
