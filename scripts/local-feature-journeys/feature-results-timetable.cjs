/**
 * Feature: results + timetable — portal results list/detail, staff results
 * queue tabs, timetable override record → portal apply → revoke restore,
 * and date-sheet publish → portal badge.
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
      await page.goto(`${base}/portal/results`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("portal results list renders", body.includes("PUB-2026-") || body.includes("result"), body.slice(-120));
      const pubLink = page.locator('a[href*="/portal/results/PUB-"]').nth(1);
      if ((await pubLink.count()) > 0) {
        await pubLink.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1800);
        const detail = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        const hasMarks = /Grade|A1|B2|marks|obtained/i.test(detail);
        check("publication detail shows subjects + grades", hasMarks, detail.slice(-140));
      } else {
        check("publication detail shows subjects + grades", false, "no PUB- link");
      }
    } catch (error) {
      check("portal results", false, String(error.message).slice(0, 140));
    }

    try {
      await staffAs(page, base, "/staff/results", { identity: STAFF_IDS.sana });
      await page.waitForTimeout(1200);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("staff results queue renders batches", body.includes("RB-2026-") || body.includes("batch"), body.slice(-120));
      const tabs = await page.locator('button[role="tab"], .tabs button').count();
      check("results queue status tabs", tabs >= 5, `${tabs} tabs`);
    } catch (error) {
      check("staff results queue", false, String(error.message).slice(0, 140));
    }

    try {
      /* Timetable override: staff records → portal applies → revoke restores. */
      await staffAs(page, base, "/staff/timetables", { identity: STAFF_IDS.rania });
      await page.getByRole("button", { name: "Add date-specific override" }).waitFor({ state: "visible", timeout: 20000 });
      await page.getByRole("button", { name: "Add date-specific override" }).click();
      /* Calendar date input: Tuesday of the demo week (3–8 August 2026). */
      await page.getByLabel("Date", { exact: true }).fill("2026-08-04");
      await page.getByLabel("Period", { exact: true }).selectOption({ label: "14:15 — Physical education · T. Waza" });
      await page.getByLabel("Kind", { exact: true }).selectOption("substitute");
      await page.getByLabel("Substitute teacher", { exact: true }).fill("N. Lone");
      await page.getByLabel("Subject", { exact: true }).fill("Computer Science");
      await page.getByLabel(/^Reason/).fill("N. Lone covers Computer Science while M. Wani attends training.");
      await page.getByRole("button", { name: "Record override" }).click();
      await page.getByText(/OVR-2026-001 recorded/).waitFor({ state: "visible", timeout: 15000 });
      check("staff records a timetable override", true);

      await page.goto(`${base}/portal/timetable`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Week" }).click();
      await page.getByRole("button", { name: "Tuesday", exact: true }).click();
      await page.getByText(/1 date override applies on Tuesday/).waitFor({ state: "visible", timeout: 15000 });
      const tueBody = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("portal applies the override on Tuesday", tueBody.includes("N. Lone") && tueBody.includes("DATE OVERRIDE"), tueBody.slice(-120));

      await page.goto(`${base}/staff/timetables`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Revoke", exact: true }).click();
      await page.getByLabel("Revocation reason").fill("The substitute teacher has returned to the scheduled class.");
      await page.getByRole("button", { name: "Confirm revocation" }).click();
      await page.getByText(/OVR-2026-001 revoked/).waitFor({ state: "visible", timeout: 15000 });
      check("staff revokes the override", true);

      await page.goto(`${base}/portal/timetable`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Week" }).click();
      await page.getByRole("button", { name: "Tuesday", exact: true }).click();
      const afterBody = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("portal restores the base after revoke", !afterBody.includes("N. Lone"), afterBody.slice(-120));

      /* Date-sheet publish shows the version badge on the portal. */
      await page.goto(`${base}/staff/timetables`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Publish date sheet" }).click();
      await page.getByText(/Date sheet v1 published/).waitFor({ state: "visible", timeout: 15000 });
      check("staff publishes the date sheet", true);
      await page.goto(`${base}/portal/timetable`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Exam date sheet" }).click();
      const examBody = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("portal shows the published date-sheet badge", /v1\s*·\s*published/i.test(examBody), examBody.slice(-120));
    } catch (error) {
      check("timetable override + date sheet", false, String(error.message).slice(0, 140));
    }

    await page.close();
    return { checks, consoleErrors };
  },
};
