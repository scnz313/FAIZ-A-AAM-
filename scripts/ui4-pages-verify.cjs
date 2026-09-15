const { chromium } = require("playwright");

const routes = [
  "/about", "/academics", "/admissions", "/school-life", "/notices",
  "/careers", "/contact", "/disclosure", "/policies/privacy",
  "/policies/terms", "/policies/fees-and-refunds", "/policies/accessibility",
];

(async () => {
  const browser = await chromium.launch();
  const failures = [];
  for (const route of routes) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) errors.push(m.text()); });
    await page.goto("http://localhost:3000" + route, { waitUntil: "networkidle" });
    const result = await page.evaluate(() => {
      /* Ledger tables intentionally scroll horizontally inside .table-wrap on
         narrow screens; the page itself must not clip. Check that any
         document-level scrollWidth excess comes only from table-wrap regions. */
      const excess = document.documentElement.scrollWidth - window.innerWidth;
      let pageOverflow = excess;
      if (excess > 1) {
        for (const wrap of document.querySelectorAll(".table-wrap")) {
          if (wrap.scrollWidth > wrap.clientWidth) {
            /* If every overflowing element is inside a table-wrap, the page
               layout is correct; the table scrolls internally. */
            const allInWrap = [...document.querySelectorAll("body *")].every((el) => {
              const r = el.getBoundingClientRect();
              if (r.right <= window.innerWidth + 1 || r.width === 0) return true;
              const s = getComputedStyle(el);
              if (s.display === "none" || s.visibility === "hidden" || s.position === "fixed") return true;
              return wrap.contains(el);
            });
            if (allInWrap) { pageOverflow = 0; break; }
          }
        }
      }
      return {
        overflow: pageOverflow,
        rawExcess: excess,
        kicker: document.querySelector('[class*="PageIntro"] [class*="kicker"]') !== null,
        title: document.querySelector("h1") !== null,
        ornament: document.querySelector(".ornament-rule") !== null,
      };
    });
    const pass = result.overflow <= 1 && result.kicker && result.title && !result.ornament && errors.length === 0;
    if (!pass) failures.push(`${route} ${JSON.stringify(result)}${errors.length ? " ERR" : ""}`);
    console.log(`${route} ${pass ? "OK" : "FAIL"} ${JSON.stringify(result)}`);
    await page.close();
  }
  await browser.close();
  if (failures.length) {
    console.log("\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("PUBLIC PAGES V15 CHECK PASS");
})();
