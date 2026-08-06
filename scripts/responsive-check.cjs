/* Multi-resolution responsive audit.
 * For every viewport × route: checks horizontal overflow, console errors,
 * and logs the worst offending element when overflow exists.
 *   NODE_PATH=/tmp/fass-shots/node_modules node scripts/responsive-check.cjs
 */
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";

const viewports = [
  { label: "desktop-xl", width: 1920, height: 1080 },
  { label: "desktop", width: 1440, height: 900 },
  { label: "laptop", width: 1280, height: 800 },
  { label: "tablet-l", width: 1024, height: 768 },
  { label: "tablet-p", width: 768, height: 1024 },
  { label: "phone-l", width: 390, height: 844 },
  { label: "phone-m", width: 360, height: 800 },
  { label: "phone-s", width: 320, height: 568 },
];

const routes = [
  "/",
  "/about",
  "/academics",
  "/admissions",
  "/school-life",
  "/notices",
  "/notices/winter-air-quality-advisory",
  "/disclosure",
  "/careers",
  "/contact",
  "/apply/student",
  "/portal",
  "/portal/fees",
  "/portal/results",
  "/portal/timetable",
  "/staff",
  "/staff/admissions",
  "/staff/finance",
  "/staff/link-requests",
  "/staff/support",
  "/ui-states",
];

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  let checked = 0;

  for (const vp of viewports) {
    for (const route of routes) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const errors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(String(err)));

      try {
        const res = await page.goto(BASE + route, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        const metrics = await page.evaluate(() => {
          const doc = document.documentElement;
          const overflow = doc.scrollWidth - window.innerWidth;
          let worst = null;
          let worstOverflow = 0;
          if (overflow > 1) {
            for (const el of document.querySelectorAll("body *")) {
              const rect = el.getBoundingClientRect();
              const elOverflow = rect.right - window.innerWidth;
              if (elOverflow > worstOverflow && rect.width > 0 && getComputedStyle(el).position !== "fixed") {
                const style = getComputedStyle(el);
                if (style.display === "none" || style.visibility === "hidden") continue;
                worstOverflow = elOverflow;
                worst = `${el.tagName.toLowerCase()}.${(el.className && typeof el.className === "string" ? el.className.split(" ")[0] : "")}`;
              }
            }
          }
          return { scrollW: doc.scrollWidth, innerW: window.innerWidth, worst };
        });
        checked++;
        if (metrics.scrollW - metrics.innerW > 1) {
          problems.push(`${vp.label} ${route} — overflow ${metrics.scrollW - metrics.innerW}px via ${metrics.worst}`);
        }
        if (errors.length) {
          problems.push(`${vp.label} ${route} — console: ${errors.slice(0, 2).join(" | ")}`);
        }
      } catch (err) {
        problems.push(`${vp.label} ${route} — load error: ${String(err).slice(0, 120)}`);
      }
      await page.close();
    }
    console.log(`done ${vp.label}`);
  }

  await browser.close();
  console.log(`\nChecked ${checked} viewport×route pairs.`);
  console.log(problems.length === 0 ? "NO PROBLEMS FOUND ✓" : `\nPROBLEMS (${problems.length}):\n` + problems.join("\n"));
  if (problems.length > 0) process.exit(1);
})();
