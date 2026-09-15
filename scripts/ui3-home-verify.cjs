const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  for (const width of [1440, 1024, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 900 } });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) errors.push(m.text()); });
    await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
    const result = await page.evaluate(async () => {
      await document.fonts.ready;
      const icon = document.querySelector('[class*="ServiceRail"] .msym');
      return {
        font: document.fonts.check('16px "Material Symbols Rounded"'),
        iconBox: icon ? icon.getBoundingClientRect().width : 0,
        iconSize: icon ? Number.parseFloat(getComputedStyle(icon).fontSize) : 0,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        serviceRailIcons: document.querySelectorAll('[class*="ServiceRail"] .msym').length,
        heroReveal: document.querySelector(".reveal.d1") !== null,
        heroRevealCount: document.querySelectorAll(".reveal.d1,.reveal.d2,.reveal.d3,.reveal.d4,.reveal.d5").length,
        starOrn: document.querySelector('[class*="rcHead"] svg') !== null,
        trustRibbon: document.body.textContent.includes("affiliation pending verification"),
        stagesSecHead: document.querySelector('[aria-label="Learning stages"] .sec-head') !== null,
        stampText: document.body.textContent.includes("RECEIVED"),
      };
    });
    const pass = result.font && result.overflow <= 1 && result.serviceRailIcons >= 4 && result.heroReveal && result.heroRevealCount >= 5 && result.starOrn && !result.trustRibbon && result.stagesSecHead && result.stampText && result.iconBox <= result.iconSize + 1 && errors.length === 0;
    console.log(`${width}px ${JSON.stringify(result)}${errors.length ? " ERR:" + errors[0].slice(0, 60) : ""} ${pass ? "OK" : "FAIL"}`);
    if (!pass) process.exitCode = 1;
    await page.close();
  }
  await browser.close();
  console.log(process.exitCode ? "HOMEPAGE V15 CHECK FAIL" : "HOMEPAGE V15 CHECK PASS");
})();
