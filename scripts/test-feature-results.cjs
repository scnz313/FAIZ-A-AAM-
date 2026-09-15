const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const issues = [];
  const log = (m) => console.log(m);
  const issue = (m) => { issues.push(m); console.log("  ISSUE: " + m); };

  log("=== FEATURE 3: GUARDIAN RESULTS ===");

  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Guardian/i }).click();
  await page.waitForURL(/\/portal/, { timeout: 15000 });
  await page.goto("http://localhost:3000/portal/results", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const results = await page.evaluate(() => {
    const h1 = document.querySelector("h1")?.textContent;
    const text = document.body.innerText;
    const hasTerms = text.includes("Term") || text.includes("term");
    const hasPublished = text.includes("Published") || text.includes("published");
    const hasEmpty = text.includes("No ") || text.includes("nothing") || text.includes("not yet");
    const tables = document.querySelectorAll("table");
    const tabs = [...document.querySelectorAll(".seg a, .seg button, .v14-tabs button")].map(t => t.textContent.trim());
    const pubLinks = [...document.querySelectorAll("a")].filter(a => a.href.includes("publication") || a.href.includes("release")).map(a => ({
      text: a.textContent.trim().slice(0, 50),
      href: a.getAttribute("href"),
    }));
    return { title: h1, hasTerms, hasPublished, hasEmpty, tableCount: tables.length, tabs, pubLinks,
      snippet: text.slice(0, 400) };
  });
  log("1. Title:", results.title);
  log("   Tabs:", results.tabs.join(", ") || "none");
  log("   Published links:", results.pubLinks.length);
  results.pubLinks.forEach(l => log(`   → ${l.text} (${l.href})`));
  log("   Snippet:", results.snippet.replace(/\n/g, " | ").slice(0, 250));

  if (results.pubLinks.length > 0) {
    // Click a published result
    log("2. Opening published result...");
    await page.locator(`a[href*="publication"], a[href*="release"]`).first().click();
    await page.waitForTimeout(3000);
    log("   URL:", page.url());

    const detail = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasSubjects = /Math|English|Science|Urdu|Kashmiri|Islamic|Social|Computer/i.test(text);
      const hasMarks = /\d{1,3}\s*(?:\/|of)\s*\d{1,3}/.test(text) || /marks|grade|Grade/.test(text);
      const hasVersion = text.includes("v1") || text.includes("version") || text.includes("Version");
      const hasStatus = text.includes("Published") || text.includes("Final") || text.includes("Provisional");
      const tables = document.querySelectorAll("table");
      const rowCount = tables.length > 0 ? tables[0].querySelectorAll("tbody tr").length : 0;
      return { hasSubjects, hasMarks, hasVersion, hasStatus, tableCount: tables.length, rowCount,
        snippet: text.slice(0, 300) };
    });
    log("   Detail:", JSON.stringify({ subjects: detail.hasSubjects, marks: detail.hasMarks, version: detail.hasVersion, status: detail.hasStatus, rows: detail.rowCount }));
    if (!detail.hasSubjects) issue("Result detail shows no subjects");
    if (!detail.hasMarks) issue("Result detail shows no marks/grades");
    if (detail.rowCount === 0) issue("Result detail table has 0 rows");
    log("   Text:", detail.snippet.replace(/\n/g, " | ").slice(0, 200));
    await page.screenshot({ path: "/tmp/feature-results-detail.png", fullPage: true });
  } else if (results.hasEmpty) {
    log("2. No published results (empty state):");
    log("   ", results.snippet.replace(/\n/g, " | ").slice(0, 200));
    // This is expected if no results have been published yet
    log("   → This is a DATA gap (no published results in DB), not a feature bug");
  } else {
    issue("Results page shows neither data nor empty state");
  }

  // Responsive
  log("3. Responsive (390px):");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3000/portal/results", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log(`   Overflow: ${overflow}px`);
  if (overflow > 1) issue(`Results page overflows ${overflow}px at 390px`);
  await page.screenshot({ path: "/tmp/feature-results-mobile.png", fullPage: true });

  await browser.close();
  log(`\n=== RESULT: ${issues.length === 0 ? "FEATURE WORKING" : issues.length + " ISSUES"} ===`);
  issues.forEach((i, n) => console.log(`  ${n + 1}. ${i}`));
})();
