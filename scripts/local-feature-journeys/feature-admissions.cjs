/**
 * Feature: admissions — applicant autosave/resume/submit/status plus the
 * staff request-changes → applicant edit → resubmit loop and offer decline.
 */
const { attachErrorCapture, staffAs } = require("./helpers.cjs");

const FILLS = [
  ["Place of birth", "Bandipora"],
  ["Date of birth", "2015-01-01"],
  ["Phone", "+91 94190 03003"],
  ["Email", "guardian.resubmit@example.com"],
  ["House & street", "School Road"],
  ["Village / town", "Bandipora"],
  ["District", "Bandipora"],
  ["PIN code", "193502"],
  ["Current or last school", "Govt Boys High School"],
];

async function fillVisibleStepFields(page) {
  for (const [label, value] of FILLS) {
    const field = page.getByLabel(label).first();
    if ((await field.count()) > 0 && (await field.isVisible().catch(() => false))) {
      await field.fill(value);
    }
  }
  const gender = page.getByLabel("Gender").first();
  if ((await gender.count()) > 0 && (await gender.isVisible().catch(() => false))) {
    await gender.selectOption({ index: 1 });
  }
  const rel = page.getByLabel("Relationship to the student").first();
  if ((await rel.count()) > 0 && (await rel.isVisible().catch(() => false))) {
    await rel.selectOption({ index: 1 });
  }
  const lastClass = page.getByLabel("Class last attended").first();
  if ((await lastClass.count()) > 0 && (await lastClass.isVisible().catch(() => false))) {
    await lastClass.selectOption({ index: 1 });
  }
}

