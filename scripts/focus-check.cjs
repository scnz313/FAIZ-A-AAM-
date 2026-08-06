#!/usr/bin/env node
/**
 * Focus and keyboard smoke checks for the retained frontend routes.
 *
 *   NODE_PATH=/tmp/fass-shots/node_modules node scripts/focus-check.cjs
 *
 * Uses Playwright against the production server. This is intentionally small:
 * it covers the shared drawer, skip link, document dialog, and print-preview
 * focus contracts that are easy to regress while changing layout chrome.
 */
const path = require("node:path");

function loadModule(name) {
  try {
    return require(name);
  } catch {
    const candidates = [];
    if (process.env.NODE_PATH) candidates.push(...process.env.NODE_PATH.split(path.delimiter).filter(Boolean));
    candidates.push("/tmp/fass-shots/node_modules");
    for (const directory of candidates) {
      try {
        return require(require.resolve(name, { paths: [directory] }));
      } catch {
        /* Try the next QA install. */
      }
    }
    return null;
  }
}

const playwright = loadModule("playwright");
if (!playwright) {
  console.error("FAIL focus smoke — playwright is required.");
  process.exit(1);
}

const BASE = process.argv[2] ?? "http://localhost:3000";

(async () => {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const menu = page.getByRole("button", { name: "Menu" });
    await menu.click();
    check((await page.locator("#public-nav.is-open").count()) === 1, "public mobile menu opens");
    check((await page.evaluate(() => document.body.style.overflow)) === "hidden", "mobile menu locks page scroll");
    check(await page.locator("#public-nav a").first().evaluate((element) => element === document.activeElement), "mobile menu moves focus inside drawer");
    await page.keyboard.press("Escape");
    check((await page.locator("#public-nav.is-open").count()) === 0, "Escape closes public mobile menu");
    check((await page.evaluate(() => document.body.style.overflow)) === "", "menu close restores page scroll");
    check(await menu.evaluate((element) => element === document.activeElement), "menu close returns focus to toggle");

    await page.goto(`${BASE}/ui-states`, { waitUntil: "networkidle" });
    await page.locator(".skip-link").focus();
    await page.keyboard.press("Enter");
    check((await page.evaluate(() => document.activeElement?.id)) === "main", "skip link focuses main content");

    await page.goto(`${BASE}/portal/documents`, { waitUntil: "networkidle" });
    const trigger = page.getByRole("button", { name: "Preview (demo)" }).first();
    await trigger.click();
    check((await page.getByRole("dialog").count()) === 1, "document preview opens");
    check(await page.getByRole("button", { name: "Close", exact: true }).evaluate((element) => element === document.activeElement), "document preview focuses close control");
    await page.keyboard.press("Escape");
    check((await page.getByRole("dialog").count()) === 0, "Escape closes document preview");
    check(await trigger.evaluate((element) => element === document.activeElement), "document preview returns focus to trigger");

    await page.goto(`${BASE}/portal/fees`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Statement \(PDF\)/ }).click();
    check(await page.locator("#statement-preview").evaluate((element) => element === document.activeElement), "statement preview receives focus");
    await page.getByRole("button", { name: "Close preview" }).click();
    check((await page.locator("#statement-preview").count()) === 0, "statement preview closes");
  } catch (error) {
    failures.push(String(error).slice(0, 240));
  } finally {
    await page.close();
    await browser.close();
  }

  if (failures.length > 0) {
    console.error("--- Focus smoke failures ---");
    console.error(failures.join("\n"));
    process.exit(1);
  }

  console.log("Focus smoke: drawer, skip link, document dialog, and statement preview PASS ✓");
})();
