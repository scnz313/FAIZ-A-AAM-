/**
 * Feature: guardian/student linking — link-child request, two-child
 * switcher with cross-page propagation, and staff reject-with-reason.
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
      await page.goto(`${base}/portal/link-child`, { waitUntil: "networkidle" });
      await page.waitForSelector("form", { timeout: 15000 });
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("link-child page renders", body.includes("Link another child") && body.includes("school to verify"), body.slice(-140));
      const refField = page.locator('input[type="text"]').first();
      if ((await refField.count()) > 0) {
        await refField.fill("SCHOOL-REF-2026-42");
        await page.getByRole("button", { name: /Request|Submit|Send/i }).first().click();
        await page.waitForTimeout(800);
        const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check("link request submits with reference", after.includes("reference") || after.includes("requested") || after.includes("recorded"), after.slice(-140));
      } else {
        check("link request submits with reference", false, "no reference input found");
      }
    } catch (error) {
      check("link-child request", false, String(error.message).slice(0, 140));
    }

    try {
      await page.goto(`${base}/portal`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const selector = page.locator("select").filter({ hasText: /Aarif|Mariam/ }).first();
      check("child switcher present", (await selector.count()) > 0);
      if ((await selector.count()) > 0) {
        const options = await selector.locator("option").allTextContents();
        check("two linked children listed", options.length >= 2, options.join(", "));
        const before = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        await selector.selectOption({ index: 1 });
        await page.waitForTimeout(800);
        const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check("child switch changes the overview", before !== after);
      }
    } catch (error) {
      check("child switcher", false, String(error.message).slice(0, 140));
    }

    try {
      await staffAs(page, base, "/staff/link-requests", { identity: STAFF_IDS.aisha });
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("link-requests page renders", body.includes("Nida Bhat") || body.includes("pending"), body.slice(-140));
      const rejectButtons = page.getByRole("button", { name: "Reject", exact: true });
      if ((await rejectButtons.count()) > 0) {
        await rejectButtons.first().click();
        await page.waitForTimeout(400);
        const reasonField = page.locator("textarea").first();
        if ((await reasonField.count()) > 0) {
          await reasonField.fill("The verification document does not match the guardian record.");
          await page.getByRole("button", { name: "Confirm rejection" }).click();
          await page.waitForTimeout(1000);
          const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
          check("staff rejects a link request with reason", after.includes("rejected") || after.includes("Rejected"), after.slice(-140));
        } else {
          check("staff rejects a link request with reason", false, "no reason textarea appeared");
        }
      } else {
        check("staff rejects a link request with reason", false, "no Reject buttons found");
      }
    } catch (error) {
      check("staff link-request rejection", false, String(error.message).slice(0, 140));
    }

    await page.close();
    return { checks, consoleErrors };
  },
};