module.exports = {
  async run(browser, base) {
    const page = await browser.newPage();
    const consoleErrors = [];
    attachErrorCapture(page, consoleErrors);
    const checks = [];
    const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

    /* Autosave + resume. */
    try {
      await page.goto(`${base}/apply/student`, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.reload({ waitUntil: "networkidle" });
      const cont = page.getByRole("button", { name: "Save & continue →" });
      await page.getByLabel("Academic session").selectOption("2026-27");
      await page.getByLabel("Class").selectOption("Class 6");
      await cont.click();
      await page.getByLabel("Full name").fill("Autosave Test Child");
      await page.waitForTimeout(900);
      const saved = (await page.locator("body").innerText()).toLowerCase();
      check("autosave indicator shown", saved.includes("saved"), saved.slice(-120));
      await page.goto(`${base}/apply/student`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const nameValue = await page.getByLabel("Full name").inputValue().catch(() => "");
      check("draft resumes after leaving", nameValue === "Autosave Test Child", `value="${nameValue}"`);
      await page.goto(`${base}/admissions/apply`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const resumeText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check(
        "resume panel on the admissions landing page",
        resumeText.includes("Draft in progress") && resumeText.includes("Continue application"),
        resumeText.slice(-120),
      );
    } catch (error) {
      check("autosave + resume", false, String(error.message).slice(0, 140));
    }

    /* Full submit → APP- reference + status timeline. */
    try {
      await page.goto(`${base}/apply/student`, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.reload({ waitUntil: "networkidle" });
      const cont = page.getByRole("button", { name: "Save & continue →" });
      await page.getByLabel("Academic session").selectOption("2026-27");
      await page.getByLabel("Class").selectOption("Class 6");
      await cont.click();
      await page.getByLabel("Full name").fill("Zoya Test Khan");
      await page.getByLabel("Date of birth").fill("2014-06-02");
      await page.getByLabel("Gender").selectOption("Female");
      await page.getByLabel("Place of birth").fill("Bandipora");
      await cont.click();
      await page.getByLabel("Parent / guardian name").fill("Nida Bhat");
      await page.getByLabel("Relationship to the student").selectOption("Mother");
      await page.getByLabel("Phone").fill("+91 94190 02002");
      await page.getByLabel("Email").fill("nida.bhat@example.com");
      await cont.click();
      await page.getByLabel("House & street").fill("Main Road");
      await page.getByLabel("Village / town").fill("Sumbal");
      await page.getByLabel("District").fill("Bandipora");
      await page.getByLabel("PIN code").fill("193501");
      await cont.click();
      await page.getByLabel("Current or last school").fill("Sumbal Public School");
      await page.getByLabel("Class last attended").selectOption("Class 5");
      await cont.click();
      await cont.click();
      for (const doc of ["Birth certificate", "Student photograph", "Previous report card", "Address proof"]) {
        await page.getByLabel(doc).setInputFiles({ name: "demo.pdf", mimeType: "application/pdf", buffer: Buffer.from("demo") });
      }
      await cont.click();
      await page.getByLabel(/I have read the declaration and confirm/).check();
      await page.getByRole("button", { name: "Submit application" }).click();
      await page.waitForURL(/\/apply\/student\/APP-\d{4}-\d{4}/, { timeout: 25000 });
      await page.getByText("Submitted", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
      const ref = (page.url().match(/APP-\d{4}-\d{4}/) ?? ["?"])[0];
      check("submission creates an APP reference", ref.startsWith("APP-"), ref);
      check("status timeline shows Submitted", (await page.locator("body").innerText()).includes("Submitted"));
    } catch (error) {
      check("full submit flow", false, String(error.message).slice(0, 140));
    }

    /* Step-1 validation blocks an empty form. */
    try {
      await page.goto(`${base}/apply/student`, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Save & continue →" }).click();
      await page.waitForTimeout(600);
      const body = (await page.locator("body").innerText()).toLowerCase();
      check("step 1 requires session + class", body.includes("required") || body.includes("select"), body.slice(-120));
    } catch (error) {
      check("step 1 validation", false, String(error.message).slice(0, 120));
    }

    /* Staff request-changes → applicant edits → resubmits. */
    try {
      await staffAs(page, base, "/principal/admissions/APP-2026-0421", { identity: "00000000-0000-4000-8000-000000000205" });
      const decision = page.getByRole("combobox", { name: "Decision" });
      await decision.waitFor({ state: "visible", timeout: 20000 });
      await decision.selectOption("change");
      await page.getByLabel(/Reason shown to applicant/).fill("The previous-school report card is unreadable, please re-upload it.");
      await page.getByRole("button", { name: "Review decision" }).click();
      await page.getByRole("button", { name: /Confirm · Request change/ }).click();
      await page.getByText(/Request change recorded/).waitFor({ state: "visible", timeout: 15000 });
      await page.waitForTimeout(400);
      check("staff requests changes with a reason", true);

      await page.goto(`${base}/apply/student/APP-2026-0421/status`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("applicant sees the changes-requested state", body.includes("Changes requested"), body.slice(-120));
      const editBtn = page.getByRole("link", { name: "Edit application" });
      if ((await editBtn.count()) > 0) {
        await editBtn.click();
        /* The editor restores the submitted context and opens on the first
           incomplete step, so the session/class are asserted from the visible
           wizard context rather than requiring step 1 to be the landing step. */
        await page.getByRole("button", { name: "Save & continue →" }).waitFor({ state: "visible", timeout: 20000 });
        const contextText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check("edit restores the submitted session and class", contextText.includes("Class 10") && contextText.includes("2026-27"), contextText.slice(0, 120));
        /* The editor opens on the first incomplete step; walk back to the
           student step through the rail when the restored draft advanced it,
           then assert the restored name. */
        let nameValue = "";
        const studentStep = page.getByRole("button", { name: /Student details/ });
        if ((await studentStep.count()) > 0 && (await page.locator("#studentName").count()) === 0) {
          await studentStep.first().click();
          await page.waitForTimeout(800);
        }
        if ((await page.locator("#studentName").count()) > 0) {
          nameValue = await page.locator("#studentName").inputValue().catch(() => "");
        }
        let guard = 0;
        while (guard < 12) {
          guard += 1;
          if (nameValue === "" && (await page.locator("#studentName").count()) > 0) {
            nameValue = await page.locator("#studentName").inputValue().catch(() => "");
          }
          const cont = page.getByRole("button", { name: "Save & continue →" });
          if ((await cont.count()) === 0) break;
          await page.waitForTimeout(500);
          await fillVisibleStepFields(page);
          if (nameValue === "" && (await page.locator("#studentName").count()) > 0) {
            nameValue = await page.locator("#studentName").inputValue().catch(() => "");
          }
          await cont.click();
          await page.waitForTimeout(700);
        }
        if (nameValue === "") {
          const reviewText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
          if (reviewText.includes("Rayan Dar")) nameValue = "Rayan Dar";
        }
        check("edit restores the student name", nameValue === "Rayan Dar", `name="${nameValue}"`);
        const files = page.locator('input[type="file"]');
        const fileCount = await files.count();
        for (let i = 0; i < fileCount; i += 1) {
          const input = files.nth(i);
          if (await input.isVisible().catch(() => false)) {
            await input.setInputFiles({ name: `document-${i}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`doc-${i}`) });
          }
        }
        guard = 0;
        while (guard < 12) {
          guard += 1;
          const cont = page.getByRole("button", { name: "Save & continue →" });
          if ((await cont.count()) === 0) break;
          await page.waitForTimeout(500);
          await fillVisibleStepFields(page);
          await cont.click();
          await page.waitForTimeout(700);
        }
        const submit = page.getByRole("button", { name: "Submit application" });
        if ((await submit.count()) > 0) {
          await page.getByLabel(/I have read the declaration and confirm/).check();
          await submit.click();
          await page.waitForTimeout(2500);
          const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
          check("resubmit after requested changes works", after.includes("Submitted") || after.includes("Under review"), after.slice(-120));
        } else {
          check("resubmit after requested changes works", false, "no Submit button reached");
        }
      } else {
        check("edit restores the submitted session and class", false, "no Edit application link");
      }
    } catch (error) {
      check("request-changes loop", false, String(error.message).slice(0, 140));
    }

    /* Offer decline. */
    try {
      await page.goto(`${base}/apply/student/APP-2026-0417/status`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const declineBtn = page.getByRole("button", { name: /Decline offer/ });
      if ((await declineBtn.count()) > 0) {
        await declineBtn.click();
        await page.waitForTimeout(600);
        const confirmBtn = page.getByRole("button", { name: /Decline the offer|Confirm decline/ });
        if ((await confirmBtn.count()) > 0) {
          await confirmBtn.click();
          await page.waitForTimeout(1000);
          const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
          check("offer decline works", after.includes("Offer declined") || after.includes("Declined"), after.slice(-120));
        } else {
          check("offer decline works", false, "no confirm button");
        }
      } else {
        check("offer decline works", false, "no Decline offer button");
      }
    } catch (error) {
      check("offer decline works", false, String(error.message).slice(0, 120));
    }

    /* Staff queue filter tabs. */
    try {
      await staffAs(page, base, "/principal/admissions", { identity: "00000000-0000-4000-8000-000000000205" });
      await page.waitForTimeout(1200);
      const tabs = await page.locator('button[role="tab"], .tabs button').count();
      check("admissions queue has status filter tabs", tabs >= 5, `${tabs} tabs`);
    } catch (error) {
      check("admissions queue status tabs", false, String(error.message).slice(0, 120));
    }

    await page.close();
    return { checks, consoleErrors };
  },
};
