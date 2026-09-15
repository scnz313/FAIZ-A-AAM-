const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const issues = [];
  const log = (m) => console.log(m);
  const issue = (m) => { issues.push(m); console.log("  ISSUE: " + m); };

  log("=== FEATURE 1: GUARDIAN FEES (detailed) ===");

  // Sign in
  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Guardian/i }).click();
  await page.waitForURL(/\/portal/, { timeout: 15000 });
  await page.goto("http://localhost:3000/portal/fees", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  // 1. Table data
  const table = await page.evaluate(() => {
    const t = document.querySelector("table");
    if (!t) return { hasTable: false };
    const rows = [...t.querySelectorAll("tbody tr")];
    return {
      hasTable: true,
      headers: [...t.querySelectorAll("th")].map(h => h.textContent.trim()),
      rowCount: rows.length,
      rows: rows.map(r => ({
        cells: [...r.querySelectorAll("td")].map(c => c.textContent.trim().slice(0, 30)),
        hasReceipt: !!r.querySelector("a"),
      })),
    };
  });
  log("1. Table:", table.hasTable ? `${table.rowCount} rows` : "NO TABLE");
  if (table.rows) table.rows.forEach((r, i) => log(`   Row ${i + 1}: ${r.cells.join(" | ")}`));
  if (!table.hasTable) issue("No fee table rendered");

  // 2. Filter tabs (they are <a> links)
  log("2. Filter tabs:");
  const filters = await page.evaluate(() =>
    [...document.querySelectorAll(".seg a, .seg button")].map(a => ({
      text: a.textContent.trim(),
      href: a.getAttribute("href"),
      active: a.classList.contains("on"),
    }))
  );
  filters.forEach(f => log(`   ${f.text} (${f.active ? "active" : "inactive"}) → ${f.href}`));
  if (filters.length === 0) issue("No filter tabs found");

  // 3. Test Unpaid filter (URL navigation)
  if (filters.some(f => f.text === "Unpaid")) {
    await page.goto("http://localhost:3000/portal/fees?status=unpaid", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const unpaidRows = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
    log(`3. Unpaid filter: ${unpaidRows} rows`);
    // Go back to all
    await page.goto("http://localhost:3000/portal/fees", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
  }

  // 4. Test Paid filter
  if (filters.some(f => f.text === "Paid")) {
    await page.goto("http://localhost:3000/portal/fees?status=paid", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const paidRows = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
    const paidText = await page.evaluate(() => [...document.querySelectorAll("table tbody tr")].map(r => r.textContent.trim().slice(0, 100)));
    log(`4. Paid filter: ${paidRows} rows`);
    paidText.forEach(t => log(`   ${t}`));
    if (paidRows === 0 && table.rowCount > 0) issue("Paid filter shows 0 rows but table has data");
    await page.goto("http://localhost:3000/portal/fees", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
  }

  // 5. Click Receipt link
  log("5. Receipt link:");
  const receiptLink = page.locator("table a").filter({ hasText: /Receipt/i }).first();
  if (await receiptLink.count() > 0) {
    await receiptLink.click();
    await page.waitForTimeout(3000);
    log(`   URL: ${page.url()}`);
    const receipt = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        title: document.querySelector("h1")?.textContent,
        hasAmount: /₹/.test(text),
        hasRef: /RCP-|RC-|receipt/i.test(text),
        hasPrint: text.includes("Print"),
        snippet: text.slice(0, 400),
      };
    });
    log(`   Title: ${receipt.title}`);
    log(`   Has amount: ${receipt.hasAmount}, Has ref: ${receipt.hasRef}, Has print: ${receipt.hasPrint}`);
    if (!receipt.hasAmount) issue("Receipt page shows no ₹ amount");
    if (!receipt.hasRef) issue("Receipt page shows no reference number");
    log(`   Text: ${receipt.snippet.replace(/\n/g, " | ").slice(0, 250)}`);
    await page.screenshot({ path: "/tmp/feature-fees-receipt.png", fullPage: true });
  } else {
    log("   No Receipt link found (all invoices may be unpaid)");
  }

  // Go back to fees
  await page.goto("http://localhost:3000/portal/fees", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // 6. Fee summary section
  log("6. Fee summary:");
  const summary = await page.evaluate(() => {
    const pnHeads = [...document.querySelectorAll(".pn-head h2")].map(h => h.textContent.trim());
    const text = document.body.innerText;
    const balance = text.match(/[Cc]urrent balance[^|]*?₹[\d,]+/)?.[0];
    const nextDue = text.match(/[Nn]ext due[^|]*?(?:₹|INV-|No)/)?.[0];
    const concessions = text.match(/[Cc]oncession[^\n]*/)?.[0];
    return { panelTitles: pnHeads, balance, nextDue, concessions };
  });
  log(`   Panels: ${summary.panelTitles.join(", ")}`);
  log(`   Balance: ${summary.balance || "not found"}`);
  log(`   Next due: ${summary.nextDue || "not found"}`);
  if (!summary.balance && !summary.nextDue) {
    // Check if there's a summary section at all
    const hasSummaryPanel = summary.panelTitles.some(t => /fee|balance|summary/i.test(t));
    if (!hasSummaryPanel) issue("No fee summary/balance panel visible");
  }

  // 7. Statement download
  log("7. Statement:");
  const stmtBtn = page.getByRole("button", { name: /statement/i }).first();
  if (await stmtBtn.count() > 0) {
    await stmtBtn.click();
    await page.waitForTimeout(1500);
    const hasPreview = await page.locator("#statement-preview").count();
    log(`   Preview opens: ${hasPreview > 0}`);
    if (hasPreview === 0) issue("Statement preview does not open");
    const closeBtn = page.getByRole("button", { name: /close preview/i });
    if (await closeBtn.count() > 0) await closeBtn.click();
  } else {
    log("   No statement button found");
  }

  // 8. Responsive (390px)
  log("8. Responsive (390px):");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3000/portal/fees", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const mobile = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    const tableWrap = document.querySelector(".table-wrap");
    const tableFits = tableWrap ? tableWrap.scrollWidth <= tableWrap.clientWidth + 1 : true;
    return { overflow, tableFits };
  });
  log(`   Overflow: ${mobile.overflow}px, Table fits: ${mobile.tableFits}`);
  if (mobile.overflow > 1) issue(`Fees page overflows ${mobile.overflow}px at 390px`);
  await page.screenshot({ path: "/tmp/feature-fees-mobile.png", fullPage: true });

  await browser.close();
  log(`\n=== RESULT: ${issues.length === 0 ? "FEATURE WORKING" : issues.length + " ISSUES"} ===`);
  issues.forEach((i, n) => console.log(`  ${n + 1}. ${i}`));
})();
