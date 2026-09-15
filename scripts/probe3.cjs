/* Probe 3: list every element wider than 700px on a route. */
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const route = process.argv[3] ?? "/principal/finance";
const width = Number(process.argv[4] ?? 390);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const wide = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const w = el.clientWidth;
      if (w > 700) {
        const cls = typeof el.className === "string" ? el.className : (el.getAttribute("class") ?? "");
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: String(cls).split(" ").slice(0, 2).join("."),
          clientW: w,
          minW: getComputedStyle(el).minWidth,
          overflowX: getComputedStyle(el).overflowX,
        });
      }
    }
    return out.slice(0, 40);
  });
  console.log(`${route} @ ${width} — elements wider than 700px:`);
  for (const o of wide) console.log(JSON.stringify(o));
  await browser.close();
})();
