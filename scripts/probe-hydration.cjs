/* Catch the flaky hydration mismatch: navigate the same route sequence as
 * the responsive check, then when /staff/facility@320 errors, diff the
 * current DOM text against a fresh server fetch of the same route. */
const { chromium } = require("playwright");

const BASE = "http://localhost:3000";
const SEQUENCE = [
  "/", "/about", "/admissions", "/careers", "/contact", "/environment",
  "/apply/student", "/portal", "/portal/fees", "/portal/results",
  "/staff", "/staff/admissions", "/staff/finance", "/staff/facility",
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  for (const route of SEQUENCE) {
    errors.length = 0;
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(350);
    if (route === "/staff/facility" && errors.length) {
      console.log("ERROR on /staff/facility:", errors[0].slice(0, 100));
      const diff = await page.evaluate(async () => {
        const fresh = await fetch("/staff/facility", { headers: { "x-diff-probe": "1" } }).then((r) => r.text());
        const holder = document.createElement("div");
        holder.innerHTML = fresh;
        const serverText = holder.querySelector("body")?.innerText ?? "";
        const clientText = document.body.innerText ?? "";
        const sLines = serverText.split("\n");
        const cLines = clientText.split("\n");
        const out = [];
        for (let i = 0; i < Math.max(sLines.length, cLines.length); i++) {
          if (sLines[i] !== cLines[i]) {
            out.push(`L${i} server: ${JSON.stringify(sLines[i])}`);
            out.push(`L${i} client: ${JSON.stringify(cLines[i])}`);
            if (out.length > 8) break;
          }
        }
        return out;
      });
      console.log(diff.join("\n"));
      break;
    }
  }
  if (!errors.length) console.log("no error caught this run");
  await browser.close();
})();
