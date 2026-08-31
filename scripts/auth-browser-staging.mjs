#!/usr/bin/env node

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const envRaw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !match[2].startsWith("#")) env[match[1]] = match[2].trim();
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = env.SUPABASE_SECRET_KEY;
const baseUrl = process.env.FASS_BROWSER_BASE_URL ?? env.APP_URL ?? "http://localhost:3000";
if (!url || !publishableKey || !secretKey) throw new Error("Missing Supabase staging environment.");

function totpCode(secretB32, period = 30, digits = 6) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secretB32.replace(/=+$/, "")) {
    const value = alphabet.indexOf(char.toUpperCase());
    if (value < 0) throw new Error("Invalid authenticator secret.");
    bits += value.toString(2).padStart(5, "0");
  }
  const secret = Buffer.from(bits.match(/.{1,8}/g).map((chunk) => parseInt(chunk.padEnd(8, "0"), 2)));
  const counter = Math.floor(Date.now() / 1000 / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, "0");
}

const run = Date.now().toString(36);
const email = `browser.staff.${run}@example.in`;
const password = `Browser-${run}-A9`;
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (createError || !created.user) throw createError ?? new Error("Auth user was not created.");
const { data: person, error: personError } = await admin.from("people").insert({ given_name: "Browser", family_name: "Tester", display_name: `Browser Tester ${run}` }).select("id").single();
if (personError) throw personError;
const { error: accountError } = await admin.from("user_accounts").insert({ id: created.user.id, person_id: person.id, status: "active", verified_contact: email });
if (accountError) throw accountError;
const { error: grantError } = await admin.from("role_grants").insert({ account_id: created.user.id, role_code: "system_administrator", status: "active", effective_from: new Date().toISOString(), reason: "Fictional browser verification" });
if (grantError) throw grantError;
const { error: memberError } = await admin.from("staff_members").insert({ person_id: person.id, employment_status: "active", title: "Browser verification" });
if (memberError) throw memberError;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleMessages = [];
page.on("console", (msg) => consoleMessages.push(`${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => consoleMessages.push(`pageerror: ${err.message}`));
page.on("requestfailed", (req) => consoleMessages.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));
page.on("response", (response) => {
  if (response.url().includes("supabase.co/auth") || response.url().includes("/api/adapter") || response.url().includes("/api/auth/")) {
    consoleMessages.push(`response: ${response.status()} ${new URL(response.url()).pathname}`);
  }
});
try {
  await page.goto(`${baseUrl}/sign-in/staff`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#sign-in-identifier", { timeout: 15_000 });
  await page.getByLabel(/^Email/i).fill(email);
  await page.getByLabel(/^Password/i).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/sign-in\/totp/, { timeout: 30_000 });
  // Wait for the TOTP enrollment form to render
  await page.waitForSelector("#totp-code", { timeout: 15_000 });
  const secret = (await page.locator("code").first().textContent())?.trim();
  if (!secret) throw new Error("Authenticator setup secret was not rendered.");
  await page.getByLabel(/Six-digit code/i).fill(totpCode(secret));
  await page.getByRole("button", { name: /Finish setup and continue/i }).click();
  await page.waitForURL(new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/staff(?:$|/)`), { timeout: 30_000 });
  const content = await page.locator("body").innerText();
  if (content.includes("Demo session") || content.includes("Demo data")) throw new Error("Supabase staff shell still renders demo session copy.");
  if (!content.includes("Browser Tester")) throw new Error("The authenticated staff identity was not rendered.");
  await page.getByRole("button", { name: /^Sign out$/i }).click();
  await page.waitForURL(/\/sign-in\/staff/);
  await page.goto(`${baseUrl}/staff`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/sign-in\/staff/);
  console.log(`AUTH BROWSER SUITE PASSED (fictional run ${run})`);
} catch (error) {
  console.error("AUTH BROWSER SUITE FAILED:", error.message);
  console.error("Current URL:", page.url());
  const visibleAlert = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
  console.error("Visible alerts:", JSON.stringify(visibleAlert));
  const diagnostics = await page.evaluate(async () => {
    const call = async (op) => {
      const response = await fetch("/api/adapter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, payload: {} }),
      });
      const body = await response.json().catch(() => null);
      return { status: response.status, ok: body?.ok ?? false, value: body?.value ?? null, code: body?.errors?.[0]?.code ?? null, message: body?.errors?.[0]?.message ?? null };
    };
    return {
      hasAuthCookie: document.cookie.includes("sb-jxegiamjcawdywqyutdz-auth-token"),
      hasStaff: await call("identity.hasStaff"),
      staffContext: await call("context.staff"),
    };
  }).catch(() => null);
  console.error("Safe diagnostics:", JSON.stringify(diagnostics));
  if (consoleMessages.length > 0) {
    console.error("Browser console messages:");
    for (const msg of consoleMessages) console.error(`  ${msg}`);
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
