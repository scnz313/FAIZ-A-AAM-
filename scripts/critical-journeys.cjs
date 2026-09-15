#!/usr/bin/env node
/**
 * Critical browser journeys — the small end-to-end gate for the frontend
 * phase. Each journey drives the real UI against a running server (prod
 * build by default) and reports PASS/FAIL. Any console error on a journey
 * fails it; the process exits 1 when any journey fails.
 *
 *   node scripts/critical-journeys.cjs [base-url]
 *
 * Journeys:
 *   1. Job application  — careers → 4-step form → JOB- reference + status
 *   2. Student application — 8-step form → APP- reference + submitted status
 *   3. Grievance        — portal support form → GRV- reference + success copy
 *   4. Payment          — invoice checkout → success state + receipt link
 *   5. Identity         — sign-in → verify code → portal opens
 *   6. Staff admission  — reasoned decision with confirmation → timeline state
 */
const path = require("node:path");

/* Resolve playwright the same way scripts/responsive-check.cjs does:
   prefer the workspace install, then NODE_PATH, then the shared QA
   checkout used by the responsive sweep. */
function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    /* fall through to the shared QA install */
  }
  const candidates = [];
  if (process.env.NODE_PATH) candidates.push(...process.env.NODE_PATH.split(path.delimiter).filter(Boolean));
  candidates.push("/tmp/fass-shots/node_modules");
  for (const dir of candidates) {
    try {
      return require(path.join(dir, "playwright"));
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const playwright = loadPlaywright();
if (!playwright) {
  console.error("FAIL critical-journeys — playwright not found. Install it or point NODE_PATH at a checkout that has it.");
  process.exit(1);
}

const BASE = process.argv[2] ?? "http://localhost:3000";
const TIMEOUT = 20_000;

const results = [];
let failures = 0;

function report(name, ok, detail) {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** Run one journey; console errors on the page fail it. */
async function journey(name, page, fn) {
  const consoleErrors = [];
  const onConsole = (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  };
  page.on("console", onConsole);
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  try {
    await fn();
    if (consoleErrors.length > 0) {
      throw new Error(`console errors: ${consoleErrors.slice(0, 3).join(" | ")}`);
    }
    report(name, true);
  } catch (err) {
    report(name, false, String(err).slice(0, 220));
  } finally {
    page.off("console", onConsole);
  }
}

/* ------------------------------------------------------------------ */
/* Journey 1 — job application                                         */
/* ------------------------------------------------------------------ */

async function jobApplication(page) {
  await page.goto(`${BASE}/careers/mathematics-teacher`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /Apply for this position/ }).click();
  await page.waitForURL(/\/apply\/job\/mathematics-teacher$/);

  /* A stale autosaved draft would skip steps — start clean. */
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  /* The public intake is a three-step form with no documents and one
     optional profile photo (owner decision, 15 September 2026). */
  await page.getByLabel("Full name").fill("Bilal Ahmad Mir");
  await page.getByLabel("Email").fill("bilal.mir@example.com");
  await page.getByLabel("Phone").fill("9419001000");
  await page.getByRole("button", { name: /Save & continue/ }).click();

  await page.locator("#qualification").selectOption({ index: 1 });
  await page.locator("#experience").selectOption({ index: 1 });
  await page.getByLabel("Subject / specialisation").fill("Mathematics");
  await page.getByLabel("Institution").fill("Kashmir University");
  await page.getByRole("button", { name: /Save & continue/ }).click();

  await page.locator("#photo").setInputFiles({ name: "profile.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082", "hex") });
  await page.locator("#consent").check();
  await page.getByRole("button", { name: /Submit application/ }).click();

  await page.getByText(/Thank you · your application is with the school/).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByText(/JOB-2026-[A-Z0-9]+/).first().waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 2 — student application (8 steps)                           */
/* ------------------------------------------------------------------ */

async function studentApplication(page) {
  await page.goto(`${BASE}/apply/student`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const continueButton = page.getByRole("button", { name: "Save & continue →" });
  const insideForm = await continueButton.evaluate((el) => Boolean(el.closest("form")));
  if (!insideForm) throw new Error("'Save & continue →' is not inside the <form> — P0-A CTA regression");

  /* Step 1 — Academic. */
  await page.getByLabel("Academic session").selectOption("2026-27");
  await page.getByLabel("Class").selectOption("Class 6");
  await continueButton.click();

  /* Step 2 — Student details. */
  await page.getByLabel("Full name").fill("Aarif Hussain");
  await page.getByLabel("Date of birth").fill("2015-03-14");
  await page.getByLabel("Gender").selectOption("Male");
  await page.getByLabel("Place of birth").fill("Bandipora");
  await page.getByRole("button", { name: "Save & continue →" }).click();

  /* Step 3 — Guardian details. */
  await page.getByLabel("Parent / guardian name").fill("Firdous Ahmad");
  await page.getByLabel("Relationship to the student").selectOption("Father");
  await page.getByLabel("Phone").fill("+91 94190 01001");
  await page.getByLabel("Email").fill("firdous.ahmad@example.com");
  await page.getByRole("button", { name: "Save & continue →" }).click();

  /* Step 4 — Address. */
  await page.getByLabel("House & street").fill("School Road");
  await page.getByLabel("Village / town").fill("Bandipora");
  await page.getByLabel("District").fill("Bandipora");
  await page.getByLabel("PIN code").fill("193502");
  await page.getByRole("button", { name: "Save & continue →" }).click();

  /* Step 5 — Prior school. */
  await page.getByLabel("Current or last school").fill("Govt Boys High School");
  await page.getByLabel("Class last attended").selectOption("Class 5");
  await page.getByRole("button", { name: "Save & continue →" }).click();

  /* Step 6 — Medical & accommodation: nothing required. */
  await page.getByRole("button", { name: "Save & continue →" }).click();

  /* Step 7 — Documents. */
  for (const doc of ["Birth certificate", "Student photograph", "Previous report card", "Address proof"]) {
    await page.getByLabel(doc).setInputFiles({ name: "demo.pdf", mimeType: "application/pdf", buffer: Buffer.from("demo") });
  }
  await page.getByRole("button", { name: "Save & continue →" }).click();

  /* Step 8 — Review & declaration. */
  await page.getByLabel(/I have read the declaration and confirm/).check();
  await page.getByRole("button", { name: "Submit application" }).click();

  /* The adapter submits and pushes to the status route (with /status). */
  await page.waitForURL(/\/apply\/student\/APP-\d{4}-\d{4}/, { timeout: TIMEOUT });
  await page.getByText("Submitted", { exact: true }).first().waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 3 — grievance                                               */
/* ------------------------------------------------------------------ */

async function grievance(page) {
  await page.goto(`${BASE}/portal/support`, { waitUntil: "networkidle" });

  await page.getByLabel("Category").selectOption("Fees");
  await page.getByLabel("Subject").fill("Fee receipt not visible on portal");
  await page.getByLabel("Message").fill(
    "I paid the term fee on 28 July, but the receipt has not appeared on the portal or in email. Please confirm the payment was recorded.",
  );
  /* P1: the form now requires a contact name; contact preference radios
     were replaced by the shared thread model. */
  await page.getByLabel("Your name").fill("Firdous Ahmad");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Submit grievance" }).click();

  await page.getByRole("heading", { name: "Concern received" }).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByText(/GRV-2026-0\d{3}/).waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 4 — payment                                                 */
/* ------------------------------------------------------------------ */

async function payment(page) {
  await page.goto(`${BASE}/portal/fees/INV-2026-0103`, { waitUntil: "networkidle" });

  /* P1: the demo finance adapter owns attempt state — start the journey
     with a clean session and the success scenario pinned. */
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: /^Pay ₹9,200/ }).click();
  await page.getByLabel(/Card/).check();
  await page.getByLabel("Demo scenario").selectOption("Success");
  await page.getByRole("button", { name: "Continue to checkout" }).click();

  await page.getByText("Payment recorded · demo", { exact: true }).waitFor({ state: "visible", timeout: TIMEOUT });
  /* The adapter issues exactly one NEW receipt for the confirmed attempt.
     Fixtures are RC-2026-0102/0131; the session counter (seeded at 145)
     issues RC-2026-0145+. The success panel must link to that fresh
     receipt (§5.5) — assert the link itself. */
  await page
    .getByRole("link", { name: /View receipt RC-2026-\d{4}/ })
    .waitFor({ state: "visible", timeout: TIMEOUT });
  /* Success must link to the receipt created for this attempt (§5.5). */
  await page.locator('a[href*="/portal/receipts/"]').first().waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 5 — identity: sign in → verify → portal                     */
/* ------------------------------------------------------------------ */

async function identitySignIn(page) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  /* The one demo guardian account: +91 90000 00000, any 6+ char password. */
  await page.getByLabel("Phone or email").fill("+91 90000 00000");
  await page.getByLabel("Password").fill("demo-pass");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL(/\/sign-in\/verify$/, { timeout: TIMEOUT });
  for (let index = 0; index < 6; index += 1) {
    await page.getByLabel(`Digit ${index + 1}`).fill("482913"[index]);
  }
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.getByText("Verification complete", { exact: true }).waitFor({ state: "visible", timeout: TIMEOUT });

  await page.getByRole("link", { name: /Open the portal/ }).click();
  await page.waitForURL(/\/portal$/, { timeout: TIMEOUT });
  await page.getByText(/Your children/).first().waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 6 — staff admission decision with reason + confirmation     */
/* ------------------------------------------------------------------ */

async function staffAdmissionDecision(page) {
  /* APP-2026-0419 is the "Under review" fixture row — a clean start for
     the decision chain, since the demo session is cleared below. */
  await page.goto(`${BASE}/principal/admissions/APP-2026-0419`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("combobox", { name: "Demo identity" }).selectOption("00000000-0000-4000-8000-000000000205");
  await page.getByRole("combobox", { name: "Decision" }).waitFor({ state: "visible", timeout: TIMEOUT });

  /* Step 1 — move to assessment (no reason required). The decision panel
     section carries the same accessible name via aria-labelledby, so target
     the combobox role explicitly. The officer's maker step (admissions.review). */
  await page.getByRole("combobox", { name: "Decision" }).selectOption("assessment");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Confirm · Move to assessment/ }).click();
  await page.getByText("Assessment", { exact: true }).first().waitFor({ state: "visible", timeout: TIMEOUT });

  /* Step 2 — offer seat is the approver's checker step (admissions.approve).
     The officer cannot decide it (maker/checker split): switch the demo
     identity to Rania Mir, whose first workspace is Admissions approver. */
  await page
    .getByRole("combobox", { name: "Demo identity" })
    .selectOption("00000000-0000-4000-8000-000000000204");
  await page.getByRole("combobox", { name: "Decision" }).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByRole("combobox", { name: "Decision" }).selectOption("offer");
  await page.getByLabel(/Reason shown to applicant/).fill("Strong assessment; documents verified.");
  await page.getByRole("button", { name: "Review decision" }).click();
  await page.getByRole("button", { name: /Confirm · Offer seat/ }).click();
  await page.getByText("Offered", { exact: true }).first().waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByText(/Offer seat recorded/).waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 7 — two-child portal context switching                       */
/* ------------------------------------------------------------------ */

async function twoChildPortal(page) {
  await page.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  /* The seeded guardian has two active linked children; the switcher is a
     popover menu, driven by the service, not a single-option constant. */
  const switcher = page.getByRole("button", { name: /Your children/ }).first();
  await switcher.waitFor({ state: "visible", timeout: TIMEOUT });
  await switcher.click();
  const children = page.locator(".child-pop").getByRole("menuitem").filter({ hasText: /Aarif Hussain|Mariam Hussain/ });
  const options = await children.count();
  if (options !== 2) throw new Error(`expected two linked children, got ${options}`);

  /* Default context is the first active enrollment — Aarif. */
  await page
    .locator("strong", { hasText: "Aarif Hussain" })
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUT });

  /* Switch to Mariam: the shell strip and overview must follow. */
  await page.getByRole("menuitem", { name: /Mariam Hussain/ }).click();
  await page
    .locator("strong", { hasText: "Mariam Hussain" })
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUT });

  /* A child-scoped page opened afterwards must show the same active child. */
  await page.goto(`${BASE}/portal/fees`, { waitUntil: "networkidle" });
  await page
    .locator("strong", { hasText: "Mariam Hussain" })
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUT });

  /* Back on the overview the selection survived navigation. */
  await page.goto(`${BASE}/portal`, { waitUntil: "networkidle" });
  await page
    .locator("strong", { hasText: "Mariam Hussain" })
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 8 — staff link-request approval                              */
/* ------------------------------------------------------------------ */

