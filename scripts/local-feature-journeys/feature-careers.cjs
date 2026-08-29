/**
 * Feature: careers — vacancy listing/detail, job draft autosave + resume,
 * full submission → JOB- reference, applicant withdrawal, staff queue tabs,
 * and an HR decision with note + confirmation.
 */
const { attachErrorCapture, staffAs, STAFF_IDS } = require("./helpers.cjs");

module.exports = {
  async run(browser, base) {
    const page = await browser.newPage();
    const consoleErrors = [];
    attachErrorCapture(page, consoleErrors);
    const checks = [];
    const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

    try {
      await page.goto(`${base}/careers`, { waitUntil: "networkidle" });
      check("careers lists vacancies", (await page.locator("body").innerText()).length > 300);
      await page.locator('a[href^="/careers/"]').first().click();
      await page.waitForLoadState("networkidle");
      const detail = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("vacancy detail has an apply CTA", detail.includes("Apply for this position"), detail.slice(-120));
    } catch (error) {
      check("careers listing + detail", false, String(error.message).slice(0, 120));
    }

    try {
      await page.goto(`${base}/apply/job/mathematics-teacher`, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.reload({ waitUntil: "networkidle" });
      const cont = page.getByRole("button", { name: "Save & continue" });
      await cont.waitFor({ state: "visible", timeout: 20000 });
      await page.getByLabel(/Full name|Name/).first().fill("Career Draft Test");
      await page.waitForTimeout(1200);
      await page.goto(`${base}/careers`, { waitUntil: "networkidle" });
      await page.goto(`${base}/apply/job/mathematics-teacher`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const nameValue = await page.getByLabel(/Full name|Name/).first().inputValue().catch(() => "");
      check("job draft autosaves and resumes", nameValue === "Career Draft Test", `name="${nameValue}"`);
    } catch (error) {
      check("job draft autosave + resume", false, String(error.message).slice(0, 140));
    }

    try {
      await page.goto(`${base}/careers/mathematics-teacher`, { waitUntil: "networkidle" });
      await page.getByRole("link", { name: /Apply for this position/ }).click();
      await page.waitForURL(/\/apply\/job\/mathematics-teacher$/);
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.getByLabel("Full name").fill("Withdraw Test Applicant");
      await page.getByLabel("Phone").fill("9419004004");
      await page.getByLabel("Email").fill("withdraw@example.com");
      await page.getByRole("button", { name: /Save & continue/ }).click();
      await page.getByLabel("Highest qualification").selectOption("Master of Science (M.Sc.)");
      await page.getByLabel("Subject / specialisation").fill("Mathematics");
      await page.getByLabel("Institution").fill("Kashmir University");
      await page.getByLabel("Year completed").selectOption("2019");
      await page.getByRole("button", { name: /Save & continue/ }).click();
      await page.getByLabel("Years of experience").selectOption("3–5 years");
      await page.getByLabel("Current role").fill("Mathematics teacher");
      for (const doc of ["Photograph", "Educational certificates", "Experience certificates", "Identity proof"]) {
        await page.getByLabel(doc).setInputFiles({ name: "demo.pdf", mimeType: "application/pdf", buffer: Buffer.from("demo") });
      }
      await page.getByRole("button", { name: /Save & continue/ }).click();
      await page.getByLabel(/I confirm that the information/).check();
      await page.getByRole("button", { name: /Submit application/ }).click();
      await page.waitForURL(/\/apply\/job\/JOB-\d{4}-\d{4}\/status$/, { timeout: 25000 });
      await page.getByText("Submitted", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const ref = (body.match(/JOB-2026-\d{4}/) ?? ["?"])[0];
      check("job submission creates a JOB reference", ref.startsWith("JOB-2026-"), ref);
      check("job status shows Submitted", body.includes("Submitted"));
      const withdrawBtn = page.getByRole("button", { name: /Withdraw/ });
      if ((await withdrawBtn.count()) > 0) {
        await withdrawBtn.click();
        await page.waitForTimeout(500);
        const confirmBtn = page.getByRole("button", { name: /Confirm withdrawal/ });
        if ((await confirmBtn.count()) > 0) {
          await confirmBtn.click();
          await page.waitForTimeout(1500);
          const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
          check("applicant withdraws the application", after.includes("Withdrawn"), after.slice(-120));
        } else {
          check("applicant withdraws the application", false, "no confirm button");
        }
      } else {
        check("applicant withdraws the application", false, "no Withdraw button");
      }
    } catch (error) {
      check("job submit + withdraw", false, String(error.message).slice(0, 140));
    }

    try {
      await staffAs(page, base, "/staff/careers", { identity: STAFF_IDS.rania });
      await page.waitForTimeout(1200);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("careers queue renders", body.includes("JOB-") || body.includes("applications"), body.slice(-120));
      const tabs = await page.locator('button[role="tab"], .tabs button').count();
      check("careers queue has status filter tabs", tabs >= 5, `${tabs} tabs`);
      const firstLink = page.locator('a[href^="/staff/careers/JOB-"]').first();
      if ((await firstLink.count()) > 0) {
        await firstLink.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1000);
        const offerBtn = page.getByRole("button", { name: "Offer", exact: true });
        const notSelectedBtn = page.getByRole("button", { name: /Not selected/ });
        const decisionBtn = (await offerBtn.count()) > 0 ? offerBtn : notSelectedBtn;
        if ((await decisionBtn.count()) > 0) {
          await decisionBtn.click();
          await page.waitForTimeout(500);
          const note = page.getByLabel(/Note|Reason/).first();
          if ((await note.count()) > 0) {
            await note.fill("Interview was strong; references verified and the panel recommends an offer.");
          }
          await page.getByRole("button", { name: "Continue", exact: true }).click();
          await page.waitForTimeout(400);
          const confirmBtn = page.getByRole("button", { name: "Confirm", exact: true });
          if ((await confirmBtn.count()) > 0) {
            await confirmBtn.click();
            await page.waitForTimeout(1500);
            const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
            check("HR decision records (offer/not-selected)", after.includes("Offered") || after.includes("Not selected"), after.slice(-120));
          } else {
            check("HR decision records (offer/not-selected)", false, "no Confirm button");
          }
        } else {
          check("HR decision records (offer/not-selected)", false, "no decision buttons");
        }
      } else {
        check("HR decision records (offer/not-selected)", false, "no application detail link");
      }
    } catch (error) {
      check("staff careers", false, String(error.message).slice(0, 140));
    }

    await page.close();
    return { checks, consoleErrors };
  },
};
