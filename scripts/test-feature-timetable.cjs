const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const issues = [];
  const log = (m) => console.log(m);
  const issue = (m) => { issues.push(m); console.log("  ISSUE: " + m); };

  log("=== FEATURE 2: GUARDIAN TIMETABLE ===");

  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Guardian/i }).click();
  await page.waitForURL(/\/portal/, { timeout: 15000 });
  await page.goto("http://localhost:3000/portal/timetable", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  log("1. URL:", page.url());

  // Check page structure
  const pageinfo = await page.evaluate(() => {
    const h1 = document.querySelector("h1")?.textContent;
    const text = document.body.innerText;
    const hasDay = text.includes("Day") || text.includes("day");
    const hasWeek = text.includes("Week") || text.includes("week");
    const hasExam = text.includes("Exam") || text.includes("exam");
    const tables = document.querySelectorAll("table");
    const tabs = [...document.querySelectorAll(".seg button, .seg a, .v14-tabs button, [role=tab]")].map(t => ({
      text: t.textContent.trim().slice(0, 30),
      active: t.classList.contains("on"),
    }));
    const periods = text.match(/\d(?=[\s:])/g)?.length;
    const subjects = text.match(/Math|English|Science|Urdu|Kashmiri|Islamic|Social|Computer|Games|Library|Club|Lunch|Assessment/gi)?.slice(0, 10);
    return { title: h1, hasDay, hasWeek, hasExam, tableCount: tables.length, tabs, periods, subjects };
  });
  log("2. Page:", JSON.stringify({ title: pageinfo.title, tables: pageinfo.tableCount, tabs: pageinfo.tabs.map(t => t.text).join("/") }));
  log("   Subjects found:", pageinfo.subjects?.join(", ") || "none");

  // Check table content
  if (pageinfo.tableCount > 0) {
    const tableData = await page.evaluate(() => {
      const table = document.querySelector("table");
      const headers = [...table.querySelectorAll("th")].map(h => h.textContent.trim());
      const rows = [...table.querySelectorAll("tbody tr")].map(r =>
        [...r.querySelectorAll("td")].map(c => c.textContent.trim().slice(0, 25))
      );
      return { headers, rowCount: rows.length, rows: rows.slice(0, 5) };
    });
    log("3. Table headers:", tableData.headers.join(" | "));
    log("   Row count:", tableData.rowCount);
    tableData.rows.forEach((r, i) => log(`   Row ${i + 1}: ${r.join(" | ")}`));
    if (tableData.rowCount === 0) issue("Timetable table has 0 rows");
  } else {
    issue("No timetable table rendered");
  }

  // Test view switching (day/week/exam tabs)
  log("4. View switching:");
  const viewTabs = await page.evaluate(() =>
    [...document.querySelectorAll(".seg a, .seg button, .v14-tabs button")].map(t => ({
      text: t.textContent.trim(),
      tag: t.tagName.toLowerCase(),
    }))
  );
  for (const tab of viewTabs) {
    try {
      if (tab.tag === "a") {
        await page.locator(`.seg a, .v14-tabs button`).filter({ hasText: tab.text }).first().click();
      } else {
        await page.locator(`.seg button, .v14-tabs button`).filter({ hasText: tab.text }).first().click();
      }
      await page.waitForTimeout(1500);
      const rowCount = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
      const gridCells = await page.evaluate(() => document.querySelectorAll("table td:not(:empty)").length);
      log(`   "${tab.text}" view: ${rowCount} rows, ${gridCells} filled cells`);
      if (rowCount === 0 && gridCells === 0) issue(`"${tab.text}" view shows no data`);
    } catch (err) {
      issue(`"${tab.text}" tab not clickable: ${err.message?.slice(0, 60)}`);
    }
  }

  // Go back to default view
  await page.goto("http://localhost:3000/portal/timetable", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Check for override/change indicators
  const overrides = await page.evaluate(() => {
    const text = document.body.innerText;
    const hasOverride = text.includes("override") || text.includes("Override") || text.includes("change") || text.includes("substitute");
    const hasNotice = text.includes("notice") || text.includes("Notice");
    return { hasOverride, hasNotice };
  });
  log("5. Override indicators:", JSON.stringify(overrides));

  // Responsive check
  log("6. Responsive (390px):");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3000/portal/timetable", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const mobile = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    tableFits: (() => { const w = document.querySelector(".table-wrap"); return w ? w.scrollWidth <= w.clientWidth + 1 : true })(),
  }));
  log(`   Overflow: ${mobile.overflow}px`);
  if (mobile.overflow > 1) issue(`Timetable overflows ${mobile.overflow}px at 390px`);
  await page.screenshot({ path: "/tmp/feature-timetable-mobile.png", fullPage: true });

  // Desktop screenshot
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://localhost:3000/portal/timetable", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/feature-timetable.png", fullPage: true });

  await browser.close();
  log(`\n=== RESULT: ${issues.length === 0 ? "FEATURE WORKING" : issues.length + " ISSUES"} ===`);
  issues.forEach((i, n) => console.log(`  ${n + 1}. ${i}`));
})();
