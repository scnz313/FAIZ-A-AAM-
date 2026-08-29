/**
 * Feature: identity & auth — routes render, recovery does not reveal
 * account existence, demo sign-in → verify → portal works, wrong passwords
 * fail safely, and the TOTP page shows the honest demo state.
 */
const { attachErrorCapture, signInGuardian } = require("./helpers.cjs");

module.exports = {
  async run(browser, base) {
    const page = await browser.newPage();
    const consoleErrors = [];
    attachErrorCapture(page, consoleErrors);
    const checks = [];
    const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

    for (const [path, needle] of [
      ["/sign-in", "Sign in"],
      ["/sign-in/verify", "code"],
      ["/sign-in/recovery", "Recovery"],
      ["/sign-in/totp", "Authenticator"],
      ["/sign-in/invite", "Invitation"],
      ["/register/applicant", "Applicant"],
      ["/session-expired", "Session"],
      ["/access-denied", "denied"],
    ]) {
      try {
        await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
        const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check(`route ${path}`, body.toLowerCase().includes(needle.toLowerCase()));
      } catch (error) {
        check(`route ${path}`, false, String(error.message).slice(0, 120));
      }
    }

    try {
      await page.goto(`${base}/sign-in/recovery`, { waitUntil: "networkidle" });
      await page.waitForSelector("#recovery-identifier", { state: "attached", timeout: 15000 });
      const idField = page.locator("#recovery-identifier");
      await idField.fill("+91 90000 00000");
      await page.getByRole("button", { name: "Start recovery" }).click();
      await page.waitForTimeout(800);
      const knownText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const knownHasCode = knownText.includes("RC-2026-");
      await page.goto(`${base}/sign-in/recovery`, { waitUntil: "networkidle" });
      await page.waitForSelector("#recovery-identifier", { state: "attached", timeout: 15000 });
      await idField.fill("+91 9999 999 999");
      await page.getByRole("button", { name: "Start recovery" }).click();
      await page.waitForTimeout(800);
      const unknownText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("recovery issues a reset reference for known identifier", knownHasCode, knownText.slice(-120));
      check("recovery never reveals account existence", unknownText.includes("RC-2026-"), unknownText.slice(-120));
    } catch (error) {
      check("recovery flow", false, String(error.message).slice(0, 140));
    }

    try {
      await signInGuardian(page, base);
      check("demo sign-in → verify → portal", page.url().endsWith("/portal"));
    } catch (error) {
      check("demo sign-in → verify → portal", false, String(error.message).slice(0, 140));
    }

    try {
      await page.goto(`${base}/sign-in`, { waitUntil: "networkidle" });
      await page.evaluate(() => sessionStorage.clear());
      await page.reload({ waitUntil: "networkidle" });
      await page.getByLabel("Phone or email").fill("+91 11111 11111");
      await page.getByLabel("Password").fill("demo-pass");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForTimeout(800);
      const body = (await page.locator("body").innerText()).toLowerCase();
      check(
        "wrong password shows a recoverable error",
        body.includes("check the phone number") || body.includes("incorrect") || body.includes("invalid"),
        body.slice(-140),
      );
    } catch (error) {
      check("wrong password shows a recoverable error", false, String(error.message).slice(0, 120));
    }

    try {
      await page.goto(`${base}/sign-in/totp`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").toLowerCase();
      check("totp page shows the demo state", body.includes("demo sign-in") && body.includes("back to sign-in"), body.slice(-120));
    } catch (error) {
      check("totp page shows the demo state", false, String(error.message).slice(0, 120));
    }

    await page.close();
    return { checks, consoleErrors };
  },
};
