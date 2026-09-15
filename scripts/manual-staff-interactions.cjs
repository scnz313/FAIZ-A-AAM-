const { chromium } = require("playwright");

/** Manual staff interaction testing: actually USE every staff form and control. */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const issues = [];
  const log = (m) => console.log(m);
  const issue = (m) => { issues.push(m); console.log("  ISSUE: " + m); };

  // Sign in as Administrator
  await page.goto("http://localhost:3000/sign-in/staff", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Administrator/i }).click();
  await page.waitForURL(/\/administrator/, { timeout: 15000 });
  await page.waitForTimeout(3000);

  // ===== TEST 1: Invite staff form (fill it out) =====
  log("\n=== TEST 1: Invite staff form ===");
  await page.goto("http://localhost:3000/administrator/users", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const inviteBtn = page.locator("button").filter({ hasText: /invite/i }).first();
  if (await inviteBtn.count() > 0) {
    const isDisabled = await inviteBtn.isDisabled();
    log(`  Invite button: disabled=${isDisabled}`);
    if (!isDisabled) {
      await inviteBtn.click();
      await page.waitForTimeout(1500);
      const form = await page.evaluate(() => {
        const form = document.querySelector("form[class*=invite]");
        if (!form) return { visible: false };
        const inputs = form.querySelectorAll("input");
        const selects = form.querySelectorAll("select");
        const buttons = form.querySelectorAll("button");
        const profileCards = form.querySelectorAll("[role=radio]");
        return { visible: true, inputs: inputs.length, selects: selects.length,
          buttons: buttons.length, profileCards: profileCards.length,
          inputLabels: [...inputs].map(i => i.labels?.[0]?.textContent?.slice(0, 30) || i.placeholder?.slice(0, 30)) };
      });
      log(`  Form visible: ${form.visible}`);
      if (form.visible) {
        log(`  Inputs: ${form.inputs} (${form.inputLabels.join(", ")})`);
        log(`  Profile cards: ${form.profileCards}`);
        await page.screenshot({ path: "/tmp/manual-invite-form.png" });

        // Try submitting empty
        const submitBtn = page.locator("form[class*=invite] button[type=submit]").first();
        if (await submitBtn.count() > 0) {
          await submitBtn.click();
          await page.waitForTimeout(1500);
          const validation = await page.evaluate(() => {
            const errors = document.querySelectorAll("[class*=error], [class*=invalid], [role=alert]");
            return { count: errors.length, texts: [...errors].map(e => e.textContent.trim().slice(0, 50)).filter(Boolean).slice(0, 5) };
          });
          log(`  Empty submit: ${validation.count} errors — ${validation.texts.join(" | ")}`);
          if (validation.count === 0) issue("Invite form submits without validation on empty input");
        }

        // Fill it properly
        const nameInput = page.locator("form[class*=invite] input").first();
        if (await nameInput.count() > 0) {
          await nameInput.fill("Test Principal Invite");
          const emailInput = page.locator("form[class*=invite] input[type=email], form[class*=invite] input").nth(1);
          if (await emailInput.count() > 0) {
            await emailInput.fill("test.principal.invite@faizaam.example");
          }
          // Select a profile card (Principal)
          const principalCard = page.locator("form[class*=invite] [role=radio]").filter({ hasText: /principal/i }).first();
          if (await principalCard.count() > 0) {
            await principalCard.click();
          }
          // Add reason
          const reasonInput = page.locator("form[class*=invite] textarea, form[class*=invite] input").last();
          if (await reasonInput.count() > 0) {
            await reasonInput.fill("Testing the invitation workflow end to end.");
          }
          await page.screenshot({ path: "/tmp/manual-invite-filled.png" });
          log("  Form filled — NOT submitting (avoid creating real records)");
        }
      }
    } else {
      issue("Invite button is disabled — users.manage role may be missing");
    }
  }

  // ===== TEST 2: Guardian link claim approve/reject =====
  log("\n=== TEST 2: Guardian link claims ===");
  await page.goto("http://localhost:3000/administrator/link-requests", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const claims = await page.evaluate(() => {
    const approveBtns = [...document.querySelectorAll("button")].filter(b => /approve/i.test(b.textContent));
    const rejectBtns = [...document.querySelectorAll("button")].filter(b => /reject/i.test(b.textContent));
    const panels = document.querySelectorAll(".panel");
    const text = document.body.innerText;
    const claimIds = text.match(/CLM-[A-Z0-9-]+/g)?.slice(0, 5);
    const guardianNames = text.match(/(?:Guardian|guardian)[^\n]{5,40}/g)?.slice(0, 3);
    return { approveCount: approveBtns.length, rejectCount: rejectBtns.length,
      panelCount: panels.length, claimIds, guardianNames };
  });
  log(`  Approve buttons: ${claims.approveCount}`);
  log(`  Reject buttons: ${claims.rejectCount}`);
  log(`  Claim IDs: ${claims.claimIds?.join(", ") || "none found"}`);
  if (claims.approveCount === 0) issue("No approve buttons on link requests page");
  if (claims.rejectCount === 0) issue("No reject buttons on link requests page");

  // Look at the claim details
  const claimDetail = await page.evaluate(() => {
    const text = document.body.innerText;
    return { snippet: text.slice(200, 600) };
  });
  log(`  Claim content: ${claimDetail.snippet.replace(/\n/g, " | ").slice(0, 200)}`);

  // ===== TEST 3: Settings form =====
  log("\n=== TEST 3: Settings form ===");
  await page.goto("http://localhost:3000/administrator/settings", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const settings = await page.evaluate(() => {
    const inputs = document.querySelectorAll("input, select");
    const saveBtn = [...document.querySelectorAll("button")].find(b => /save/i.test(b.textContent));
    const panels = document.querySelectorAll(".panel");
    const text = document.body.innerText;
    // Check specific settings
    const academicYear = [...inputs].find(i => i.labels?.[0]?.textContent?.includes("Academic year"));
    const admissionFrom = [...inputs].find(i => i.labels?.[0]?.textContent?.includes("from"));
    const admissionTo = [...inputs].find(i => i.labels?.[0]?.textContent?.includes("to"));
    const partialPayments = [...inputs].find(i => i.type === "checkbox" && i.labels?.[0]?.textContent?.includes("Partial"));
    return {
      inputCount: inputs.length, hasSave: !!saveBtn, panelCount: panels.length,
      academicYearValue: academicYear?.value,
      admissionFromValue: admissionFrom?.value,
      admissionToValue: admissionTo?.value,
      partialPaymentsChecked: partialPayments?.checked,
      inputLabels: [...inputs].slice(0, 8).map(i => i.labels?.[0]?.textContent?.slice(0, 35) || i.type),
    };
  });
  log(`  Inputs: ${settings.inputCount}, Panels: ${settings.panelCount}, Save: ${settings.hasSave}`);
  log(`  Labels: ${settings.inputLabels.join(", ")}`);
  log(`  Academic year: ${settings.academicYearValue || "not set"}`);
  log(`  Admission window: ${settings.admissionFromValue || "not set"} → ${settings.admissionToValue || "not set"}`);
  log(`  Partial payments: ${settings.partialPaymentsChecked}`);
  if (settings.inputCount === 0) issue("Settings has no inputs");
  if (!settings.hasSave) issue("Settings has no save button");

  // ===== TEST 4: Audit filters =====
  log("\n=== TEST 4: Audit filters ===");
  await page.goto("http://localhost:3000/administrator/audit", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const auditFilters = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll(".seg button, .seg a")].map(t => ({
      text: t.textContent.trim(), tag: t.tagName.toLowerCase()
    }));
    const table = document.querySelector("table");
    const rows = table ? table.querySelectorAll("tbody tr").length : 0;
    const headers = table ? [...table.querySelectorAll("th")].map(h => h.textContent.trim()) : [];
    return { tabs, rows, headers };
  });
  log(`  Filter tabs: ${auditFilters.tabs.map(t => t.text).join(", ")}`);
  log(`  Rows: ${auditFilters.rows}`);
  log(`  Headers: ${auditFilters.headers.join(" | ")}`);

  // Click each date filter
  for (const tab of auditFilters.tabs) {
    const locator = tab.tag === "button"
      ? page.locator(".seg button").filter({ hasText: new RegExp(`^${tab.text}$`) })
      : page.locator(".seg a").filter({ hasText: new RegExp(`^${tab.text}$`) });
    if (await locator.count() > 0) {
      await locator.first().click();
      await page.waitForTimeout(1500);
      const rows = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
      log(`  Filter "${tab.text}": ${rows} rows`);
    }
  }

  // ===== TEST 5: Data imports workflow =====
  log("\n=== TEST 5: Data imports ===");
  await page.goto("http://localhost:3000/administrator/data/imports", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const imports = await page.evaluate(() => {
    const createBtn = [...document.querySelectorAll("button")].find(b => /create|new|start/i.test(b.textContent));
    const text = document.body.innerText;
    const hasSteps = text.includes("Upload") || text.includes("upload");
    const hasTypes = text.includes("students") || text.includes("guardians") || text.includes("teachers");
    const emptyMsg = text.includes("No ") || text.includes("nothing");
    return { hasCreateBtn: !!createBtn, createBtnText: createBtn?.textContent.trim(),
      hasSteps, hasTypes, emptyMsg, snippet: text.slice(100, 400) };
  });
  log(`  Create button: ${imports.createBtnText || "not found"}`);
  log(`  Has steps: ${imports.hasSteps}, Has types: ${imports.hasTypes}`);
  log(`  Snippet: ${imports.snippet.replace(/\n/g, " | ").slice(0, 200)}`);
  if (!imports.hasCreateBtn) issue("No create batch button on imports page");

  // Try clicking create batch
  if (imports.hasCreateBtn) {
    await page.locator("button").filter({ hasText: /create/i }).first().click();
    await page.waitForTimeout(2000);
    const batchForm = await page.evaluate(() => {
      const form = document.querySelector("form");
      const selects = document.querySelectorAll("select");
      const inputs = document.querySelectorAll("input");
      const text = document.body.innerText;
      return { hasForm: !!form, selectCount: selects.length, inputCount: inputs.length,
        selectOptions: [...selects].map(s => [...s.options].map(o => o.textContent).slice(0, 5)),
        snippet: text.slice(0, 300) };
    });
    log(`  After create click: form=${batchForm.hasForm}`);
    if (batchForm.selectOptions.length > 0) {
      log(`  Select options: ${batchForm.selectOptions.map(o => o.join(", ")).join(" | ")}`);
    }
    await page.screenshot({ path: "/tmp/manual-imports-batch.png" });
  }

  await browser.close();
  log(`\n=== STAFF INTERACTION ISSUES: ${issues.length} ===`);
  issues.forEach((i, n) => console.log(`  ${n + 1}. ${i}`));
})();
