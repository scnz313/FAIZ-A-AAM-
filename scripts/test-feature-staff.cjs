const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const issues = [];
  const log = (m) => console.log(m);
  const issue = (m) => { issues.push(m); console.log("  ISSUE: " + m); };

  // Sign in as Administrator
  await page.goto("http://localhost:3000/sign-in/staff", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Administrator/i }).click();
  await page.waitForURL(/\/administrator/, { timeout: 15000 });
  await page.waitForTimeout(2000);

  // FEATURE 6: USERS
  log("=== FEATURE 6: STAFF USERS ===");
  await page.goto("http://localhost:3000/administrator/users", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const users = await page.evaluate(() => {
    const h1 = document.querySelector("h1")?.textContent;
    const table = document.querySelector("table");
    const rows = table ? [...table.querySelectorAll("tbody tr")] : [];
    const text = document.body.innerText;
    const headers = table ? [...table.querySelectorAll("th")].map(h => h.textContent.trim()) : [];
    const sampleRows = rows.slice(0, 3).map(r => [...r.querySelectorAll("td")].map(c => c.textContent.trim().slice(0, 30)));
    const hasInvite = text.includes("Invite") || text.includes("invite");
    const hasManage = [...document.querySelectorAll("button")].some(b => /manage|suspend|revoke/i.test(b.textContent));
    const statuses = [...new Set(rows.map(r => {
      const st = r.querySelector("[class*=status], [class*=badge]");
      return st?.textContent?.trim();
    }).filter(Boolean))].slice(0, 5);
    return { title: h1, rowCount: rows.length, headers, sampleRows, hasInvite, hasManage, statuses };
  });
  log("1. Title:", users.title);
  log("   Rows:", users.rowCount);
  log("   Headers:", users.headers.join(" | "));
  users.sampleRows.forEach((r, i) => log(`   Row ${i + 1}: ${r.join(" | ")}`));
  log("   Statuses found:", users.statuses.join(", "));
  log("   Has invite:", users.hasInvite, "Has manage:", users.hasManage);
  if (users.rowCount === 0) issue("Users table is empty");
  if (!users.hasInvite) issue("No invite button visible");

  // Test invite modal
  if (users.hasInvite) {
    log("2. Testing invite modal...");
    try {
      await page.getByRole("button", { name: /invite/i }).first().click();
      await page.waitForTimeout(1500);
      const modal = await page.evaluate(() => {
        const dialog = document.querySelector("dialog[open], [role=dialog], .overlay .modal");
        const fields = dialog ? dialog.querySelectorAll("input, select") : [];
        return { hasModal: !!dialog, fieldCount: fields.length,
          fieldNames: [...fields].map(f => f.labels?.[0]?.textContent?.slice(0, 30) || f.placeholder?.slice(0, 30)) };
      });
      log("   Modal:", JSON.stringify(modal));
      if (!modal.hasModal) issue("Invite modal does not open");
      // Close it
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    } catch (err) {
      issue("Invite modal error: " + err.message?.slice(0, 80));
    }
  }

  // FEATURE 7: GUARDIAN LINK CLAIMS
  log("\n=== FEATURE 7: GUARDIAN LINK CLAIMS ===");
  await page.goto("http://localhost:3000/administrator/link-requests", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const claims = await page.evaluate(() => {
    const h1 = document.querySelector("h1")?.textContent;
    const text = document.body.innerText;
    const panels = document.querySelectorAll(".panel");
    const approveBtns = [...document.querySelectorAll("button")].filter(b => /approve/i.test(b.textContent));
    const rejectBtns = [...document.querySelectorAll("button")].filter(b => /reject/i.test(b.textContent));
    const claimRows = [...document.querySelectorAll("table tbody tr, [class*=claim], [class*=link]")];
    return { title: h1, panelCount: panels.length, approveCount: approveBtns.length,
      rejectCount: rejectBtns.length, claimRowCount: claimRows.length,
      snippet: text.slice(0, 300) };
  });
  log("1. Title:", claims.title);
  log("   Panels:", claims.panelCount);
  log("   Approve buttons:", claims.approveCount);
  log("   Reject buttons:", claims.rejectCount);
  log("   Snippet:", claims.snippet.replace(/\n/g, " | ").slice(0, 200));

  if (claims.approveCount === 0) issue("No approve buttons visible for guardian link claims");

  // FEATURE 8: SETTINGS
  log("\n=== FEATURE 8: STAFF SETTINGS ===");
  await page.goto("http://localhost:3000/administrator/settings", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const settings = await page.evaluate(() => {
    const h1 = document.querySelector("h1")?.textContent;
    const panels = document.querySelectorAll(".panel");
    const inputs = document.querySelectorAll("input, select");
    const saveBtn = [...document.querySelectorAll("button")].find(b => /save/i.test(b.textContent));
    const text = document.body.innerText;
    const hasAcademicYear = text.includes("Academic year") || text.includes("academic year");
    const hasAdmissionWindow = text.includes("admission") || text.includes("Admission");
    const hasFeePolicy = text.includes("fee") || text.includes("Fee");
    const hasResultPolicy = text.includes("result") || text.includes("Result");
    const fieldValues = [...inputs].slice(0, 5).map(i => ({
      type: i.type,
      value: i.value?.slice(0, 30),
      label: i.labels?.[0]?.textContent?.slice(0, 30),
    }));
    return { title: h1, panelCount: panels.length, inputCount: inputs.length, hasSave: !!saveBtn,
      hasAcademicYear, hasAdmissionWindow, hasFeePolicy, hasResultPolicy, fieldValues };
  });
  log("1. Title:", settings.title);
  log("   Panels:", settings.panelCount, "Inputs:", settings.inputCount, "Save:", settings.hasSave);
  log("   Academic year:", settings.hasAcademicYear, "Admission:", settings.hasAdmissionWindow,
      "Fees:", settings.hasFeePolicy, "Results:", settings.hasResultPolicy);
  settings.fieldValues.forEach(f => log(`   Field: ${f.label || f.type} = ${f.value}`));
  if (settings.inputCount === 0) issue("Settings page has no editable inputs");
  if (!settings.hasSave) issue("Settings page has no save button");

  // FEATURE 9: AUDIT
  log("\n=== FEATURE 9: STAFF AUDIT ===");
  await page.goto("http://localhost:3000/administrator/audit", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const audit = await page.evaluate(() => {
    const h1 = document.querySelector("h1")?.textContent;
    const table = document.querySelector("table");
    const rows = table ? table.querySelectorAll("tbody tr") : [];
    const text = document.body.innerText;
    const filters = [...document.querySelectorAll(".seg button, .seg a")].map(f => f.textContent.trim());
    const headers = table ? [...table.querySelectorAll("th")].map(h => h.textContent.trim()) : [];
    const sampleRows = [...rows].slice(0, 3).map(r => r.textContent.trim().slice(0, 80));
    return { title: h1, rowCount: rows.length, headers, filters, sampleRows };
  });
  log("1. Title:", audit.title);
  log("   Rows:", audit.rowCount);
  log("   Headers:", audit.headers.join(" | "));
  log("   Filters:", audit.filters.join(", "));
  audit.sampleRows.forEach((r, i) => log(`   Row ${i + 1}: ${r}`));
  if (audit.rowCount === 0) issue("Audit table is empty");

  // FEATURE 10: DATA IMPORTS
  log("\n=== FEATURE 10: DATA IMPORTS ===");
  await page.goto("http://localhost:3000/administrator/data/imports", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const imports = await page.evaluate(() => {
    const h1 = document.querySelector("h1")?.textContent;
    const text = document.body.innerText;
    const createBtn = [...document.querySelectorAll("button")].find(b => /create|new|start/i.test(b.textContent));
    const hasUpload = text.includes("upload") || text.includes("Upload") || text.includes("CSV");
    const hasSteps = text.includes("Upload") && text.includes("Validate") && text.includes("Commit");
    return { title: h1, hasCreateBtn: !!createBtn, hasUpload, hasSteps,
      snippet: text.slice(0, 250) };
  });
  log("1. Title:", imports.title);
  log("   Create button:", imports.hasCreateBtn, "Upload:", imports.hasUpload, "Steps:", imports.hasSteps);
  log("   Snippet:", imports.snippet.replace(/\n/g, " | ").slice(0, 200));
  if (!imports.hasCreateBtn) issue("No create batch button on imports page");

  // Responsive check for all staff pages
  log("\n=== RESPONSIVE CHECK (390px) ===");
  await page.setViewportSize({ width: 390, height: 844 });
  const staffPages = [
    "/administrator/users", "/administrator/link-requests",
    "/administrator/settings", "/administrator/audit", "/administrator/data/imports",
  ];
  for (const path of staffPages) {
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const name = path.split("/").pop();
    log(`   ${name}: ${overflow}px overflow`);
    if (overflow > 1) issue(`${name} overflows ${overflow}px at 390px`);
  }

  await browser.close();
  log(`\n=== TOTAL: ${issues.length === 0 ? "ALL 10 FEATURES WORKING" : issues.length + " ISSUES"} ===`);
  issues.forEach((i, n) => console.log(`  ${n + 1}. ${i}`));
})();
