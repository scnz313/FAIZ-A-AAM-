const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Sign in as Principal
  await page.goto("http://localhost:3000/sign-in/staff", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Principal/i }).click();
  await page.waitForURL(/\/principal/, { timeout: 15000 });
  await page.waitForTimeout(2000);
  console.log("PRINCIPAL URL:", page.url());

  const surfaces = [
    { path: "/principal", name: "Overview" },
    { path: "/principal/admissions", name: "Admissions" },
    { path: "/principal/careers", name: "Careers" },
    { path: "/principal/finance", name: "Finance" },
    { path: "/principal/results", name: "Results" },
    { path: "/principal/timetables", name: "Timetables" },
    { path: "/principal/academics/teachers", name: "Teaching records" },
    { path: "/principal/notices", name: "Notices" },
    { path: "/principal/content", name: "Content" },
    { path: "/principal/support", name: "Support" },
    { path: "/principal/documents", name: "Documents" },
  ];

  for (const surface of surfaces) {
    try {
      await page.goto(`http://localhost:3000${surface.path}`, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(1000);
      const info = await page.evaluate(() => {
        const h1 = document.querySelector("h1");
        const tables = document.querySelectorAll("table");
        const panels = document.querySelectorAll(".panel");
        const buttons = [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(t => t && t.length < 50);
        return {
          title: h1 ? h1.textContent.trim() : null,
          tableRows: tables.length > 0 ? tables[0].querySelectorAll("tbody tr").length : 0,
          panelCount: panels.length,
          actions: buttons.slice(0, 10),
          isDenied: document.body.innerText.includes("cannot open this area"),
          snippet: document.body.innerText.slice(0, 200),
        };
      });
      console.log(`${surface.name}: "${info.title}" rows=${info.tableRows} panels=${info.panelCount} denied=${info.isDenied}`);
      if (info.actions.length) console.log(`  actions: ${info.actions.join(", ")}`);
      await page.screenshot({ path: `/tmp/principal-${surface.name.toLowerCase().replace(/\s/g, "-")}.png`, fullPage: true }).catch(() => {});
    } catch (err) {
      console.log(`${surface.name}: ERROR ${err.message?.slice(0, 100)}`);
    }
  }

  // Also test what Principal is DENIED (Administrator-only areas)
  const deniedSurfaces = [
    { path: "/administrator/users", name: "Admin Users (denied)" },
    { path: "/administrator/settings", name: "Admin Settings (denied)" },
    { path: "/administrator/audit", name: "Admin Audit (denied)" },
  ];
  for (const surface of deniedSurfaces) {
    try {
      await page.goto(`http://localhost:3000${surface.path}`, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(1000);
      const denied = await page.evaluate(() => document.body.innerText.includes("cannot open") || document.body.innerText.includes("not available"));
      console.log(`${surface.name}: denied=${denied}`);
    } catch { /* redirect may throw */ }
  }

  await browser.close();
})();
