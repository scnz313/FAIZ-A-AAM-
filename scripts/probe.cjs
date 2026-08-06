/* Debug probe: list widest elements on a route at a viewport. */
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const route = process.argv[3] ?? "/portal";
const width = Number(process.argv[4] ?? 390);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const offenders = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.right <= window.innerWidth) continue;
      const cls = typeof el.className === "string" ? el.className : (el.getAttribute("class") ?? "");
      const tag = el.tagName.toLowerCase();
      out.push({
        tag,
        cls: String(cls).split(" ").slice(0, 3).join("."),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        left: Math.round(rect.left),
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
      });
    }
    return out.slice(0, 8);
  });
  console.log(`${route} @ ${width}px — offenders:`);
  for (const o of offenders) console.log(JSON.stringify(o));
  await browser.close();
})();
