/* Multi-resolution screenshot set for the design QA record.
 *   NODE_PATH=/tmp/fass-shots/node_modules node scripts/screenshots-res.cjs
 */
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = "/Users/fin./Desktop/FASS/design/screenshots";

const shots = [
  { path: "80-home-1920.png", url: "/", width: 1920, height: 1080, fullPage: true },
  { path: "81-home-1440.png", url: "/", width: 1440, height: 900, fullPage: true },
  { path: "82-home-1280.png", url: "/", width: 1280, height: 800, fullPage: true },
  { path: "83-home-768.png", url: "/", width: 768, height: 1024, fullPage: true },
  { path: "84-home-390.png", url: "/", width: 390, height: 844, fullPage: true },
  { path: "85-home-320.png", url: "/", width: 320, height: 568, fullPage: true },
  { path: "86-fees-390.png", url: "/portal/fees", width: 390, height: 844, fullPage: true },
  { path: "87-administrator-320.png", url: "/administrator", width: 320, height: 568, fullPage: true },
];

(async () => {
  const browser = await chromium.launch();
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(String(err)));
    const res = await page.goto(BASE + shot.url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${shot.path}`, fullPage: shot.fullPage });
    const size = fs.statSync(`${OUT}/${shot.path}`).size;
    console.log(`${shot.path} — ${res?.status()} — ${(size / 1024).toFixed(0)}KB — errors: ${errors.length ? errors[0] : "none"}`);
    await page.close();
  }
  await browser.close();
})();
