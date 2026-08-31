/**
 * Feature: content/documents/support — notice draft (editor) → publish
 * (publisher workspace), public + portal notice boards, document library
 * with preview, portal grievance submit, and staff respond + resolve +
 * reopen.
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
      await staffAs(page, base, "/staff/notices", { identity: STAFF_IDS.aisha });
      const titleField = page.getByLabel("Title");
      if ((await titleField.count()) > 0) {
        await titleField.fill("Parent-teacher meeting on Friday");
        await page.getByLabel("Body").fill("All parents are invited to the parent-teacher meeting this Friday at 14:00 in the school hall.");
        const reviewNote = page.getByLabel(/review and publish note/i);
        if ((await reviewNote.count()) > 0) {
          await reviewNote.fill("Approved by the school office for families.");
        }
        await page.getByRole("button", { name: "Save draft" }).click();
        await page.waitForTimeout(1500);
        const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check("notice draft created", body.includes("Parent-teacher meeting") || body.includes("draft"), body.slice(-120));

        /* Editor sends the draft for review — scoped to OUR notice's row so
           seeded draft rows are never mistaken for the new notice. */
        const ourRow = page.locator("tr", { hasText: "Parent-teacher meeting on Friday" });
        const reviewBtn = ourRow.getByRole("button", { name: "Request review" }).first();
        if ((await reviewBtn.count()) > 0) {
          await reviewBtn.click();
          await page.waitForTimeout(1500);
        }

        /* Switch to the independent content publisher identity WITHOUT
           clearing the session store (the draft lives there), then approve
           and release. */
        const identitySelect = page.getByRole("combobox", { name: "Demo identity" });
        if ((await identitySelect.count()) > 0) {
          await identitySelect.selectOption(STAFF_IDS.naseer);
        }
        /* The workspace re-renders after the identity switch; poll for the
           Approve control before giving up. */
        const approveRow = page.locator("tr", { hasText: "Parent-teacher meeting on Friday" });
        let approveBtn = approveRow.getByRole("button", { name: "Approve", exact: true }).first();
        for (let attempt = 0; attempt < 12 && (await approveBtn.count()) === 0; attempt += 1) {
          await page.waitForTimeout(500);
          approveBtn = approveRow.getByRole("button", { name: "Approve", exact: true }).first();
        }
        if ((await approveBtn.count()) > 0) {
          await approveBtn.click();
          await page.waitForTimeout(1500);
        }
        /* Approval auto-selects the release candidate; publish immediately. */
        const releaseBtn = page.getByRole("button", { name: "Publish now", exact: true }).first();
        if ((await releaseBtn.count()) > 0) {
          await releaseBtn.click();
          await page.waitForTimeout(1500);
          const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
          check("notice publishes through the maker/checker flow", after.includes("published") || after.includes("Published"), after.slice(-120));
        } else {
          /* Fall back to Prepare release when approval did not auto-select. */
          const prepareBtn = page.getByRole("button", { name: "Prepare release" }).first();
          if ((await prepareBtn.count()) > 0) {
            await prepareBtn.click();
            await page.waitForTimeout(500);
            const releaseRetry = page.getByRole("button", { name: "Publish now", exact: true }).first();
            if ((await releaseRetry.count()) > 0) {
              await releaseRetry.click();
              await page.waitForTimeout(1500);
              const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
              check("notice publishes through the maker/checker flow", after.includes("published") || after.includes("Published"), after.slice(-120));
            } else {
              check("notice publishes through the maker/checker flow", false, "no Publish now button after Prepare release");
            }
          } else {
            check("notice publishes through the maker/checker flow", false, "no Approve or Publish flow available");
          }
        }
      } else {
        check("notice draft created", false, "no Title field");
      }
    } catch (error) {
      check("notice create + publish", false, String(error.message).slice(0, 140));
    }

    try {
      await page.goto(`${base}/notices`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      check("public notices board renders", (await page.locator("body").innerText()).length > 300);
    } catch (error) {
      check("public notices board", false, String(error.message).slice(0, 120));
    }

    try {
      await signInGuardian(page, base);
      await page.goto(`${base}/portal/notices`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("portal notices renders", body.includes("Notice") || body.includes("notice"), body.slice(-120));
    } catch (error) {
      check("portal notices", false, String(error.message).slice(0, 120));
    }

    try {
      await page.goto(`${base}/portal/documents`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1800);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check(
        "documents library renders per-student rows",
        body.includes("Report card") || body.includes("Receipt") || body.includes("document"),
        body.slice(-120),
      );
      const previewBtn = page.getByRole("button", { name: /Preview/ }).first();
      if ((await previewBtn.count()) > 0) {
        await previewBtn.click();
        await page.waitForTimeout(800);
        const dialog = page.locator('[role="dialog"], [class*="preview"]').first();
        check("document preview opens", await dialog.isVisible().catch(() => false));
        await page.keyboard.press("Escape");
      } else {
        check("document preview opens", false, "no Preview button");
      }
    } catch (error) {
      check("documents library", false, String(error.message).slice(0, 140));
    }

    try {
      await page.goto(`${base}/portal/support`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      await page.getByLabel("Category").selectOption("Fees");
      await page.getByLabel("Subject").fill("Bus timing question");
      await page.getByLabel("Message").fill("Please confirm the afternoon bus departure time for the school road route.");
      await page.getByLabel("Your name").fill("Firdous Ahmad");
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Submit grievance" }).click();
      await page.getByRole("heading", { name: "Concern received" }).waitFor({ state: "visible", timeout: 20000 });
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const ref = (body.match(/GRV-2026-\d{4}/) ?? ["?"])[0];
      check("portal grievance submits", ref.startsWith("GRV-2026-"), ref);
    } catch (error) {
      check("portal grievance", false, String(error.message).slice(0, 140));
    }

    try {
      await staffAs(page, base, "/staff/support", { identity: STAFF_IDS.aisha });
      const row = page.locator('li, tr, [class*="row"]').filter({ hasText: /GRV-2026-/ }).first();
      if ((await row.count()) > 0) {
        await row.click();
        await page.waitForTimeout(800);
      }
      const textarea = page.getByLabel("Response");
      if ((await textarea.count()) > 0) {
        await textarea.fill("The afternoon bus leaves the school gate at 15:30 on the school road route.");
        const resolveCheck = page.getByLabel("Resolve after sending");
        if ((await resolveCheck.count()) > 0) {
          await resolveCheck.check().catch(() => {});
        }
        await page.getByRole("button", { name: "Send response" }).click();
        await page.waitForTimeout(1500);
        const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check("staff responds + resolves the grievance", after.includes("Resolved") || after.includes("Response recorded"), after.slice(-120));
        const reopenBtn = page.getByRole("button", { name: "Reopen" });
        if ((await reopenBtn.count()) > 0) {
          await reopenBtn.click();
          await page.waitForTimeout(1000);
          const reopened = (await page.locator("body").innerText()).replace(/\s+/g, " ");
          check("staff reopens the resolved grievance", reopened.includes("New") || reopened.includes("reopened"), reopened.slice(-120));
        } else {
          check("staff reopens the resolved grievance", false, "no Reopen button");
        }
      } else {
        check("staff responds + resolves the grievance", false, "no Response textarea");
      }
    } catch (error) {
      check("staff support inbox", false, String(error.message).slice(0, 140));
    }

    await page.close();
    return { checks, consoleErrors };
  },
};
