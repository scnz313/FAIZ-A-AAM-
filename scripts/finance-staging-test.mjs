#!/usr/bin/env node
/**
 * C5.6 finance sandbox verification (plan.md §C5.6).
 * Tests concession, adjustment maker-checker, refund flow, and reconciliation.
 * Fictional data only (plan.md §14).
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

const envRaw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !match[2].startsWith("#")) env[match[1]] = match[2].trim();
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = env.SUPABASE_SECRET_KEY;
if (!url || !publishableKey || !secretKey) {
  console.error("Missing Supabase env in .env.local");
  process.exit(1);
}

let failures = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); } else { failures += 1; console.error(`  ✗ ${label}`); }
}

function totpCode(secretB32, period = 30, digits = 6) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secretB32.replace(/=+$/, "")) {
    const value = alphabet.indexOf(char.toUpperCase());
    if (value < 0) throw new Error(`invalid base32 char ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const secret = Buffer.from(bits.match(/.{1,8}/g).map((chunk) => parseInt(chunk.padEnd(8, "0"), 2)));
  const counter = Math.floor(Date.now() / 1000 / period);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, "0");
  return code;
}

async function rpc(client, fn, args) {
  const { data, error } = await client.schema("app").rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

const RUN = Date.now().toString(36);
const PASSWORD = `Test-${RUN}-x9!`;
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`Finance sandbox run ${RUN} against ${url}`);

/* --- 1. create actors --- */
console.log("\n== 1. create fictional actors");
async function createActor(email, displayName, givenName) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  await admin.from("people").insert({ given_name: givenName, family_name: "Finance", display_name: displayName });
  const { data: person } = await admin.from("people").select("id").eq("display_name", displayName).maybeSingle();
  await admin.from("user_accounts").insert({ id: data.user.id, person_id: person.id, status: "active", verified_contact: email });
  return { userId: data.user.id, personId: person.id };
}

async function elevateClient(client) {
  const { data: enroll, error } = await client.auth.mfa.enroll({ factorType: "totp" });
  if (error) throw error;
  const { data: challenge, error: ce } = await client.auth.mfa.challenge({ factorId: enroll.id });
  if (ce) throw ce;
  const { error: ve } = await client.auth.mfa.verify({ factorId: enroll.id, challengeId: challenge.id, code: totpCode(enroll.totp.secret) });
  if (ve) throw ve;
  return client;
}

const guardian = await createActor(`itg.fin.guardian.${RUN}@example.in`, `Finance Guardian ${RUN}`, "FinGuardian");
const officer = await createActor(`itg.fin.officer.${RUN}@example.in`, `Finance Officer ${RUN}`, "FinOfficer");
const approver = await createActor(`itg.fin.approver.${RUN}@example.in`, `Finance Approver ${RUN}`, "FinApprover");

await admin.from("role_grants").insert({ account_id: guardian.userId, role_code: "guardian", status: "active", effective_from: new Date().toISOString() });
await admin.from("role_grants").insert({ account_id: officer.userId, role_code: "finance_officer", status: "active", effective_from: new Date().toISOString() });
await admin.from("role_grants").insert({ account_id: officer.userId, role_code: "admissions_officer", status: "active", effective_from: new Date().toISOString() });
await admin.from("role_grants").insert({ account_id: approver.userId, role_code: "finance_approver", status: "active", effective_from: new Date().toISOString() });
await admin.from("staff_members").insert({ person_id: officer.personId, employment_status: "active", title: "Finance Officer" });
await admin.from("staff_members").insert({ person_id: approver.personId, employment_status: "active", title: "Finance Approver" });
await admin.from("guardians").insert({ person_id: guardian.personId, status: "active" });
assert(true, "guardian, officer, approver accounts created");

/* --- 2. create invoice via sandbox payment --- */
console.log("\n== 2. create paid invoice");
const guardianClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
await guardianClient.auth.signInWithPassword({ email: `itg.fin.guardian.${RUN}@example.in`, password: PASSWORD });

const { data: years } = await admin.from("academic_years").select("id,label").eq("label", "2026-27");
const { data: grades } = await admin.from("grades").select("id,code").eq("code", "8");
const { data: app } = await guardianClient.from("admission_applications").insert({
  owner_account_id: guardian.userId, academic_year_id: years[0].id, grade_id: grades[0].id,
  current_status: "draft", student_name: `Finance Child ${RUN}`, parent_name: `Finance Guardian ${RUN}`,
  parent_contact: `itg.fin.guardian.${RUN}@example.in`,
}).select("id, reference").single();

await rpc(guardianClient, "admissions_submit", { p_application_id: app.id, p_snapshot: { child: `Finance Child ${RUN}`, guardian: `Finance Guardian ${RUN}`, consent: true }, p_expected_version: 0, p_schema_version: 1 });

// Need separate approver for admission decision (maker/checker)
const officerClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
await officerClient.auth.signInWithPassword({ email: `itg.fin.officer.${RUN}@example.in`, password: PASSWORD });
await elevateClient(officerClient);
await rpc(officerClient, "admissions_review_advance", { p_application_id: app.id, p_action: "under_review" });
await rpc(officerClient, "admissions_review_advance", { p_application_id: app.id, p_action: "assessment" });

