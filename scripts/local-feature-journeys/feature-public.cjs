/**
 * Feature: public site — every route renders with key content, dynamic
 * routes resolve, the contact form exists, and no console errors appear.
 */
const { attachErrorCapture } = require("./helpers.cjs");

const ROUTES = [
  { path: "/", expect: ["Faiz E Aam", "Admissions"] },
  { path: "/about", expect: ["About"] },
  { path: "/academics", expect: ["Academics"] },
  { path: "/admissions", expect: ["Admissions"] },
  { path: "/school-life", expect: ["School life"] },
  { path: "/notices", expect: ["Notices"] },
  { path: "/careers", expect: ["Careers"] },
  { path: "/contact", expect: ["Contact"] },
  { path: "/disclosure", expect: ["Disclosure"] },
  { path: "/policies/privacy", expect: ["Privacy"] },
  { path: "/policies/accessibility", expect: ["Accessibility"] },
  { path: "/policies/fees-and-refunds", expect: ["Fees"] },
  { path: "/policies/terms", expect: ["Terms"] },
  { path: "/admissions/apply", expect: ["Apply"] },
];

module.exports = {
  async run(browser, base) {
    const page = await browser.newPage();
    const consoleErrors = [];
    attachErrorCapture(page, consoleErrors);
    const checks = [];
    const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

    for (const route of ROUTES) {
      try {
        await page.goto(`${base}${route.path}`, { waitUntil: "networkidle" });
        const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").toLowerCase();
        check(`route ${route.path}`, route.expect.every((needle) => body.includes(needle.toLowerCase())));
      } catch (error) {
        check(`route ${route.path}`, false, String(error.message).slice(0, 120));
      }
    }

    try {
      await page.goto(`${base}/notices`, { waitUntil: "networkidle" });
      const links = page.locator('a[href^="/notices/"]');
      if ((await links.count()) > 0) {
        await links.first().click();
        await page.waitForLoadState("networkidle");
        check("notice detail resolves", (await page.title()).length > 0);
      } else {
        check("notice detail resolves", false, "no notice links found");
      }
    } catch (error) {
      check("notice detail resolves", false, String(error.message).slice(0, 120));
    }

    try {
      await page.goto(`${base}/careers`, { waitUntil: "networkidle" });
      const links = page.locator('a[href^="/careers/"]');
      if ((await links.count()) > 0) {
        await links.first().click();
        await page.waitForLoadState("networkidle");
        check("vacancy detail resolves", (await page.title()).length > 0);
      } else {
        check("vacancy detail resolves", false, "no vacancy links found");
      }
    } catch (error) {
      check("vacancy detail resolves", false, String(error.message).slice(0, 120));
    }

    try {
      await page.goto(`${base}/contact`, { waitUntil: "networkidle" });
      check("contact page has a form", (await page.locator("form").count()) > 0);
    } catch (error) {
      check("contact page has a form", false, String(error.message).slice(0, 120));
    }

    await page.close();
    return { checks, consoleErrors };
  },
};
