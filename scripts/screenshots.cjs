/* Screenshot runner for design QA.
 * Requires playwright available via NODE_PATH, e.g.:
 *   NODE_PATH=/tmp/fass-shots/node_modules node scripts/screenshots.cjs
 */
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = "/Users/fin./Desktop/FASS/design/screenshots";

const shots = [
  { path: "70-home.png", url: "/", width: 1440, height: 900, fullPage: true },
  { path: "71-school-life.png", url: "/school-life", width: 1440, height: 900, fullPage: true },
  { path: "72-contact.png", url: "/contact", width: 1440, height: 900, fullPage: true },
  { path: "73-environment.png", url: "/environment", width: 1440, height: 900, fullPage: true },
  { path: "74-about.png", url: "/about", width: 1440, height: 900, fullPage: true },
  { path: "75-home-mobile.png", url: "/", width: 390, height: 844, fullPage: true },
  { path: "76-staff-mobile.png", url: "/staff", width: 390, height: 844, fullPage: true },
  { path: "78-portal-mobile.png", url: "/portal", width: 390, height: 844, fullPage: true },
];

(async () => {
  const browser = await chromium.launch();
  const results = [];

  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(String(err)));
    const res = await page.goto(BASE + shot.url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${shot.path}`, fullPage: shot.fullPage });
    results.push({ path: shot.path, status: res?.status(), errors });
    await page.close();
  }

  await browser.close();
  for (const r of results) {
    const size = fs.statSync(`${OUT}/${r.path}`).size;
    console.log(`${r.path} — ${r.status} — ${(size / 1024).toFixed(0)}KB — console errors: ${r.errors.length ? r.errors.join(" | ") : "none"}`);
  }
})();
