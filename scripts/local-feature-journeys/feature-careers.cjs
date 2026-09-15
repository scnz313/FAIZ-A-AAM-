/**
 * Feature: careers — vacancy listing/detail, the public no-sign-in
 * application (no documents, one optional photo), submission → JOB-
 * reference, staff queue tabs, and an HR decision with note + confirmation.
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
      /* Let the Next.js Link hydration settle before clicking so the
         client-side navigation is not raced by the initial hydrate. */
      await page.waitForTimeout(900);
      /* Retry the click until the client-side navigation lands — a click
         during hydration is silently swallowed by the router. */
      let navigated = false;
      for (let attempt = 0; attempt < 4 && !navigated; attempt += 1) {
        await page.locator('a[href^="/careers/"]').first().click();
        await page.waitForTimeout(1200);
        navigated = page.url().startsWith(`${base}/careers/`);
        if (!navigated && attempt < 3) await page.waitForTimeout(600);
      }
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
      await page.getByRole("button", { name: /Save & continue/ }).waitFor({ state: "visible", timeout: 20000 });
      const publicBody = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("public application needs no sign-in", !/sign in|log in/i.test(publicBody), publicBody.slice(-120));
      check("public application requires no documents", !publicBody.includes("Documents required"), publicBody.slice(-120));
      check("public application uploads no document fields", (await page.locator('input[type="file"]').count()) === 0, "step 1 has no file input");
    } catch (error) {
      check("public application surface", false, String(error.message).slice(0, 140));
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
      await page.getByLabel("Email").fill("withdraw@example.com");
      await page.getByLabel("Phone").fill("9419004004");
      await page.getByRole("button", { name: /Save & continue/ }).click();
      await page.getByLabel("Highest qualification").selectOption("Master of Science (M.Sc.)");
      await page.getByLabel("Years of experience").selectOption("3–5 years");
      await page.getByRole("button", { name: /Save & continue/ }).click();
      /* The review step offers one optional photo; the applicant skips it. */
      check("review step offers only an optional photo input", (await page.locator('input[type="file"]').count()) === 1, "one optional photo input");
      await page.getByLabel(/I confirm that the information/).check();
      await page.getByRole("button", { name: /Submit application/ }).click();
      await page.getByText(/Thank you · your application is with the school/).waitFor({ state: "visible", timeout: 25000 });
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const ref = (body.match(/JOB-2026-[A-Z0-9]+/) ?? ["?"])[0];
      check("job submission creates a JOB reference", ref.startsWith("JOB-2026-"), ref);
      check("job submission is email-only (no status portal)", body.includes("no portal to check") && !/\/apply\/job\/JOB-[^/]+\/status/.test(page.url()));
    } catch (error) {
      check("job submit", false, String(error.message).slice(0, 140));
    }

    try {
      await staffAs(page, base, "/principal/careers", { identity: STAFF_IDS.rania });
      await page.waitForTimeout(1200);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("careers queue renders", body.includes("JOB-") || body.includes("applications"), body.slice(-120));
      const tabs = await page.locator('button[role="tab"], .tabs button').count();
      check("careers queue has status filter tabs", tabs >= 5, `${tabs} tabs`);
      const interviewRow = page.locator("tr", { hasText: /INTERVIEW/i }).first();
      const firstLink = (await interviewRow.count()) > 0
        ? interviewRow.locator('a[href*="/principal/careers/JOB-"]').first()
        : page.locator('a[href^="/principal/careers/JOB-"]').first();
      if ((await firstLink.count()) > 0) {
        const detailHref = await firstLink.getAttribute("href");
        await firstLink.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1000);
        /* Reviewers score; the Administrator makes the final HR decision. */
        const identitySelect = page.getByRole("combobox", { name: "Demo identity" });
        const menuButton = page.getByRole("button", { name: /MENU/i });
        if ((await identitySelect.count()) === 0 && (await menuButton.count()) > 0) await menuButton.click();
        if ((await identitySelect.count()) > 0 && detailHref) {
          await identitySelect.selectOption(STAFF_IDS.aisha);
          await page.goto(`${base}${detailHref.replace(/^\/principal/, "/administrator")}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(900);
        }
        const offerBtn = page.getByRole("button", { name: /Offer position/i });
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
