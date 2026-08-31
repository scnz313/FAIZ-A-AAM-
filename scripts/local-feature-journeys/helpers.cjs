/**
 * Shared helpers for the local feature journeys: deterministic sign-in,
 * staff workspace/identity switching, console-error capture, and the
 * check() reporter. All journeys run against a local demo-mode server;
 * nothing here ever leaves localhost.
 */

const path = require("node:path");

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    const candidates = [];
    if (process.env.NODE_PATH) candidates.push(...process.env.NODE_PATH.split(path.delimiter).filter(Boolean));
    const root = path.resolve(__dirname, "..", "..");
    for (const candidate of [path.join(root, "node_modules"), path.join(root, "apps", "web", "node_modules")]) {
      if (candidates.includes(candidate)) continue;
      candidates.push(candidate);
    }
    for (const candidate of candidates) {
      try {
        return require(require.resolve("playwright", { paths: [candidate] }));
      } catch {
        /* try the next candidate */
      }
    }
    throw new Error("playwright is required for the local feature journeys.");
  }
}

/** The single demo guardian account: +91 90000 00000, any 6+ char password. */
const GUARDIAN_PHONE = "+91 90000 00000";
const GUARDIAN_PASSWORD = "demo-pass";
const VERIFY_CODE = "482913";

/** Demo staff identity ids (staff-authorization DEMO_STAFF_IDENTITIES). */
const STAFF_IDS = {
  sana: "00000000-0000-4000-8000-000000000203",
  firdous: "00000000-0000-4000-8000-000000000201",
  aisha: "00000000-0000-4000-8000-000000000204",
  rania: "00000000-0000-4000-8000-000000000205",
  naseer: "00000000-0000-4000-8000-000000000206",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function attachErrorCapture(page, sink) {
  page.on("console", (msg) => {
    if (msg.type() === "error") sink.push(`console: ${msg.text().slice(0, 160)}`);
  });
  page.on("pageerror", (err) => sink.push(`pageerror: ${String(err.message).slice(0, 160)}`));
}

async function signInGuardian(page, base, { clear = true } = {}) {
  await page.goto(`${base}/sign-in`, { waitUntil: "networkidle" });
  if (clear) {
    await page.evaluate(() => sessionStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
  }
  await page.getByLabel("Phone or email").fill(GUARDIAN_PHONE);
  await page.getByLabel("Password").fill(GUARDIAN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/sign-in\/verify$/, { timeout: 20000 });
  await page.getByLabel("Verification code").fill(VERIFY_CODE);
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.getByText("Verification complete", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("link", { name: /Open the portal/ }).click();
  await page.waitForURL(/\/portal$/, { timeout: 20000 });
}

/**
 * Open a staff route, clear the session, and switch the demo identity when
 * the route guard denies the default identity. `identity` is the demo
 * account id to select; `workspace` is a RegExp matched against the
 * "Open as …" buttons and the Workspace switcher options (used when the
 * granted identity has several workspaces).
 */
async function staffAs(page, base, targetPath, { identity = null, workspace = null } = {}) {
  await page.goto(`${base}${targetPath}`, { waitUntil: "networkidle" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const deny = page.getByText("This workspace cannot open this area", { exact: true });
  if (await deny.count() > 0) {
    if (identity !== null) {
      await page.getByRole("combobox", { name: "Demo identity" }).selectOption(identity);
      /* The guard re-renders after the identity switch; poll until the
         granted-workspace buttons appear or the route resolves. The denial
         can blink during the transition, so a resolved state is confirmed
         twice before we treat it as final. */
      let switched = false;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await page.waitForTimeout(500);
        const openAsButtons = page.getByRole("button", { name: /^Open as / });
        if ((await openAsButtons.count()) > 0) {
          let index = 0;
          if (workspace !== null) {
            const labels = await openAsButtons.allTextContents();
            const matched = labels.findIndex((label) => workspace.test(label));
            index = matched >= 0 ? matched : 0;
          }
          await openAsButtons.nth(index).click();
          switched = true;
          break;
        }
        if ((await deny.count()) === 0) {
          await page.waitForTimeout(500);
          if ((await deny.count()) === 0 && (await page.getByRole("button", { name: /^Open as / }).count()) === 0) break;
        }
      }
      if (!switched && (await deny.count()) > 0) {
        throw new Error(`Route ${targetPath} denied after identity switch with no workspace switch offered.`);
      }
      await page.waitForTimeout(1200);
    } else {
      const openAsButtons = page.getByRole("button", { name: /^Open as / });
      const count = await openAsButtons.count();
      if (count === 0) {
        throw new Error(`Route ${targetPath} denied with no workspace switch offered.`);
      }
      let index = 0;
      if (workspace !== null) {
        const labels = await openAsButtons.allTextContents();
        const matched = labels.findIndex((label) => workspace.test(label));
        index = matched >= 0 ? matched : 0;
      }
      await openAsButtons.nth(index).click();
      await page.waitForTimeout(1200);
    }
  }
  if (workspace !== null) {
    const select = page.getByRole("combobox", { name: "Workspace" });
    if (await select.count() > 0) {
      const options = await select.locator("option").allTextContents();
      const index = options.findIndex((label) => workspace.test(label));
      if (index >= 0) {
        const currentLabel = await select.locator("option:checked").textContent().catch(() => "");
        if (currentLabel !== options[index]) {
          await select.selectOption({ index });
          await page.waitForTimeout(1200);
        }
      }
    }
  }
  await page.waitForTimeout(600);
}

/** Deterministic wait: the row already exists and the write has landed. */
async function waitForServiceWrite(page, text) {
  await page.getByText(text).first().waitFor({ state: "visible", timeout: 15000 });
  await sleep(400);
}

module.exports = {
  GUARDIAN_PHONE,
  GUARDIAN_PASSWORD,
  VERIFY_CODE,
  STAFF_IDS,
  loadPlaywright,
  sleep,
  attachErrorCapture,
  signInGuardian,
  staffAs,
  waitForServiceWrite,
};
