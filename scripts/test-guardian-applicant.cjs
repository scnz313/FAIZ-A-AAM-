const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log("=== GUARDIAN PORTAL JOURNEY ===");

  // Sign in as Guardian
  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Guardian/i }).click();
  try { await page.waitForURL(/\/portal/, { timeout: 15000 }); } catch { /* may stay on sign-in */ }
  await page.waitForTimeout(3000);
  console.log("1. After guardian sign-in:", page.url());

  const portalText = await page.evaluate(() => document.body.innerText.slice(0, 800));
  console.log("   Portal text:", portalText.replace(/\n/g, " | ").slice(0, 400));

  // Test each guardian surface
  const surfaces = [
    { path: "/portal", name: "Overview" },
    { path: "/portal/fees", name: "Fees" },
    { path: "/portal/results", name: "Results" },
    { path: "/portal/timetable", name: "Timetable" },
    { path: "/portal/notices", name: "Notices" },
    { path: "/portal/documents", name: "Documents" },
    { path: "/portal/profile", name: "Profile" },
    { path: "/portal/security", name: "Security" },
    { path: "/portal/support", name: "Support" },
    { path: "/portal/link-child", name: "Link child" },
  ];

  for (const surface of surfaces) {
    try {
      await page.goto(`http://localhost:3000${surface.path}`, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(1500);
      const info = await page.evaluate(() => {
        const h1 = document.querySelector("h1");
        const tables = document.querySelectorAll("table");
        const panels = document.querySelectorAll(".panel");
        const text = document.body.innerText;
        return {
          title: h1 ? h1.textContent.trim() : null,
          tableRows: tables.length > 0 ? Math.max(...[...tables].map(t => t.querySelectorAll("tbody tr").length)) : 0,
          panels: panels.length,
          hasData: !text.includes("No ") && !text.includes("Nothing ") && !text.includes("Loading"),
          snippet: text.slice(0, 250),
        };
      });
      console.log(`   ${surface.name}: "${info.title}" rows=${info.tableRows} panels=${info.panels} hasData=${info.hasData}`);
      if (info.tableRows > 0 || info.panels > 0) {
        console.log(`     ${info.snippet.replace(/\n/g, " | ").slice(0, 180)}`);
      }
      await page.screenshot({ path: `/tmp/guardian-${surface.name.toLowerCase().replace(/\s/g, "-")}.png`, fullPage: true }).catch(() => {});
    } catch (err) {
      console.log(`   ${surface.name}: ERROR ${err.message?.slice(0, 80)}`);
    }
  }

  // Check child switcher
  console.log("\n2. Child switcher:");
  const childButton = page.getByRole("button", { name: /Your children/i });
  if (await childButton.count() > 0) {
    await childButton.click();
    await page.waitForTimeout(500);
    const menu = await page.evaluate(() => {
      const items = document.querySelectorAll('[role="menuitem"]');
      return [...items].map(i => i.textContent.trim().slice(0, 60));
    });
    console.log("   Children:", menu.join(" | "));
  } else {
    console.log("   No child switcher button found");
  }

  // Now test STUDENT APPLICANT journey
  console.log("\n=== STUDENT APPLICANT JOURNEY ===");
  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Student applicant/i }).click();
  await page.waitForTimeout(3000);
  console.log("3. After applicant sign-in:", page.url());
  const applicantText = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log("   Text:", applicantText.replace(/\n/g, " | ").slice(0, 250));

  // Try to start an application
  await page.goto("http://localhost:3000/apply/student", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  console.log("4. Wizard URL:", page.url());
  const wizardInfo = await page.evaluate(() => {
    const selects = document.querySelectorAll("select");
    const inputs = document.querySelectorAll("input:not([type=hidden])");
    const h2 = document.querySelector("h2");
    return {
      heading: h2 ? h2.textContent : null,
      selects: selects.length,
      inputs: inputs.length,
      text: document.body.innerText.slice(0, 300),
    };
  });
  console.log("   Wizard heading:", wizardInfo.heading);
  console.log("   Form fields:", wizardInfo.selects, "selects,", wizardInfo.inputs, "inputs");
  console.log("   Text:", wizardInfo.text.replace(/\n/g, " | ").slice(0, 200));

  await browser.close();
  console.log("\n=== JOURNEY COMPLETE ===");
})();
