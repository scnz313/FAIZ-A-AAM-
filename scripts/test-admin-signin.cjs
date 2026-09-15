const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) console.log("NAV:", page.url());
  });
  await page.goto("http://localhost:3000/sign-in/staff", { waitUntil: "networkidle" });
  console.log("START:", page.url());
  await page.getByRole("button", { name: /Administrator/i }).click();
  await page.waitForTimeout(8000);
  console.log("FINAL:", page.url());
  try {
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 1200));
    console.log("PAGE TEXT:", txt);
  } catch (e) {
    console.log("evaluate error (page may still be loading):", e.message?.slice(0, 100));
  }
  await page.screenshot({ path: "/tmp/admin-signin.png", fullPage: true }).catch(() => {});
  await browser.close();
})();
