const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://localhost:3000/sign-in/staff", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Administrator/i }).click();
  await page.waitForURL(/admin/, { timeout: 15000 });
  for (const path of ["/administrator/users", "/administrator/audit"]) {
    await page.goto("http://localhost:3000" + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const info = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      const wrap = document.querySelector(".table--scroll");
      return { overflow, wrapClient: wrap?.clientWidth, wrapScroll: wrap?.scrollWidth };
    });
    console.log(path.split("/").pop() + ":", JSON.stringify(info));
  }
  await browser.close();
})();
