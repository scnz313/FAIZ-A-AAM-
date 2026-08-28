/* One-off verification: staff adds a date override → portal applies it. */
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://127.0.0.1:3002";
const TIMEOUT = 20000;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const failures = [];
  const check = (name, ok) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
    if (!ok) failures.push(name);
  };

  try {
    await page.goto(`${BASE}/staff/timetables`, { waitUntil: "networkidle" });
    await page.evaluate(() => sessionStorage.clear());
    await page.reload({ waitUntil: "networkidle" });

    await page.getByText("This workspace cannot open this area", { exact: true }).waitFor({ state: "visible", timeout: TIMEOUT });
    await page.getByRole("combobox", { name: "Demo identity" }).selectOption("00000000-0000-4000-8000-000000000205");
    await page.getByRole("button", { name: "Open as Timetable manager" }).click();

    /* Open the override form. */
    await page.getByRole("button", { name: "Add date-specific override" }).click();
    await page.getByRole("heading", { name: "Add an override for Class 8-A" }).waitFor({ state: "visible", timeout: TIMEOUT });

    /* Tuesday, period 14:15, substitute teacher N. Lone + subject. */
    await page.getByLabel("Day", { exact: true }).selectOption("Tuesday");
    await page.getByLabel("Period", { exact: true }).selectOption({ label: "14:15 — Physical education · T. Waza" });
    await page.getByLabel("Kind", { exact: true }).selectOption("substitute");
    await page.getByLabel("Substitute teacher", { exact: true }).fill("N. Lone");
    await page.getByLabel("Subject", { exact: true }).fill("Computer Science");
    await page.getByLabel(/^Reason/).fill("N. Lone covers Computer Science while M. Wani attends training.");
    await page.getByRole("button", { name: "Record override" }).click();

    await page.getByText(/OVR-2026-001 recorded/).waitFor({ state: "visible", timeout: TIMEOUT });
    check("staff records override", true);

    /* The override list shows the row. */
    const listHas = await page.getByText(/OVR-2026-001/).count();
    check("override listed", listHas > 0);

    /* Portal: Tuesday (4 Aug) shows the substitute; Monday (3 Aug) does not. */
    await page.goto(`${BASE}/portal/timetable`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Week" }).click();
    await page.getByRole("button", { name: "Tuesday", exact: true }).click();
    await page.getByText(/1 date override applies on Tuesday/).waitFor({ state: "visible", timeout: TIMEOUT });
    const tuesdaySubstitute = await page.getByText("N. Lone").count();
    check("portal Tuesday shows substitute", tuesdaySubstitute > 0);

    await page.getByRole("button", { name: "Monday", exact: true }).click();
    const mondayOverride = await page.getByText("date override applies", { exact: false }).count();
    check("portal Monday has no override notice", mondayOverride === 0);

    /* Revoke from staff side restores the base. */
    await page.goto(`${BASE}/staff/timetables`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await page.getByText(/OVR-2026-001 revoked/).waitFor({ state: "visible", timeout: TIMEOUT });
    check("staff revokes override", true);

    await page.goto(`${BASE}/portal/timetable`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Week" }).click();
    await page.getByRole("button", { name: "Tuesday", exact: true }).click();
    const revokedNotice = await page.getByText("date override applies", { exact: false }).count();
    check("portal Tuesday no override after revoke", revokedNotice === 0);

    /* Exam tab shows the dynamic range instead of the hardcoded dates. */
    await page.getByRole("button", { name: "Exam date sheet" }).click();
    const range = await page.getByText(/Mid-term examinations · /).textContent();
    check("exam range derived from fixture", range !== null && range.includes("September"));
  } catch (error) {
    console.log(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    failures.push("script error");
  } finally {
    await browser.close();
  }
  if (failures.length > 0) {
    console.log(`FAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("ALL OVERRIDE CHECKS PASSED");
})();
