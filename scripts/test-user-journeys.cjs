const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log("=== APPLICANT JOURNEY: Student admission ===");

  // 1. Public admissions page
  await page.goto("http://localhost:3000/admissions", { waitUntil: "networkidle" });
  console.log("1. Admissions page:", await page.evaluate(() => document.querySelector("h1")?.textContent));

  // 2. Start application
  await page.goto("http://localhost:3000/admissions/apply", { waitUntil: "networkidle" });
  console.log("2. Apply page:", await page.evaluate(() => document.querySelector("h1")?.textContent));
  const applyText = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log("   Content:", applyText.replace(/\n/g, " | ").slice(0, 200));

  // 3. Go to the wizard
  await page.goto("http://localhost:3000/apply/student", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  console.log("3. Wizard URL:", page.url());
  const wizardText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log("   Wizard:", wizardText.replace(/\n/g, " | ").slice(0, 300));

  // Check if we can interact with the form
  const formFields = await page.evaluate(() => {
    const selects = document.querySelectorAll("select");
    const inputs = document.querySelectorAll("input:not([type=hidden])");
    const buttons = [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(t => t);
    return { selects: selects.length, inputs: inputs.length, buttons: buttons.slice(0, 10) };
  });
  console.log("4. Form fields:", JSON.stringify(formFields));

  // Try to fill step 1 (Academic)
  try {
    const sessionSelect = page.getByLabel(/Academic session/i);
    if (await sessionSelect.count() > 0) {
      await sessionSelect.selectOption({ index: 1 }).catch(() => {});
      console.log("   Selected session");
    }
    const classSelect = page.getByLabel(/Class/i);
    if (await classSelect.count() > 0) {
      const options = await classSelect.locator("option").allTextContents();
      console.log("   Class options:", options.slice(0, 5).join(", "));
      if (options.length > 1) await classSelect.selectOption({ index: 1 });
    }
    // Click continue
    const continueBtn = page.getByRole("button", { name: /Save & continue|Continue/i });
    if (await continueBtn.count() > 0) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
      console.log("5. After step 1:", page.url());
      const step2 = await page.evaluate(() => document.body.innerText.slice(0, 300));
      console.log("   Step 2:", step2.replace(/\n/g, " | ").slice(0, 200));
    }
  } catch (err) {
    console.log("   Step 1 error:", err.message?.slice(0, 100));
  }

  // 4. Check the guardian portal
  console.log("\n=== GUARDIAN PORTAL ===");
  await page.goto("http://localhost:3000/portal", { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
  console.log("Portal URL:", page.url());
  const portalText = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log("Portal:", portalText.replace(/\n/g, " | ").slice(0, 250));

  // 5. Check guardian sign-in
  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
  console.log("\n=== GUARDIAN SIGN-IN ===");
  const signinText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log("Sign-in:", signinText.replace(/\n/g, " | ").slice(0, 300));
  const signinButtons = await page.evaluate(() => [...document.querySelectorAll("button")].map(b => b.textContent.trim()).filter(t => t && t.length < 50));
  console.log("Buttons:", signinButtons.join(", "));

  // 6. Check notices (public content)
  await page.goto("http://localhost:3000/notices", { waitUntil: "networkidle" });
  console.log("\n=== PUBLIC NOTICES ===");
  const noticeCount = await page.evaluate(() => document.querySelectorAll("[class*='row'], [class*='notice'], li").length);
  const noticeText = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log("Notices:", noticeText.replace(/\n/g, " | ").slice(0, 200));

  // 7. Check careers (public)
  await page.goto("http://localhost:3000/careers", { waitUntil: "networkidle" });
  console.log("\n=== PUBLIC CAREERS ===");
  const careersText = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log("Careers:", careersText.replace(/\n/g, " | ").slice(0, 200));

  await browser.close();
  console.log("\n=== JOURNEY TEST COMPLETE ===");
})();