// Create a separate admissions approver for the decision
const admApprover = await createActor(`itg.fin.admapprover.${RUN}@example.in`, `Fin Adm Approver ${RUN}`, "FinAdmApprover");
await admin.from("role_grants").insert({ account_id: admApprover.userId, role_code: "admissions_approver", status: "active", effective_from: new Date().toISOString() });
await admin.from("staff_members").insert({ person_id: admApprover.personId, employment_status: "active", title: "Adm Approver" });
const admApproverClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
await admApproverClient.auth.signInWithPassword({ email: `itg.fin.admapprover.${RUN}@example.in`, password: PASSWORD });
await elevateClient(admApproverClient);
await rpc(admApproverClient, "admissions_decide", { p_application_id: app.id, p_action: "offer", p_visible_reason: "Approved" });

const invoiceRef = await rpc(guardianClient, "admissions_respond_offer", { p_application_id: app.id, p_response: "accepted", p_offer_version: 1 });
const { data: invoices } = await admin.from("invoices").select("id,reference").eq("applicant_ref", app.reference);
const balance = await rpc(guardianClient, "invoice_balance", { p_invoice_id: invoices[0].id });
const receiptRef = await rpc(guardianClient, "finance_post_sandbox_payment", {
  p_invoice_ref: invoiceRef, p_attempt_reference: `ATT-${RUN}-1`, p_provider_txn_id: `TXN-${RUN}-1`, p_amount_paise: balance,
});
assert(true, `paid invoice ${invoiceRef} with receipt ${receiptRef}`);

/* --- 3. concession --- */
console.log("\n== 3. concession");
const { data: feeSchedule } = await admin.from("fee_schedule_versions").select("id").eq("version", 1).maybeSingle();
// Apply concession (finance officer with aal2) — concessions are adjustments with type 'concession'
const concessionId = await rpc(officerClient, "finance_apply_concession", { p_invoice_id: invoices[0].id, p_amount_paise: 50000, p_reason: "Sibling discount", p_type: "concession" });
assert(concessionId, "concession applied (returned adjustment ID)");

/* --- 4. adjustment maker-checker --- */
console.log("\n== 4. adjustment maker-checker");
const adjResult = await rpc(officerClient, "finance_request_adjustment", {
  p_invoice_id: invoices[0].id, p_amount_paise: 10000, p_kind: "write_off", p_reason: "Round-off adjustment",
  p_expected_invoice_version: 1, p_idempotency_key: `adj-${RUN}-1`,
});
const adjustmentId = typeof adjResult === "object" ? adjResult.id : adjResult;
assert(adjustmentId, "adjustment requested by officer");

// Approver approves
const approverClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
await approverClient.auth.signInWithPassword({ email: `itg.fin.approver.${RUN}@example.in`, password: PASSWORD });
await elevateClient(approverClient);
await rpc(approverClient, "finance_approve_adjustment", { p_adjustment_id: adjustmentId, p_expected_version: 1, p_approve: true, p_reason: "Approved by finance head" });
assert(true, "adjustment approved by approver");

// Post the adjustment (idempotent) — finance_officer role required
const postResult = await rpc(officerClient, "finance_post_adjustment", { p_adjustment_id: adjustmentId, p_expected_version: null, p_idempotency_key: `post-adj-${RUN}-1` });
assert(postResult, "adjustment posted by officer");
// Retry with same idempotency key should not duplicate
const { data: adjAfterPost } = await admin.from("finance_adjustment_requests").select("status, version").eq("id", adjustmentId).single();
const postRetry = await rpc(officerClient, "finance_post_adjustment", { p_adjustment_id: adjustmentId, p_expected_version: null, p_idempotency_key: `post-adj-${RUN}-1` });
const { data: adjAfterRetry } = await admin.from("finance_adjustment_requests").select("status, version").eq("id", adjustmentId).single();
assert(adjAfterPost.version === adjAfterRetry.version, "adjustment post is idempotent (no version change on retry)");

/* --- 5. refund flow --- */
console.log("\n== 5. refund flow");
const { data: payments } = await admin.from("payments").select("id").eq("provider_txn_id", `TXN-${RUN}-1`);
const refundResult = await rpc(officerClient, "finance_request_refund_v2", {
  p_payment_id: payments[0].id, p_amount_paise: 25000, p_reason: "Partial refund test",
  p_expected_version: 1, p_idempotency_key: `refund-${RUN}-1`,
});
const refundReqId = typeof refundResult === "object" ? refundResult.id : refundResult;
assert(refundReqId, "refund requested by guardian");

// Approver approves refund
await rpc(approverClient, "finance_approve_refund", { p_refund_request_id: refundReqId, p_expected_version: 1, p_approve: true, p_reason: "Approved" });
assert(true, "refund approved");

// Post refund — finance_officer role required
const refundPost = await rpc(officerClient, "finance_post_refund", { p_refund_request_id: refundReqId, p_expected_version: null, p_provider_ref: `REF-${RUN}-1` });
assert(refundPost, "refund posted with provider reference");

/* --- 6. reconciliation --- */
console.log("\n== 6. reconciliation");
const reconStartResult = await rpc(officerClient, "finance_reconciliation_start", { p_idempotency_key: `recon-${RUN}-1` });
const runId = typeof reconStartResult === "object" ? reconStartResult.id : reconStartResult;
assert(runId, "reconciliation run started");

const importResult = await rpc(officerClient, "finance_reconciliation_import", {
  p_run_id: runId, p_evidence: [{ providerEventId: `EVT-${RUN}-1`, providerCode: "sandbox", providerTxnId: `TXN-${RUN}-1`, invoiceReference: invoiceRef, amountPaise: balance, state: "captured" }],
  p_expected_version: 1, p_idempotency_key: `recon-imp-${RUN}-1`,
});
assert(importResult, "reconciliation evidence imported");

/* --- 7. summary --- */
console.log("\n== summary");
if (failures > 0) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log("FINANCE SANDBOX SUITE PASSED (fictional run " + RUN + ")");
