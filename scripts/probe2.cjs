/* Probe 2: find the element whose min-content forces a container wide.
 * Walks all elements, reports those with scrollWidth > clientWidth and
 * those with the largest min-content influence. */
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const route = process.argv[3] ?? "/staff/finance";
const width = Number(process.argv[4] ?? 390);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const report = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.scrollWidth - el.clientWidth > 2) {
        const cls = typeof el.className === "string" ? el.className : (el.getAttribute("class") ?? "");
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: String(cls).split(" ").slice(0, 2).join("."),
          clientW: el.clientWidth,
          scrollW: el.scrollWidth,
          overflowX: getComputedStyle(el).overflowX,
        });
      }
    }
    return out.slice(0, 12);
  });
  console.log(`${route} @ ${width} — scroll-overflowing elements:`);
  for (const o of report) console.log(JSON.stringify(o));
  console.log(`doc scrollWidth: ${await page.evaluate(() => document.documentElement.scrollWidth)}`);
  await browser.close();
})();
