const { chromium } = require("playwright");

/** Manual interaction testing: actually USE every form, button, and control
 *  like a real guardian would, and capture the results. */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const issues = [];
  const log = (m) => console.log(m);
  const issue = (m) => { issues.push(m); console.log("  ISSUE: " + m); };

  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Guardian/i }).click();
  await page.waitForURL(/\/portal/, { timeout: 15000 });
  await page.waitForTimeout(3000);

  // ===== TEST 1: Fee filter interaction =====
  log("\n=== TEST 1: Fee filters (clicking each) ===");
  await page.goto("http://localhost:3000/portal/fees", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Click "Paid" filter
  await page.locator(".seg a").filter({ hasText: /^Paid$/ }).click();
  await page.waitForTimeout(2000);
  const paidResult = await page.evaluate(() => {
    const rows = document.querySelectorAll("table tbody tr");
    const activeTab = document.querySelector(".seg a.on");
    return { activeTab: activeTab?.textContent, rowCount: rows.length };
  });
  log(`  Click "Paid": active=${paidResult.activeTab}, rows=${paidResult.rowCount}`);

  // Click "Unpaid" filter
  await page.locator(".seg a").filter({ hasText: /^Unpaid$/ }).click();
  await page.waitForTimeout(2000);
  const unpaidResult = await page.evaluate(() => {
    const rows = document.querySelectorAll("table tbody tr");
    const activeTab = document.querySelector(".seg a.on");
    const emptyMsg = document.querySelector("[class*=empty], .muted");
    return { activeTab: activeTab?.textContent, rowCount: rows.length, emptyMsg: emptyMsg?.textContent?.slice(0, 80) };
  });
  log(`  Click "Unpaid": active=${unpaidResult.activeTab}, rows=${unpaidResult.rowCount}`);
  if (unpaidResult.rowCount === 0 && !unpaidResult.emptyMsg) {
    issue("Unpaid filter shows 0 rows but no empty-state message");
  }

  // Back to All
  await page.locator(".seg a").filter({ hasText: "All" }).click();
  await page.waitForTimeout(2000);

  // ===== TEST 2: Statement preview visual =====
  log("\n=== TEST 2: Statement preview ===");
  const stmtBtn = page.locator("button").filter({ hasText: /statement/i }).first();
  if (await stmtBtn.count() > 0) {
    await stmtBtn.click();
    await page.waitForTimeout(2000);
    const stmt = await page.evaluate(() => {
      const preview = document.querySelector("#statement-preview");
      if (!preview) return { opens: false };
      const text = preview.innerText;
      const hasSchool = text.includes("Faiz Aam");
      const hasChild = text.includes("mshzzlab") || text.includes("Integration");
      const hasAmount = /₹/.test(text);
      const hasTable = preview.querySelectorAll("table").length;
      return { opens: true, hasSchool, hasChild, hasAmount, hasTable, snippet: text.slice(0, 200) };
    });
    log(`  Opens: ${stmt.opens}`);
    if (stmt.opens) {
      log(`  School name: ${stmt.hasSchool}, Child: ${stmt.hasChild}, Amount: ${stmt.hasAmount}, Table: ${stmt.hasTable}`);
      log(`  Content: ${stmt.snippet?.replace(/\n/g, " | ").slice(0, 150)}`);
      if (!stmt.hasSchool) issue("Statement preview missing school name");
      if (!stmt.hasAmount) issue("Statement preview missing ₹ amounts");
    } else {
      issue("Statement preview does not open");
    }
    await page.screenshot({ path: "/tmp/manual-statement-preview.png" });
    // Close
    const closeBtn = page.locator("button").filter({ hasText: /close/i }).first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    await page.waitForTimeout(500);
  }

  // ===== TEST 3: Timetable view switching =====
  log("\n=== TEST 3: Timetable views ===");
  await page.goto("http://localhost:3000/portal/timetable", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Check what view tabs exist and switch between them
  const viewTabs = await page.evaluate(() =>
    [...document.querySelectorAll(".seg button, .seg a")].map(t => ({ text: t.textContent.trim(), tag: t.tagName.toLowerCase() }))
  );
  log(`  View tabs: ${viewTabs.map(t => t.text).join(", ")}`);

  for (const tab of viewTabs) {
    if (tab.text === "Exam date sheet") {
      // Skip exam date sheet — we know it's empty (data gap)
      continue;
    }
    const locator = tab.tag === "button"
      ? page.locator(".seg button").filter({ hasText: new RegExp(`^${tab.text}$`) })
      : page.locator(".seg a").filter({ hasText: new RegExp(`^${tab.text}$`) });
    const count = await locator.count();
    if (count === 0) continue;
    await locator.first().click();
    await page.waitForTimeout(1500);
    const viewData = await page.evaluate(() => {
      const table = document.querySelector("table");
      const rows = table ? table.querySelectorAll("tbody tr").length : 0;
      const headers = table ? [...table.querySelectorAll("th")].map(h => h.textContent.trim()).slice(0, 5) : [];
      const hasContent = table ? table.innerText.length > 50 : false;
      return { rows, headers, hasContent };
    });
    log(`  "${tab.text}" view: rows=${viewData.rows}, headers=${viewData.headers.join("|")}, content=${viewData.hasContent}`);
    if (!viewData.hasContent && tab.text !== "Exam date sheet") {
      issue(`"${tab.text}" view shows no content`);
    }
  }

  // ===== TEST 4: Child switcher =====
  log("\n=== TEST 4: Child switcher ===");
  await page.goto("http://localhost:3000/portal", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const childBtn = page.locator("button").filter({ hasText: /Your children/i });
  if (await childBtn.count() > 0) {
    await childBtn.click();
    await page.waitForTimeout(1000);
    const menu = await page.evaluate(() => {
      const items = document.querySelectorAll('[role="menuitem"]');
      return [...items].map(i => i.textContent.trim().slice(0, 60));
    });
    log(`  Children in menu: ${menu.join(" | ")}`);
    // Switch to the other child (click the one that's not active)
    const nonActiveChild = page.locator('[role="menuitem"]').filter({ hasText: /msi00dms/i });
    if (await nonActiveChild.count() > 0) {
      await nonActiveChild.click();
      await page.waitForTimeout(3000);
      const newContext = await page.evaluate(() => document.body.innerText.slice(0, 500));
      const switched = newContext.includes("msi00dms");
      log(`  Switched to msi00dms: ${switched}`);
      // Switch back
      await childBtn.click();
      await page.waitForTimeout(500);
      const backChild = page.locator('[role="menuitem"]').filter({ hasText: /mshzzlab/i });
      if (await backChild.count() > 0) {
        await backChild.click();
        await page.waitForTimeout(2000);
        log("  Switched back to mshzzlab");
      }
    }
  }

  // ===== TEST 5: Support form (fill and check validation) =====
  log("\n=== TEST 5: Support form ===");
  await page.goto("http://localhost:3000/portal/support", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  const supportForm = await page.evaluate(() => {
    const form = document.querySelector("form");
    if (!form) return { hasForm: false };
    const textareas = form.querySelectorAll("textarea");
    const selects = form.querySelectorAll("select");
    const submitBtn = [...form.querySelectorAll("button")].find(b => /submit|send|create/i.test(b.textContent));
    return { hasForm: true, textareas: textareas.length, selects: selects.length, hasSubmit: !!submitBtn };
  });
  log(`  Form present: ${supportForm.hasForm}`);
  if (supportForm.hasForm) {
    log(`  Textareas: ${supportForm.textareas}, Selects: ${supportForm.selects}, Submit: ${supportForm.hasSubmit}`);

    // Try submitting empty form to check validation
    const submitBtn = page.locator("form button").filter({ hasText: /submit|send|create/i }).first();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      await page.waitForTimeout(1500);
      const validation = await page.evaluate(() => {
        const errors = document.querySelectorAll("[class*=error], [class*=invalid], [role=alert]");
        const errorText = [...errors].map(e => e.textContent.trim().slice(0, 60)).filter(Boolean);
        return { errorCount: errors.length, errorText };
      });
      log(`  Empty submit validation: ${validation.errorCount} errors`);
      if (validation.errorText.length) log(`  Messages: ${validation.errorText.join(" | ")}`);
      if (validation.errorCount === 0) issue("Support form submits without validation errors on empty input");

      // Fill the form properly
      const textarea = page.locator("form textarea").first();
      if (await textarea.count() > 0) {
        await textarea.fill("I need help understanding the fee statement for this term. Could the office explain the concession applied?");
        const select = page.locator("form select").first();
        if (await select.count() > 0) {
          const options = await select.locator("option").allTextContents();
          log(`  Topic options: ${options.join(", ")}`);
          if (options.length > 1) await select.selectOption({ index: 1 });
        }
        await submitBtn.click();
        await page.waitForTimeout(3000);
        const afterSubmit = await page.evaluate(() => {
          const text = document.body.innerText;
          const success = text.includes("sent") || text.includes("created") || text.includes("reference") || text.includes("SUB-");
          return { success, snippet: text.slice(0, 300) };
        });
        log(`  After submit: success=${afterSubmit.success}`);
        log(`  Text: ${afterSubmit.snippet.replace(/\n/g, " | ").slice(0, 200)}`);
        if (!afterSubmit.success) issue("Support form submit does not show success confirmation");
        await page.screenshot({ path: "/tmp/manual-support-submitted.png" });
      }
    }
  }

  // ===== TEST 6: Link child form =====
  log("\n=== TEST 6: Link child form ===");
  await page.goto("http://localhost:3000/portal/link-child", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const linkForm = await page.evaluate(() => {
    const form = document.querySelector("form");
    const inputs = form ? form.querySelectorAll("input") : [];
    return { hasForm: !!form, inputCount: inputs.length,
      inputLabels: [...inputs].map(i => i.labels?.[0]?.textContent?.slice(0, 30) || i.placeholder?.slice(0, 30)) };
  });
  log(`  Form: ${linkForm.hasForm}, Inputs: ${linkForm.inputCount}`);
  log(`  Labels: ${linkForm.inputLabels.join(", ")}`);
  if (!linkForm.hasForm) issue("Link child form not rendered");

  await browser.close();
  log(`\n=== MANUAL INTERACTION ISSUES: ${issues.length} ===`);
  issues.forEach((i, n) => console.log(`  ${n + 1}. ${i}`));
})();
