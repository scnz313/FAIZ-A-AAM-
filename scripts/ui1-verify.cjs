/* UI-1 focused browser verification: drawer fix, panel :has() spacing, emblem.
 * Run: node scripts/ui1-verify.cjs [base-url]
 */
const { chromium } = require("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const TIMEOUT = 20_000;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(TIMEOUT);
  const failures = [];
  const check = (ok, msg) => { if (!ok) failures.push(msg); };

  try {
    /* Prove the UI no longer depends on Google Fonts for Material Symbols. */
    await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\/.*/, (route) => route.abort());

    /* Demo guardian sign-in → portal (mirrors critical-journeys identitySignIn). */
    await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
    await page.getByLabel(/Phone or email/).fill("+91 90000 00000");
    await page.getByLabel(/Password/).fill("demo-pass");
    await page.getByRole("button", { name: /Sign in/ }).click();
    await page.waitForURL(/\/sign-in\/verify$/, { timeout: TIMEOUT });
    /* The verify form uses six per-digit inputs (aria-label "Digit N"). */
    for (let i = 0; i < 6; i++) {
      await page.getByLabel(`Digit ${i + 1}`).fill("482913"[i]);
    }
    await page.getByRole("button", { name: /Verify and continue/ }).click();
    await page.getByText(/Verification complete|portal/i).first().waitFor({ state: "visible", timeout: TIMEOUT });
    await page.getByRole("link", { name: /Open the portal/ }).click();
    await page.waitForURL(/\/portal$/, { timeout: TIMEOUT });

    /* 1. Self-hosted icon font: loaded without Google, ligatures render into a
       one-em box, and the raw icon name cannot expand the layout. */
    const icon = await page.evaluate(async () => {
      await document.fonts.ready;
      const el = document.querySelector(".msym");
      const style = el ? getComputedStyle(el) : null;
      return {
        loaded: document.fonts.check('16px "Material Symbols Rounded"'),
        family: style?.fontFamily ?? null,
        width: el?.getBoundingClientRect().width ?? null,
        fontSize: style ? Number.parseFloat(style.fontSize) : null,
        overflow: style?.overflow ?? null,
      };
    });
    check(icon.loaded, "icons: self-hosted Material Symbols font did not load");
    check(icon.family?.includes("Material Symbols Rounded"), `icons: wrong font family ${icon.family}`);
    check(icon.width !== null && icon.fontSize !== null && Math.abs(icon.width - icon.fontSize) < 1, `icons: ligature box ${icon.width}px is not one em (${icon.fontSize}px)`);
    check(icon.overflow === "hidden", `icons: fallback ligature name is not clipped (${icon.overflow})`);

    /* 2. Drawer fix: open the nav drawer at 390px; the nav links must be visible. */
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.waitForTimeout(400);
    const drawer = await page.evaluate(() => {
      const side = document.querySelector(".app-shell .side");
      const nav = document.querySelector(".app-shell .side-nav");
      const link = nav ? nav.querySelector("a") : null;
      const vis = (el) => el ? getComputedStyle(el).visibility : null;
      return {
        sideOpen: side ? side.classList.contains("open") : false,
        navVisibility: vis(nav),
        linkVisibility: link ? vis(link) : null,
        linkBox: link ? link.getBoundingClientRect().toJSON() : null,
      };
    });
    check(drawer.sideOpen, "drawer: .side did not get .open");
    check(drawer.navVisibility === "visible", `drawer: side-nav visibility is ${drawer.navVisibility} (was the P0 hidden-nav bug)`);
    check(drawer.linkVisibility === "visible" && drawer.linkBox && drawer.linkBox.width > 0, "drawer: first nav link is not visible");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => !document.querySelector(".app-shell .side.open"));
    check(closed, "drawer: Escape did not close the drawer");

    /* 2. Panel :has() guard: a structured panel must have zero outer padding. */
    const panelPad = await page.evaluate(() => {
      const panel = document.querySelector(".panel:has(> .pn-head)");
      return panel ? getComputedStyle(panel).padding : null;
    });
    check(panelPad === "0px", `panel: structured panel outer padding is ${panelPad} (expected 0px)`);

    /* 3. Emblem: the header/ctx emblem renders as the eight-point star (path count). */
    const emblem = await page.evaluate(() => {
      const crest = document.querySelector(".app-shell .ctx-bar .crest svg");
      return crest ? { paths: crest.querySelectorAll("path").length, viewBox: crest.getAttribute("viewBox") } : null;
    });
    check(emblem && emblem.viewBox === "0 0 400 400", "emblem: ctx-bar crest is not the V15 400x400 emblem");
    check(emblem && emblem.paths >= 7, `emblem: expected ~7 paths, got ${emblem && emblem.paths}`);

    /* 4. Status badge single dot: exactly one ::before dot, no .status-dot child. */
    const badge = await page.evaluate(() => {
      const el = document.querySelector(".status-badge");
      if (!el) return null;
      return { hasDotChild: el.querySelector(".status-dot") !== null, beforeContent: getComputedStyle(el, "::before").content };
    });
    check(badge && !badge.hasDotChild, "badge: still renders an explicit .status-dot child (double dot)");
    check(badge && badge.beforeContent.includes("\"\""), "badge: ::before dot missing");

    /* 5. No horizontal overflow on the portal at 390px. */
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `portal 390px overflow: ${overflow}px`);
  } catch (error) {
    failures.push(String(error).slice(0, 300));
  } finally {
    await page.close();
    await browser.close();
  }

  if (failures.length) {
    console.log("UI-1 VERIFY FAILURES:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("UI-1 VERIFY PASS: drawer visible + Escape, panel :has() 0px, V15 emblem, single-dot badge, no 390px overflow ✓");
})();
