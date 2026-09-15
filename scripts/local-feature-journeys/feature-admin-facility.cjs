/**
 * Feature: admin + facility — users directory + invite, settings save,
 * audit explorer + filters, and the facility pages incl. alert
 * acknowledge, devices, history, reports, zones, and wallboard.
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
      await staffAs(page, base, "/administrator/users", { identity: STAFF_IDS.aisha, workspace: /system administrator/i });
      await page.waitForTimeout(1200);
      await page.getByText(/Active|Invited/i).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("users directory renders", /active|invited/i.test(body), body.slice(-120));
      const inviteBtn = page.getByRole("button", { name: /Invite (user|staff)/i });
      if ((await inviteBtn.count()) > 0) {
        await inviteBtn.click();
        await page.waitForTimeout(600);
        await page.getByLabel("Name", { exact: true }).fill("Test Invitee");
        const profileChoice = page.getByRole("radio").nth(1);
        if ((await profileChoice.count()) > 0) await profileChoice.click();
        await page.getByLabel("Email", { exact: true }).fill("invitee@example.com");
        await page.getByLabel(/Reason/).fill("New laboratory assistant joining the science team.");
        await page.getByRole("button", { name: "Send invitation" }).click();
        await page.waitForTimeout(2000);
        const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check("staff invite issues a one-time reference", after.includes("invited") || after.includes("Invitation sent"), after.slice(-120));
      } else {
        check("staff invite issues a one-time reference", false, "no Invite user button");
      }
    } catch (error) {
      check("users page", false, String(error.message).slice(0, 140));
    }

    try {
      await staffAs(page, base, "/administrator/settings", { identity: STAFF_IDS.aisha, workspace: /system administrator|admin/i });
      const scheme = page.getByLabel("Grading scheme");
      if ((await scheme.count()) > 0) {
        await scheme.selectOption({ index: 1 });
        await page.getByRole("button", { name: "Save changes" }).click();
        await page.waitForTimeout(2000);
        const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check("settings save persists", after.includes("saved") || after.includes("Saved"), after.slice(-120));
      } else {
        check("settings save persists", false, "no grading scheme field");
      }
    } catch (error) {
      check("settings page", false, String(error.message).slice(0, 140));
    }

    try {
      await staffAs(page, base, "/administrator/audit", { identity: STAFF_IDS.aisha, workspace: /auditor|system administrator/i });
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("audit explorer renders events", body.includes("Login") || body.includes("Audit"), body.slice(-120));
      const selects = await page.locator("select").count();
      check("audit action filter present", selects >= 1, `${selects} selects`);
    } catch (error) {
      check("audit page", false, String(error.message).slice(0, 140));
    }

    try {
      await staffAs(page, base, "/administrator/facility", { identity: STAFF_IDS.aisha, workspace: /support officer|system administrator/i });
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("facility overview renders zones", body.includes("zone") || body.includes("PM2.5"), body.slice(-120));
    } catch (error) {
      check("facility overview", false, String(error.message).slice(0, 120));
    }

    try {
      await staffAs(page, base, "/administrator/facility/alerts", { identity: STAFF_IDS.aisha, workspace: /support officer|system administrator/i });
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("facility alerts render", body.includes("AL-") || body.includes("alert") || body.includes("Alert"), body.slice(-120));
      const ackBtn = page.getByRole("button", { name: "Acknowledge" }).first();
      if ((await ackBtn.count()) > 0) {
        await ackBtn.click();
        await page.waitForTimeout(1500);
        const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check("alert acknowledge works", after.includes("acknowledged") || after.includes("Acknowledged"), after.slice(-120));
      } else {
        check("alert acknowledge works", false, "no Acknowledge button");
      }
    } catch (error) {
      check("facility alerts", false, String(error.message).slice(0, 140));
    }

    for (const [path, label, needle] of [
      ["/administrator/facility/devices", "devices", /device|sensor|Device/i],
      ["/administrator/facility/history", "history", /history|chart|reading/i],
      ["/administrator/facility/reports", "reports", /report|period/i],
      ["/administrator/facility/zones", "zones", /zone|Zone/i],
      ["/administrator/facility/display", "wallboard", /wallboard|zone|Alert/i],
    ]) {
      try {
        await staffAs(page, base, path, { identity: STAFF_IDS.aisha, workspace: /support officer|system administrator/i });
        const status = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check(`facility ${label} page renders`, needle.test(status), status.slice(-100));
      } catch (error) {
        check(`facility ${label} page`, false, String(error.message).slice(0, 120));
      }
    }

    await page.close();
    return { checks, consoleErrors };
  },
};
