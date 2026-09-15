const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log("=== JOB APPLICANT JOURNEY ===");
  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Job applicant/i }).click();
  await page.waitForTimeout(3000);
  console.log("1. Job applicant URL:", page.url());

  // Check public careers page
  await page.goto("http://localhost:3000/careers", { waitUntil: "networkidle" });
  const careersInfo = await page.evaluate(() => {
    const links = [...document.querySelectorAll("a")].filter(a => a.href.includes("/careers/")).map(a => ({ text: a.textContent.trim().slice(0, 60), href: a.getAttribute("href") }));
    const h2s = [...document.querySelectorAll("h2")].map(h => h.textContent.trim());
    return { vacancies: links, headings: h2s };
  });
  console.log("2. Careers vacancies:", JSON.stringify(careersInfo.vacancies.slice(0, 5)));
  console.log("   Headings:", careersInfo.headings.join(", "));

  // Try applying to a vacancy if one exists
  if (careersInfo.vacancies.length > 0) {
    const firstVacancy = careersInfo.vacancies[0].href;
    await page.goto(`http://localhost:3000${firstVacancy}`, { waitUntil: "networkidle" });
    console.log("3. Vacancy detail:", await page.evaluate(() => document.querySelector("h1")?.textContent));
    const applyBtn = page.getByRole("link", { name: /Apply/i });
    if (await applyBtn.count() > 0) {
      await applyBtn.click();
      await page.waitForTimeout(2000);
      console.log("4. Application URL:", page.url());
      const appText = await page.evaluate(() => document.body.innerText.slice(0, 300));
      console.log("   Text:", appText.replace(/\n/g, " | ").slice(0, 200));
    }
  } else {
    console.log("   No open vacancies found");
  }

  console.log("\n=== COMPLETE ADMISSION WIZARD (all 8 steps) ===");

  // Sign in as student applicant
  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
  // Clear any existing session first
  await page.evaluate(() => {
    document.cookie.split(";").forEach(c => {
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Student applicant/i }).click();
  await page.waitForURL(/apply\/student/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log("5. Wizard URL:", page.url());

  // Clear any existing draft
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  const stepResults = [];
  const fillStep = async (stepNum, name) => {
    try {
      const heading = await page.evaluate(() => document.querySelector("h2")?.textContent);
      console.log(`   Step ${stepNum} (${name}): heading="${heading}"`);

      // Fill fields based on step
      if (stepNum === 1) {
        // Academic: select session and class
        const session = page.getByLabel(/Academic session/i);
        if (await session.count() > 0) await session.selectOption({ index: 1 }).catch(() => {});
        const cls = page.getByLabel(/Class/i);
        if (await cls.count() > 0) {
          const opts = await cls.locator("option").allTextContents();
          console.log(`     Class options: ${opts.slice(0, 4).join(", ")}`);
          if (opts.length > 1) await cls.selectOption({ index: 1 });
        }
      } else if (stepNum === 2) {
        // Student details
        await page.getByLabel(/Full name/i).fill("Test Student Name").catch(() => {});
        await page.getByLabel(/Date of birth/i).fill("2015-03-14").catch(() => {});
        await page.getByLabel(/Gender/i).selectOption({ index: 1 }).catch(() => {});
      } else if (stepNum === 3) {
        // Guardian details
        await page.getByLabel(/Guardian.*name|Parent.*name/i).fill("Test Guardian").catch(() => {});
        await page.getByLabel(/Relationship/i).selectOption({ index: 1 }).catch(() => {});
        await page.getByLabel(/Phone/i).fill("+91 98765 43210").catch(() => {});
        await page.getByLabel(/Email/i).fill("test.guardian@example.com").catch(() => {});
      } else if (stepNum === 4) {
        // Address
        await page.getByLabel(/House|Street|Locality/i).fill("Test Address Line").catch(() => {});
        await page.getByLabel(/Village|Town/i).fill("Bandipora").catch(() => {});
        await page.getByLabel(/District/i).fill("Bandipora").catch(() => {});
        await page.getByLabel(/PIN/i).fill("193502").catch(() => {});
      } else if (stepNum === 5) {
        // Prior school - optional, just continue
      } else if (stepNum === 6) {
        // Medical - optional, just continue
      } else if (stepNum === 7) {
        // Documents - file uploads, skip for now
      } else if (stepNum === 8) {
        // Review & declaration
        const decl = page.getByLabel(/declaration|confirm/i);
        if (await decl.count() > 0) await decl.check().catch(() => {});
      }

      // Click Save & continue (or Submit on last step)
      const isLast = stepNum === 8;
      const btn = page.getByRole("button", { name: isLast ? /Submit/i : /Save & continue/i });
      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(2500);
        stepResults.push({ step: stepNum, name, ok: true, url: page.url() });
        return true;
      }
      stepResults.push({ step: stepNum, name, ok: false, reason: "no continue button" });
      return false;
    } catch (err) {
      stepResults.push({ step: stepNum, name, ok: false, reason: err.message?.slice(0, 80) });
      return false;
    }
  };

  for (let step = 1; step <= 8; step++) {
    const names = ["Academic", "Student", "Guardian", "Address", "Prior school", "Medical", "Documents", "Review"];
    const success = await fillStep(step, names[step - 1]);
    if (!success) {
      console.log(`   Step ${step} FAILED - stopping`);
      break;
    }
    if (page.url().includes("/status") || page.url().includes("APP-")) {
      console.log(`   Redirected to status page: ${page.url()}`);
      break;
    }
  }

  console.log("\n   Step results:", JSON.stringify(stepResults, null, 1));
  const finalUrl = page.url();
  console.log("   Final URL:", finalUrl);
  if (finalUrl.includes("status") || finalUrl.includes("APP-")) {
    const statusText = await page.evaluate(() => document.body.innerText.slice(0, 400));
    console.log("   STATUS:", statusText.replace(/\n/g, " | ").slice(0, 300));
  }
  await page.screenshot({ path: "/tmp/admission-final.png", fullPage: true }).catch(() => {});

  await browser.close();
  console.log("\n=== ALL JOURNEYS COMPLETE ===");
})();
