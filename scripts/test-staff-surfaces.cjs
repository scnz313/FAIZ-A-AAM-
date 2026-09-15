const { chromium } = require("playwright");

/** Walk each staff surface as the Administrator and record what renders,
 *  what data appears, and what actions are available. */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Sign in as Administrator
  await page.goto("http://localhost:3000/sign-in/staff", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Administrator/i }).click();
  await page.waitForURL(/\/administrator/, { timeout: 15000 });
  await page.waitForTimeout(2000);

  const surfaces = [
    { path: "/administrator", name: "Overview" },
    { path: "/administrator/users", name: "Users" },
    { path: "/administrator/link-requests", name: "Guardian links" },
    { path: "/administrator/settings", name: "Settings" },
    { path: "/administrator/audit", name: "Audit" },
    { path: "/administrator/data/imports", name: "Imports" },
    { path: "/administrator/data/exports", name: "Exports" },
    { path: "/administrator/admissions", name: "Admissions" },
    { path: "/administrator/careers", name: "Careers" },
    { path: "/administrator/finance", name: "Finance" },
    { path: "/administrator/results", name: "Results" },
    { path: "/administrator/notices", name: "Notices" },
    { path: "/administrator/content", name: "Content" },
    { path: "/administrator/documents", name: "Documents" },
  ];

  const results = {};
  for (const surface of surfaces) {
    try {
      await page.goto(`http://localhost:3000${surface.path}`, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(1000);
      const info = await page.evaluate(() => {
        const h1 = document.querySelector("h1");
        const tables = document.querySelectorAll("table");
        const panels = document.querySelectorAll(".panel");
        const buttons = [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(t => t && t.length < 40);
        const empty = document.body.innerText.includes("No ") || document.body.innerText.includes("Nothing ");
        return {
          title: h1 ? h1.textContent.trim() : null,
          tables: tables.length,
          rows: tables.length > 0 ? tables[0].querySelectorAll("tbody tr").length : 0,
          panels: panels.length,
          actions: buttons.slice(0, 12),
          hasEmpty: empty,
          text: document.body.innerText.slice(0, 300),
        };
      });
      results[surface.name] = info;
      console.log(`${surface.name}: title="${info.title}" tables=${info.tables} rows=${info.rows} panels=${info.panels} empty=${info.hasEmpty}`);
      console.log(`  actions: ${info.actions.join(", ")}`);
      await page.screenshot({ path: `/tmp/staff-${surface.name.toLowerCase().replace(/\s/g, "-")}.png`, fullPage: true }).catch(() => {});
    } catch (err) {
      console.log(`${surface.name}: ERROR ${err.message?.slice(0, 100)}`);
      results[surface.name] = { error: err.message?.slice(0, 200) };
    }
  }

  await browser.close();
  console.log("\n=== SUMMARY ===");
  for (const [name, info] of Object.entries(results)) {
    console.log(`${name}: ${info.error ? "ERROR" : `OK (${info.rows} rows, ${info.panels} panels)`}`);
  }
})();
