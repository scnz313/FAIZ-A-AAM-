const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const issues = [];
  const log = (m) => console.log(m);
  const issue = (m) => { issues.push(m); console.log("  ISSUE: " + m); };

  // Sign in as Guardian
  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Guardian/i }).click();
  await page.waitForURL(/\/portal/, { timeout: 15000 });

  // FEATURE 4: DOCUMENTS
  log("=== FEATURE 4: GUARDIAN DOCUMENTS ===");
  await page.goto("http://localhost:3000/portal/documents", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const docs = await page.evaluate(() => {
    const h1 = document.querySelector("h1")?.textContent;
    const tables = document.querySelectorAll("table");
    const rows = tables.length > 0 ? [...tables[0].querySelectorAll("tbody tr")] : [];
    const text = document.body.innerText;
    const docRows = rows.map(r => ({
      cells: [...r.querySelectorAll("td")].map(c => c.textContent.trim().slice(0, 40)),
      hasPreview: !!r.querySelector("button"),
    }));
    const hasStates = /Ready|Processing|Scanning|Quarantined|Missing/i.test(text);
    return { title: h1, rowCount: rows.length, docRows, hasStates, snippet: text.slice(0, 300) };
  });
  log("1. Title:", docs.title);
  log("   Rows:", docs.rowCount);
  docs.docRows.forEach((r, i) => log(`   Row ${i + 1}: ${r.cells.join(" | ")} (preview: ${r.hasPreview})`));
  if (docs.rowCount === 0) log("   → No documents (empty state — data gap)");
  if (!docs.hasStates && docs.rowCount > 0) issue("Document states not shown");

  // Try clicking Preview on first document with a preview button
  if (docs.docRows.some(d => d.hasPreview)) {
    log("2. Testing preview...");
    const previewBtn = page.locator("table button").filter({ hasText: /preview|view/i }).first();
    if (await previewBtn.count() > 0) {
      await previewBtn.click();
      await page.waitForTimeout(2000);
      const dialog = await page.evaluate(() => ({
        hasDialog: !!document.querySelector("dialog[open], [role=dialog]"),
        title: document.querySelector("dialog h2, [role=dialog] h2")?.textContent,
      }));
      log("   Dialog:", JSON.stringify(dialog));
      if (!dialog.hasDialog) issue("Preview dialog does not open");
      // Close it
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
  }

  // FEATURE 5: NOTICES
  log("\n=== FEATURE 5: GUARDIAN NOTICES ===");
  await page.goto("http://localhost:3000/portal/notices", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const notices = await page.evaluate(() => {
    const h1 = document.querySelector("h1")?.textContent;
    const text = document.body.innerText;
    const panels = document.querySelectorAll(".panel");
    const expandable = document.querySelectorAll("[aria-expanded], details, .notice-item, [class*=expand]");
    const noticeTitles = [...document.querySelectorAll("h2, h3, strong")].map(h => h.textContent.trim().slice(0, 60)).filter(t => t.length > 10);
    const hasNotices = noticeTitles.length > 0 || text.includes("notice");
    return { title: h1, panelCount: panels.length, expandableCount: expandable.length,
      noticeTitles: noticeTitles.slice(0, 5), hasNotices, snippet: text.slice(0, 300) };
  });
  log("1. Title:", notices.title);
  log("   Panels:", notices.panelCount);
  log("   Expandable:", notices.expandableCount);
  log("   Notice titles:", notices.noticeTitles.join(" | ") || "none");
  log("   Snippet:", notices.snippet.replace(/\n/g, " | ").slice(0, 200));

  if (notices.expandableCount > 0) {
    // Try expanding a notice
    log("2. Expanding notice...");
    const expandBtn = page.locator("[aria-expanded]").first();
    if (await expandBtn.count() > 0) {
      const isExpanded = await expandBtn.getAttribute("aria-expanded");
      await expandBtn.click();
      await page.waitForTimeout(1000);
      const afterExpand = await page.evaluate(() => {
        const expanded = document.querySelector("[aria-expanded=true]");
        const body = expanded?.closest(".panel, [class*=notice]")?.querySelector("p, div");
        return { expanded: !!expanded, bodyText: body?.textContent?.trim().slice(0, 100) };
      });
      log(`   Before: expanded=${isExpanded}, After: expanded=${afterExpand.expanded}`);
      log(`   Body: ${afterExpand.bodyText || "none"}`);
      if (!afterExpand.expanded) issue("Notice does not expand on click");
    }
  } else if (!notices.hasNotices) {
    log("   → No notices (empty state)");
  }

  // Responsive check for both
  log("\n3. Responsive (390px):");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3000/portal/documents", { waitUntil: "networkidle" });
  const docsOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto("http://localhost:3000/portal/notices", { waitUntil: "networkidle" });
  const noticesOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log(`   Documents: ${docsOverflow}px, Notices: ${noticesOverflow}px`);
  if (docsOverflow > 1) issue(`Documents overflows ${docsOverflow}px`);
  if (noticesOverflow > 1) issue(`Notices overflows ${noticesOverflow}px`);

  await browser.close();
  log(`\n=== RESULT: ${issues.length === 0 ? "BOTH FEATURES WORKING" : issues.length + " ISSUES"} ===`);
  issues.forEach((i, n) => console.log(`  ${n + 1}. ${i}`));
})();
