const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const viewports = [1920, 1440, 1311, 1310, 1280, 1120, 1024, 768, 390, 320];

(async () => {
  const browser = await chromium.launch();
  const failures = [];

  for (const width of viewports) {
    const page = await browser.newPage({ viewport: { width, height: width <= 390 ? 844 : 900 } });
    await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\/.*/, (route) => route.abort());
    const errors = [];
    page.on("console", (msg) => { if (msg.type() === "error" && !msg.text().includes("ERR_FAILED")) errors.push(msg.text()); });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const result = await page.evaluate(async () => {
      await document.fonts.ready;
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el || getComputedStyle(el).display === "none") return null;
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
      };
      const badIcons = [...document.querySelectorAll(".msym")].filter((el) => {
        const r = el.getBoundingClientRect();
        const size = Number.parseFloat(getComputedStyle(el).fontSize);
        return r.width > size + 1;
      }).map((el) => `${el.textContent}:${Math.round(el.getBoundingClientRect().width)}`);
      return {
        loaded: document.fonts.check('16px "Material Symbols Rounded"'),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        header: rect(".public-header-main .wrap"),
        nav: rect(".main-nav"),
        cta: rect(".head-cta"),
        burger: rect(".burger"),
        schoolLife: rect('[aria-labelledby="life-heading"] .wrap'),
        footer: rect(".public-footer-grid"),
        badIcons,
      };
    });

    if (!result.loaded) failures.push(`${width}px: local Material Symbols font not loaded`);
    if (result.badIcons.length) failures.push(`${width}px: icon names expanded: ${result.badIcons.slice(0, 4).join(", ")}`);
    if (result.scrollWidth - result.innerWidth > 1) failures.push(`${width}px: page overflow ${result.scrollWidth - result.innerWidth}px`);
    for (const [name, box] of Object.entries({ header: result.header, cta: result.cta, burger: result.burger, schoolLife: result.schoolLife, footer: result.footer })) {
      if (box && (box.left < -1 || box.right > width + 1)) failures.push(`${width}px: ${name} outside viewport ${JSON.stringify(box)}`);
    }
    if (width >= 1440 && result.footer && result.footer.width > 1322) failures.push(`${width}px: footer content is not constrained to the V15 wrap (${result.footer.width}px)`);
    if (width <= 1120 && result.nav !== null) failures.push(`${width}px: main nav should be collapsed`);
    if (width <= 1120 && result.burger === null) failures.push(`${width}px: burger should be visible`);
    if (width > 1120 && result.nav === null) failures.push(`${width}px: main nav should be visible`);
    if (errors.length) failures.push(`${width}px console: ${errors[0]}`);
    console.log(`${width}px — overflow ${result.scrollWidth - result.innerWidth}px — icons ${result.badIcons.length ? "BAD" : "ok"} — nav ${result.nav ? "visible" : "collapsed"}`);
    await page.close();
  }

  await browser.close();
  if (failures.length) {
    console.log("\nUI-2 SHELL FAILURES:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("\nUI-2 SHELL PASS: local icons, header, SchoolLife, footer, and breakpoint navigation fit all tested widths ✓");
})();
