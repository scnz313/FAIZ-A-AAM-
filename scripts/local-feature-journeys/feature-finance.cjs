/**
 * Feature: finance — portal ledger/filters/invoice detail/receipt view and
 * the staff workspace/invoices/payments/reconciliation registers.
 */
const { attachErrorCapture, signInGuardian, staffAs, STAFF_IDS } = require("./helpers.cjs");

module.exports = {
  async run(browser, base) {
    const page = await browser.newPage();
    const consoleErrors = [];
    attachErrorCapture(page, consoleErrors);
    const checks = [];
    const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

    try {
      await signInGuardian(page, base);
      await page.goto(`${base}/portal/fees`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("portal ledger renders invoices", body.includes("INV-2026-"), body.slice(-120));
      const tabLabels = await page.locator('a[aria-current]').allTextContents();
      check("ledger filter tabs present", tabLabels.length >= 2, tabLabels.join(", "));
      const unpaidTab = page.getByRole("link", { name: /Unpaid/ }).first();
      if ((await unpaidTab.count()) > 0) {
        await unpaidTab.click();
        await page.waitForTimeout(800);
        const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check("unpaid filter narrows the ledger", after.includes("Outstanding"), after.slice(-120));
      }
      const invoiceLink = page.locator('a[href*="/portal/fees/INV-"]').first();
      if ((await invoiceLink.count()) > 0) {
        await invoiceLink.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1200);
        const detail = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check(
          "invoice detail shows line items and balance",
          detail.includes("INV-2026-") && (detail.includes("Tuition") || detail.includes("₹")),
          detail.slice(-120),
        );
      } else {
        check("invoice detail shows line items and balance", false, "no invoice link");
      }
      await page.goto(`${base}/portal/receipts/RC-2026-0102`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const rc = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("receipt view renders", rc.includes("RC-2026-0102") && (rc.includes("Paid") || rc.includes("receipt")), rc.slice(-120));
    } catch (error) {
      check("portal fees flow", false, String(error.message).slice(0, 140));
    }

    try {
      await staffAs(page, base, "/staff/finance");
      const ws = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check(
        "finance workspace renders the ledger summary",
        ws.includes("Finance") && (ws.includes("INV-") || ws.includes("outstanding")),
        ws.slice(-120),
      );
    } catch (error) {
      check("finance workspace", false, String(error.message).slice(0, 120));
    }

    for (const [path, name, needle] of [
      ["/staff/finance/invoices", "staff invoices register", /INV-2026-/],
      ["/staff/finance/payments", "staff payments register", /Payment|PAY-|success/i],
      ["/staff/finance/reconciliation", "reconciliation page", /Reconciliation|match|discrepancy/i],
    ]) {
      try {
        await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1200);
        const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check(name, needle.test(body), body.slice(-120));
      } catch (error) {
        check(name, false, String(error.message).slice(0, 120));
      }
    }

    try {
      await page.goto(`${base}/staff/finance/reconciliation`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const runBtn = page.getByRole("button", { name: /Run reconciliation|Start reconciliation/ });
      if ((await runBtn.count()) > 0) {
        await runBtn.click();
        await page.waitForTimeout(2000);
        const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check("reconciliation run completes", after.includes("Run complete") || after.includes("match"), after.slice(-120));
      } else {
        check("reconciliation run completes", false, "no run button");
      }
    } catch (error) {
      check("reconciliation run completes", false, String(error.message).slice(0, 120));
    }

    /* Maker/checker adjustment flow: officer requests, approver approves,
       officer posts, and the family portal sees the same ledger state. */
    try {
      await staffAs(page, base, "/staff/finance");
      await page.waitForSelector("#adjust-invoice", { timeout: 20000 });
      const invoiceOptions = await page.locator("#adjust-invoice option").allTextContents();
      const unpaidIndex = invoiceOptions.findIndex((label) => label.startsWith("INV-2026-0103"));
      await page.locator("#adjust-invoice").selectOption({ index: Math.max(1, unpaidIndex) });
      await page.locator("#adjust-type").selectOption("concession");
      await page.locator("#adjust-amount").fill("500");
      await page.locator("#adjust-reason").fill("Merit concession applied for the term fee.");
      await page.getByRole("button", { name: "Request adjustment" }).click();
      await page.waitForTimeout(1800);
      const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("officer requests an adjustment", after.includes("ADJ-2026-0401 requested"), after.slice(-120));

      await page.getByRole("combobox", { name: "Demo identity" }).selectOption(STAFF_IDS.rania);
      await page.waitForTimeout(2000);
      const ws = page.getByRole("combobox", { name: "Workspace" });
      const options = await ws.locator("option").allTextContents();
      const approverIndex = options.findIndex((label) => /Finance approver/.test(label));
      if (approverIndex >= 0) {
        await ws.selectOption({ index: approverIndex });
        await page.waitForTimeout(2000);
      }
      const reasonInput = page.getByLabel("Decision reason for ADJ-2026-0401");
      await reasonInput.waitFor({ state: "visible", timeout: 15000 });
      await reasonInput.fill("Concession within the approved merit policy.");
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await page.waitForTimeout(1800);
      const approved = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("approver approves the adjustment", approved.includes("ADJ-2026-0401 approved"), approved.slice(-120));

      await page.getByRole("combobox", { name: "Demo identity" }).selectOption(STAFF_IDS.sana);
      await page.waitForTimeout(2500);
      const ws2 = page.getByRole("combobox", { name: "Workspace" });
      const options2 = await ws2.locator("option").allTextContents();
      const officerIndex = options2.findIndex((label) => /Finance officer/.test(label));
      if (officerIndex >= 0) {
        await ws2.selectOption({ index: officerIndex });
        await page.waitForTimeout(2500);
      }
      const postBtn = page.getByRole("button", { name: "Post to ledger" }).first();
      await postBtn.waitFor({ state: "visible", timeout: 15000 });
      await postBtn.click();
      await page.waitForTimeout(2000);
      const posted = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("officer posts the adjustment to the ledger", posted.includes("ADJ-2026-0401 posted"), posted.slice(-120));

      /* Family portal sees the same posted ledger state. */
      await signInGuardian(page, base, { clear: false });
      await page.goto(`${base}/portal/fees/INV-2026-0103`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);
      const inv = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check(
        "portal shows the posted ledger entry and updated balance",
        inv.includes("8,700") && inv.includes("LED-2026-0701"),
        inv.slice(-120),
      );
    } catch (error) {
      check("adjustment maker/checker flow", false, String(error.message).slice(0, 140));
    }

    await page.close();
    return { checks, consoleErrors };
  },
};