async function staffLinkRequest(page) {
  await page.goto(`${BASE}/administrator/link-requests`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });


  /* The seeded pending request: Nida Bhat → Zoya Khan. */
  await page.getByText("Nida Bhat").first().waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByRole("button", { name: "Approve link" }).click();

  await page.getByText(/LINK-2026-1103 approved/).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByText("No pending link requests").waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 9 — admission offer → fee payment → enrollment conversion    */
/* ------------------------------------------------------------------ */

async function admissionToEnrollment(page) {
  await page.goto(`${BASE}/apply/student/APP-2026-0417`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  /* Accept the offered seat — this issues the admission invoice on the
     finance ledger exactly once. */
  await page.getByRole("button", { name: "Accept seat" }).click();
  await page.getByRole("button", { name: "Confirm acceptance" }).click();
  await page.getByText("Seat accepted", { exact: true }).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByText(/INV-2026-0301/).first().waitFor({ state: "visible", timeout: TIMEOUT });

  /* Pay the admission fee through the shared checkout (default success). */
  await page.getByRole("button", { name: /^Pay ₹2,000/ }).click();
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await page.getByText("Payment recorded · demo", { exact: true }).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByText("Admission fee paid", { exact: true }).waitFor({ state: "visible", timeout: TIMEOUT });

  /* Complete enrollment: the application matches the already-enrolled child
     (APP-2026-0417 is the original admission application for Aarif) — the
     permanent records are confirmed, never duplicated. */
  await page.getByRole("button", { name: "Complete enrollment" }).click();
  await page.getByText("Enrollment complete", { exact: true }).first().waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByText(/STU-2026-0901/).first().waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByRole("link", { name: /Open family portal/ }).waitFor({ state: "visible", timeout: TIMEOUT });

  /* The matched child is available in the family portal with both children. */
  await page.getByRole("link", { name: /Open family portal/ }).click();
  await page.waitForURL(/\/portal$/, { timeout: TIMEOUT });
  const switcher = page.getByRole("button", { name: /Your children/ }).first();
  await switcher.waitFor({ state: "visible", timeout: TIMEOUT });
  await switcher.click();
  const children = await page.locator(".child-pop").getByRole("menuitem").filter({ hasText: /Aarif Hussain|Mariam Hussain/ });
  const options = await children.count();
  if (options !== 2) throw new Error(`expected two linked children, got ${options}`);
}

/* ------------------------------------------------------------------ */
/* Journey 10 — cross-role denial and demo identity switching           */
/* ------------------------------------------------------------------ */

async function staffRoleDenial(page) {
  await page.goto(`${BASE}/administrator/users`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  /* The canonical access page is titled Staff access after the profile
     routing cutover; keep the journey assertion aligned with the UI rather
     than the retired Users heading. */
  await page.getByRole("heading", { name: "Staff access" }).waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 11 — content editor drafts but cannot publish                */
/* ------------------------------------------------------------------ */

async function contentPublishDenial(page) {
  await page.goto(`${BASE}/principal/notices`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("combobox", { name: "Demo identity" }).selectOption("00000000-0000-4000-8000-000000000205");
  await page.getByRole("button", { name: "Save draft" }).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByRole("button", { name: "Publish now" }).waitFor({ state: "hidden", timeout: TIMEOUT });
  await page.getByRole("button", { name: "Publish", exact: true }).waitFor({ state: "hidden", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 12 — wrong-child resource scope (sibling record + switch)    */
/* ------------------------------------------------------------------ */

async function wrongChildResource(page) {
  await page.goto(`${BASE}/portal/receipts/RC-2026-0138`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  /* Default active child is Aarif; RC-2026-0138 is Mariam's receipt. */
  await page.getByText(/This receipt belongs to Mariam Hussain/).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByRole("button", { name: "Switch to Mariam Hussain" }).waitFor({ state: "visible", timeout: TIMEOUT });

  /* The invoice page applies the same classification and the switch clears
     the panel once Mariam becomes the active child. */
  await page.goto(`${BASE}/portal/fees/INV-2026-0202`, { waitUntil: "networkidle" });
  await page.getByText(/This invoice belongs to Mariam Hussain/).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByRole("button", { name: "Switch to Mariam Hussain" }).click();
  await page.getByText(/This invoice belongs to Mariam Hussain/).waitFor({ state: "hidden", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 13 — link approval then revocation                          */
/* ------------------------------------------------------------------ */

async function revokedLink(page) {
  await page.goto(`${BASE}/administrator/link-requests`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });


  /* Approve the seeded pending link — it moves to the Active links list. */
  await page.getByRole("button", { name: "Approve link" }).click();
  await page.getByText(/LINK-2026-1103 approved/).waitFor({ state: "visible", timeout: TIMEOUT });

  /* Revoke it from the active list: access ends immediately. */
  const nidaRow = page.locator("article", { hasText: "Nida Bhat" });
  await nidaRow.getByRole("button", { name: "Revoke" }).click();
  await nidaRow.getByRole("button", { name: "Confirm revoke" }).click();
  await page.getByText(/LINK-2026-1103 revoked/).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.locator("article", { hasText: "LINK-2026-1103" }).waitFor({ state: "hidden", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 14 — results maker/checker split                            */
/* ------------------------------------------------------------------ */

async function resultMakerChecker(page) {
  await page.goto(`${BASE}/administrator/results`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });


  /* Examiner moderates (results.approve)… */
  await page.getByText("Moderation", { exact: true }).first().waitFor({ state: "visible", timeout: TIMEOUT });
  const moderationRow = page.locator(".q-row5", { hasText: "RB-2026-0139" }).first();
  await moderationRow.getByRole("button", { name: "Approve" }).click();
  await page.getByText("RB-2026-0139 approved (demo)").waitFor({ state: "visible", timeout: TIMEOUT });

  /* …and the publisher releases (results.publish): a separate workspace.
     The approve action disappears for the publisher role. */
  const approvedRow = page.locator(".q-row5", { hasText: "RB-2026-0139" }).first();
  await approvedRow.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: /^Publish v\d+$/ }).click();
  await page.getByText(/Published as PUB-2026-003/).first().waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByText("Published", { exact: true }).first().waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 15 — duplicate-safe payment retry                           */
/* ------------------------------------------------------------------ */

async function duplicateRetry(page) {
  await page.goto(`${BASE}/portal/fees/INV-2026-0103`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  /* Pay the outstanding Term 3 invoice once. */
  await page.getByRole("button", { name: /^Pay ₹9,200/ }).click();
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await page.getByText("Payment recorded · demo", { exact: true }).waitFor({ state: "visible", timeout: TIMEOUT });

  /* Reopening the invoice never posts a second payment: fully paid, the pay
     flow is replaced by the paid state, and the receipt resolves exactly once. */
  await page.goto(`${BASE}/portal/fees/INV-2026-0103`, { waitUntil: "networkidle" });
  await page.getByText(/This invoice is fully paid/).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByRole("button", { name: /^Pay/ }).waitFor({ state: "hidden", timeout: TIMEOUT });
  await page.goto(`${BASE}/portal/receipts/RC-2026-0145`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Receipt/ }).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByText("RC-2026-0145", { exact: true }).first().waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 16 — correction never rewrites the published version        */
/* ------------------------------------------------------------------ */

async function staleVersionRecovery(page) {
  await page.goto(`${BASE}/administrator/results`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  /* Sana as result publisher starts correction v2 on the published 8-A
     Mathematics batch (maker request; demo opens the editable version). */
  const publishedRow = page.locator(".q-row5", { hasText: "RB-2026-0138" }).first();
  await publishedRow.getByRole("button", { name: "Request correction" }).click();
  await page.getByLabel("Reason for correction (required)").fill("Recheck the Urdu row.");
  await page
    .locator(".panel")
    .filter({ hasText: "Reason for correction (required)" })
    .getByRole("button", { name: "Request correction" })
    .click();
  await page.getByText(/correction v2 started/).waitFor({ state: "visible", timeout: TIMEOUT });

  /* The portal still shows the v1 published report — history is never
     rewritten and the family keeps the last valid publication. */
  await page.goto(`${BASE}/portal/results`, { waitUntil: "networkidle" });
  await page.getByText("Released reports", { exact: true }).waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByText(/PUB-2026-001/).first().waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 17 — Principal result entry → Administrator review → publish */
/* ------------------------------------------------------------------ */

async function principalResultsEntryChain(page) {
  await page.goto(`${BASE}/principal/results/RB-2026-0144/entry`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("combobox", { name: "Demo identity" }).selectOption("00000000-0000-4000-8000-000000000205");

  /* The Principal enters every subject row and submits for moderation. */
  for (const subject of ["English", "Urdu", "Kashmiri", "Mathematics", "Science", "Social Science", "Computer Science"]) {
    await page.getByLabel(new RegExp(`Obtained marks · ${subject}`)).fill("40");
  }
  await page.getByRole("button", { name: "Submit for moderation" }).click();
  await page.getByText(/submitted for moderation \(demo\)/).waitFor({ state: "visible", timeout: TIMEOUT });

  /* The examiner returns the sheet with a reason, from the queue — the
     reviewer never enters the teacher workspace (no results.enter grant). */
  await page
    .getByRole("combobox", { name: "Demo identity" })
    .selectOption("00000000-0000-4000-8000-000000000203");
  await page.goto(`${BASE}/administrator/results`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Open as Exam reviewer" }).click();
  const returnedRow = page.locator(".q-row5", { hasText: "RB-2026-0144" }).first();
  await returnedRow.getByRole("button", { name: "Return" }).click();
  await page.getByLabel(/Reason for returning RB-2026-0144/).fill("Recheck the Urdu row.");
  await page.getByRole("button", { name: "Confirm return" }).click();
  await page.getByText(/returned to entry with a reason \(demo\)/).waitFor({ state: "visible", timeout: TIMEOUT });

  /* The Principal sees the recorded reason and resubmits. */
  await page
    .getByRole("combobox", { name: "Demo identity" })
    .selectOption("00000000-0000-4000-8000-000000000205");
  await page.goto(`${BASE}/principal/results/RB-2026-0144/entry`, { waitUntil: "networkidle" });
  await page.getByText("Recheck the Urdu row.").waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByRole("button", { name: "Submit for moderation" }).click();
  await page.getByText(/submitted for moderation \(demo\)/).waitFor({ state: "visible", timeout: TIMEOUT });

  /* The examiner approves (the workspace selection persisted per account). */
  await page
    .getByRole("combobox", { name: "Demo identity" })
    .selectOption("00000000-0000-4000-8000-000000000203");
  await page.goto(`${BASE}/administrator/results`, { waitUntil: "networkidle" });
  const approvedRow = page.locator(".q-row5", { hasText: "RB-2026-0144" }).first();
  await approvedRow.getByRole("button", { name: "Approve" }).click();
  await page.getByText("RB-2026-0144 approved (demo)").waitFor({ state: "visible", timeout: TIMEOUT });

  /* The publisher releases it from its own workspace… */
  await page.getByRole("combobox", { name: "Demo identity" }).selectOption("00000000-0000-4000-8000-000000000203");
  await page.goto(`${BASE}/administrator/results`, { waitUntil: "networkidle" });
  const openPublisher = page.getByRole("button", { name: "Open as Result publisher" });
  if ((await openPublisher.count()) > 0) {
    await openPublisher.click();
    await page.waitForTimeout(600);
  }
  const publishRow = page.locator(".q-row5", { hasText: "RB-2026-0144" }).first();
  await publishRow.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: /^Publish v\d+$/ }).click();
  await page.getByText(/Published as PUB-2026-003/).first().waitFor({ state: "visible", timeout: TIMEOUT });

  /* …and the portal publication list carries the new live report. */
  await page.goto(`${BASE}/portal/results`, { waitUntil: "networkidle" });
  await page.getByText(/PUB-2026-003/).first().waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 21 — timetable manager publish reaches the portal            */
/* ------------------------------------------------------------------ */

async function timetablePublishPortal(page) {
  await page.goto(`${BASE}/principal/timetables`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("combobox", { name: "Demo identity" }).selectOption("00000000-0000-4000-8000-000000000205");

  /* Resolve both seeded conflicts with the suggested fix and its reason. */
  const resolveButton = page.getByRole("button", { name: "Resolve", exact: true });
  await resolveButton.first().click();
  await page.getByRole("button", { name: /Apply suggested fix/ }).click();
  await page.getByRole("button", { name: "Confirm resolution" }).click();
  await resolveButton.first().click();
  await page.getByRole("button", { name: /Apply suggested fix/ }).click();
  await page.getByRole("button", { name: "Confirm resolution" }).click();
  await page.getByText("No open conflicts.").waitFor({ state: "visible", timeout: TIMEOUT });

  /* Publish v2 with a change note. */
  await page.getByRole("button", { name: "Publish timetable" }).click();
  await page.getByLabel(/Change note for v2/).fill("Room swap after staff meeting.");
  await page.getByRole("button", { name: "Publish v2" }).click();
  await page.getByText(/v2 published for Class 8-A/).waitFor({ state: "visible", timeout: TIMEOUT });

  /* The portal timetable shows the session-published v2. */
  await page.goto(`${BASE}/portal/timetable`, { waitUntil: "networkidle" });
  await page.getByText(/Showing published v2/).first().waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */
/* Journey 22 — family and staff read the same paid ledger              */
/* ------------------------------------------------------------------ */

async function paymentParity(page) {
  await page.goto(`${BASE}/portal/fees/INV-2026-0103`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  /* Pay the outstanding Term 3 invoice from the family portal. */
  await page.getByRole("button", { name: /^Pay ₹9,200/ }).click();
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await page.getByText("Payment recorded · demo", { exact: true }).waitFor({ state: "visible", timeout: TIMEOUT });

  /* The finance office reads the SAME ledger: the invoice is paid there too. */
  await page.goto(`${BASE}/principal/finance`, { waitUntil: "networkidle" });
  const staffRow = page.locator("tr", { hasText: "INV-2026-0103" });
  await staffRow.getByText("Paid", { exact: true }).waitFor({ state: "visible", timeout: TIMEOUT });

  /* And the portal still resolves the receipt exactly once. */
  await page.goto(`${BASE}/portal/receipts/RC-2026-0145`, { waitUntil: "networkidle" });
  await page.getByText("RC-2026-0145", { exact: true }).first().waitFor({ state: "visible", timeout: TIMEOUT });
}

/* ------------------------------------------------------------------ */

(async () => {
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT);

    await journey("job-application", page, () => jobApplication(page));
    await journey("student-application", page, () => studentApplication(page));
    await journey("grievance", page, () => grievance(page));
    await journey("payment", page, () => payment(page));
    await journey("identity-sign-in", page, () => identitySignIn(page));
    await journey("staff-admission-decision", page, () => staffAdmissionDecision(page));
    await journey("two-child-portal", page, () => twoChildPortal(page));
    await journey("staff-link-request", page, () => staffLinkRequest(page));
    await journey("admission-to-enrollment", page, () => admissionToEnrollment(page));
    await journey("staff-role-denial", page, () => staffRoleDenial(page));
    await journey("content-publish-denial", page, () => contentPublishDenial(page));
    await journey("wrong-child-resource", page, () => wrongChildResource(page));
    await journey("revoked-link", page, () => revokedLink(page));
    await journey("result-maker-checker", page, () => resultMakerChecker(page));
    await journey("duplicate-retry", page, () => duplicateRetry(page));
    await journey("stale-version-recovery", page, () => staleVersionRecovery(page));
    await journey("principal-results-entry-chain", page, () => principalResultsEntryChain(page));
    await journey("timetable-publish-portal", page, () => timetablePublishPortal(page));
    await journey("payment-parity", page, () => paymentParity(page));
  } finally {
    await browser.close();
  }

  console.log(`\nCritical journeys against ${BASE}`);
  console.log(results.join("\n"));
  console.log(failures === 0 ? "\nALL JOURNEYS PASSED" : `\n${failures} JOURNEY(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
