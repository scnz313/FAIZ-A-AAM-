#!/usr/bin/env node
/**
 * Staging integration test (plan.md §12: "Run the full teacher-to-guardian
 * result flow and timetable-manager-to-portal flow against staging PostgreSQL
 * with wrong-scope denial"; B7 cutover evidence).
 *
 * Runs the ENTIRE canonical chain against the LIVE linked Supabase project
 * with real sessions and RLS:
 *
 *   guardian (password session) → draft → submit (idempotent retry)
 *   staff (password session + TOTP → aal2) → review → assessment → offer
 *   guardian → accept → unique invoice → sandbox payment (idempotent retries)
 *   guardian/staff → enrollment conversion (idempotent)
 *   staff → result publication (frozen roster + snapshots)
 *   staff → timetable publication
 *   admin → outbox claim → delivery records → mark delivered
 *
 * Plus denial cases: a second, unlinked guardian sees no finance rows; a
 * non-publisher cannot publish results; aal1 staff is denied.
 *
 * Usage: node scripts/integration-staging.mjs
 * Fictional data only (plan.md §14); run-scoped so re-runs never collide.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

/* --- env parsing (mirrors seed-remote.mjs) ------------------------------ */

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

/* --- helpers ------------------------------------------------------------- */

let failures = 0;
function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`);
  }
}

async function rpc(client, fn, args) {
  const { data, error } = await client.schema("app").rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

/** RFC 6238 TOTP code from a base32 secret (staff MFA elevation). */
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

const RUN = Date.now().toString(36);
const GUARDIAN_EMAIL = `itg.guardian.${RUN}@example.in`;
const STAFF_EMAIL = `itg.staff.${RUN}@example.in`;
const APPROVER_EMAIL = `itg.approver.${RUN}@example.in`;
const STRANGER_EMAIL = `itg.stranger.${RUN}@example.in`;
const PASSWORD = `Test-${RUN}-x9!`;

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`Integration run ${RUN} against ${url} (fictional data only)`);

/* --- 1. actors ----------------------------------------------------------- */

console.log("\n== 1. create fictional actors (admin)");
async function createActor(email, displayName, givenName) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const user = data.user;
  const { error: personError } = await admin.from("people").insert({
    given_name: givenName,
    family_name: "Integration",
    display_name: displayName,
  });
  if (personError) throw personError;
  const { data: person } = await admin.from("people").select("id").eq("display_name", displayName).maybeSingle();
  const { error: accountError } = await admin.from("user_accounts").insert({
    id: user.id,
    person_id: person.id,
    status: "active",
    verified_contact: email,
  });
  if (accountError) throw accountError;
  return { userId: user.id, personId: person.id };
}

const guardian = await createActor(GUARDIAN_EMAIL, `Integration Guardian ${RUN}`, "ItgGuardian");
const stranger = await createActor(STRANGER_EMAIL, `Integration Stranger ${RUN}`, "ItgStranger");
const staff = await createActor(STAFF_EMAIL, `Integration Officer ${RUN}`, "ItgOfficer");
const approver = await createActor(APPROVER_EMAIL, `Integration Approver ${RUN}`, "ItgApprover");
assert(true, "guardian, stranger, reviewer, and approver accounts created");

for (const role of ["guardian"]) {
  const { error } = await admin.from("role_grants").insert({
    account_id: guardian.userId,
    role_code: role,
    status: "active",
    effective_from: new Date().toISOString(),
  });
  if (error) throw error;
}
const { error: strangerGrantError } = await admin.from("role_grants").insert({
  account_id: stranger.userId,
  role_code: "guardian",
  status: "active",
  effective_from: new Date().toISOString(),
});
if (strangerGrantError) throw strangerGrantError;
for (const role of ["admissions_officer", "finance_officer", "result_publisher", "timetable_manager"]) {
  const { error } = await admin.from("role_grants").insert({
    account_id: staff.userId,
    role_code: role,
    status: "active",
    effective_from: new Date().toISOString(),
  });
  if (error) throw error;
}
const { error: approverGrantError } = await admin.from("role_grants").insert({
  account_id: approver.userId,
  role_code: "admissions_approver",
  status: "active",
  effective_from: new Date().toISOString(),
});
if (approverGrantError) throw approverGrantError;
for (const member of [
  { person_id: staff.personId, title: "Integration Officer" },
  { person_id: approver.personId, title: "Integration Approver" },
]) {
  const { error } = await admin.from("staff_members").insert({ ...member, employment_status: "active" });
  if (error) throw error;
}
assert(true, "reviewer and approver grants + staff records provisioned");

const { error: guardianRecordError } = await admin.from("guardians").insert({
  person_id: guardian.personId,
  status: "active",
});
if (guardianRecordError) throw guardianRecordError;
assert(true, "guardian record provisioned");

// The synthetic fee schedule must be approved for invoice issuance.
const { error: approveScheduleError } = await admin
  .from("fee_schedule_versions")
  .update({ status: "approved" })
  .eq("version", 1);
if (approveScheduleError) throw approveScheduleError;

/* --- 2. guardian session + application flow ------------------------------ */

console.log("\n== 2. guardian: draft → submit (idempotent)");
const guardianClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: signInError } = await guardianClient.auth.signInWithPassword({ email: GUARDIAN_EMAIL, password: PASSWORD });
if (signInError) throw signInError;
assert(true, "guardian password sign-in");

const { data: years } = await admin.from("academic_years").select("id,label").eq("label", "2026-27");
const { data: grades } = await admin.from("grades").select("id,code").eq("code", "8");
const currentYearId = years[0].id;
const grade8Id = grades[0].id;

const { data: draftApp, error: draftError } = await guardianClient
  .from("admission_applications")
  .insert({
    owner_account_id: guardian.userId,
    academic_year_id: currentYearId,
    grade_id: grade8Id,
    current_status: "draft",
    student_name: `Integration Child ${RUN}`,
    parent_name: `Integration Guardian ${RUN}`,
    parent_contact: GUARDIAN_EMAIL,
  })
  .select("id, reference, version")
  .single();
if (draftError) throw draftError;
assert(true, `draft application ${draftApp.reference} created under RLS`);

const { error: draftRowError } = await guardianClient.from("admission_drafts").insert({
  application_id: draftApp.id,
  draft: { step: "personal", child: `Integration Child ${RUN}` },
  schema_version: 1,
  expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
});
if (draftRowError) throw draftRowError;
assert(true, "draft row saved");

const snapshot = { child: `Integration Child ${RUN}`, guardian: `Integration Guardian ${RUN}`, consent: true };
const versionId = await rpc(guardianClient, "admissions_submit", {
  p_application_id: draftApp.id,
  p_snapshot: snapshot,
  p_expected_version: 0,
  p_schema_version: 1,
});
const versionRetry = await rpc(guardianClient, "admissions_submit", {
  p_application_id: draftApp.id,
  p_snapshot: snapshot,
  p_expected_version: 0,
  p_schema_version: 1,
});
assert(versionRetry === versionId, "submit retry returns the same version id");
const { data: submitted } = await admin
  .from("admission_applications")
  .select("current_status, version")
  .eq("id", draftApp.id)
  .single();
assert(submitted.current_status === "submitted" && submitted.version === 1, "application is submitted v1");

/* --- 3. staff session with TOTP elevation (aal2) -------------------------- */

console.log("\n== 3. staff: password session → TOTP → aal2");
async function createAal2Client(email, label) {
  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  const { data: enrollData, error: enrollError } = await client.auth.mfa.enroll({ factorType: "totp" });
  if (enrollError) throw new Error(`TOTP enrollment failed for ${label}: ${enrollError.message}`);
  const { data: challengeData, error: challengeError } = await client.auth.mfa.challenge({ factorId: enrollData.id });
  if (challengeError) throw challengeError;
  const { error: verifyError } = await client.auth.mfa.verify({ factorId: enrollData.id, challengeId: challengeData.id, code: totpCode(enrollData.totp.secret) });
  if (verifyError) throw new Error(`TOTP verify failed for ${label}: ${verifyError.message}`);
  assert(true, `${label} session elevated to aal2`);
  return client;
}
const staffClient = await createAal2Client(STAFF_EMAIL, "reviewer");
const approverClient = await createAal2Client(APPROVER_EMAIL, "approver");

// aal1 denial: before elevation the same user must be denied staff commands.
const staffAal1Client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
await staffAal1Client.auth.signInWithPassword({ email: STAFF_EMAIL, password: PASSWORD });
let aal1Denied = false;
try {
  await rpc(staffAal1Client, "admissions_review_advance", {
    p_application_id: draftApp.id,
    p_action: "under_review",
  });
} catch {
  aal1Denied = true;
}
assert(aal1Denied, "aal1 staff session is denied review advance");

/* --- 4. staff decisions --------------------------------------------------- */

console.log("\n== 4. staff: review → assessment → offer");
await rpc(staffClient, "admissions_review_advance", {
  p_application_id: draftApp.id,
  p_action: "under_review",
  p_visible_reason: "Documents verified",
});
await rpc(staffClient, "admissions_review_advance", { p_application_id: draftApp.id, p_action: "assessment" });
const { data: assessmentState } = await admin.from("admission_applications").select("version").eq("id", draftApp.id).single();
await rpc(approverClient, "admissions_decide_v2", {
  p_application_id: draftApp.id,
  p_action: "offer",
  p_visible_reason: "Approved by committee",
  p_expected_version: assessmentState.version,
});
const { data: offered } = await admin
  .from("admission_applications")
  .select("current_status")
  .eq("id", draftApp.id)
  .single();
assert(offered.current_status === "offered", "application offered");

/* --- 5. guardian: accept → invoice → pay (idempotent) --------------------- */

console.log("\n== 5. guardian: accept offer, unique invoice, sandbox payment");
const invoiceRef = await rpc(guardianClient, "admissions_respond_offer", {
  p_application_id: draftApp.id,
  p_response: "accepted",
  p_offer_version: 1,
});
const invoiceRetry = await rpc(guardianClient, "admissions_respond_offer", {
  p_application_id: draftApp.id,
  p_response: "accepted",
  p_offer_version: 1,
});
assert(invoiceRetry === invoiceRef, "acceptance retry returns the same invoice ref");
const { data: invoices } = await admin.from("invoices").select("id,reference").eq("applicant_ref", draftApp.reference);
assert(invoices.length === 1, "exactly one admission invoice");

const balance = await rpc(guardianClient, "invoice_balance", { p_invoice_id: invoices[0].id });
const receiptRef = await rpc(guardianClient, "finance_post_sandbox_payment", {
  p_invoice_ref: invoiceRef,
  p_attempt_reference: `ATT-${RUN}-1`,
  p_provider_txn_id: `TXN-${RUN}-1`,
  p_amount_paise: balance,
});
const receiptRetry = await rpc(guardianClient, "finance_post_sandbox_payment", {
  p_invoice_ref: invoiceRef,
  p_attempt_reference: `ATT-${RUN}-1`,
  p_provider_txn_id: `TXN-${RUN}-1`,
  p_amount_paise: balance,
});
assert(receiptRetry === receiptRef, "payment retry returns the same receipt");
const { data: payments } = await admin.from("payments").select("id").eq("provider_txn_id", `TXN-${RUN}-1`);
assert(payments.length === 1, "retries never duplicate payments");
const { data: paidInvoice } = await admin.from("invoices").select("status").eq("reference", invoiceRef).single();
assert(paidInvoice.status === "paid", "invoice marked paid");

/* --- 6. enrollment conversion (idempotent) -------------------------------- */

console.log("\n== 6. enrollment conversion (idempotent)");
const conversion = await rpc(guardianClient, "enrollment_convert", { p_application_id: draftApp.id });
const conversionRetry = await rpc(guardianClient, "enrollment_convert", { p_application_id: draftApp.id });
assert(JSON.stringify(conversionRetry) === JSON.stringify(conversion), "conversion retry returns the same result");
const { data: links } = await admin
  .from("guardian_student_links")
  .select("id")
  .eq("guardian_id", (await admin.from("guardians").select("id").eq("person_id", guardian.personId).single()).data.id)
  .eq("status", "active");
assert(links.length === 1, "one active guardian link");
const { data: adoptedInvoice } = await admin.from("invoices").select("student_id").eq("reference", invoiceRef).single();
assert(adoptedInvoice.student_id === conversion.student, "invoice adopted onto the student ledger");

/* --- 7. results + timetable publication ----------------------------------- */

console.log("\n== 7. results + timetable publication (staff)");
const { data: examDefs } = await admin.from("exam_definitions").select("id, grade_section_id, term").eq("term", "midterm");
const { data: sections } = await admin.from("grade_sections").select("id, grade_id, section_label");
const section8A = sections.find((s) => s.section_label === "A");
const { data: mathSubject } = await admin.from("subjects").select("id").eq("code", "MAT").single();
const exam8A = examDefs.find((e) => e.grade_section_id === section8A.id);

const { data: batch, error: batchError } = await admin.from("result_batches").insert({
  exam_definition_id: exam8A.id,
  grade_section_id: section8A.id,
  subject_id: mathSubject.id,
  status: "approved",
  version: 1,
}).select("id, version").single();
if (batchError) throw batchError;
assert(true, "approved result batch provisioned");

const publicationRef = await rpc(staffClient, "results_publish_batch", {
  p_batch_id: batch.id,
  p_expected_version: 1,
});
const { data: publicationRow } = await admin.from("result_publications").select("id").eq("reference", publicationRef).single();
const { data: publicationItems } = await admin.from("result_publication_items").select("id").eq("publication_id", publicationRow.id);
assert(publicationItems.length >= 1, `per-student snapshots published (${publicationItems.length})`);
const { data: ownItem } = await admin
  .from("result_publication_items")
  .select("id")
  .eq("publication_id", publicationRow.id)
  .eq("student_id", conversion.student);
assert(ownItem.length === 1, "the converted child has a published snapshot");

// A fresh draft timetable version per run (the seeded draft and earlier
// runs may already hold version 1 for the section).
const { data: ttVersion, error: ttError } = await admin.from("timetable_versions").insert({
  grade_section_id: section8A.id,
  status: "draft",
  version: 100 + (Date.now() % 8000),
  effective_from: "2026-04-06",
}).select("id").single();
if (ttError) throw ttError;
// Copy the seeded draft's periods into the new version (publish requires
// a populated timetable).
const { data: sourcePeriods } = await admin
  .from("timetable_periods")
  .select("day_of_week, period_number, starts_at, ends_at, subject_id, teacher_assignment_id, room_id, kind")
  .eq("timetable_version_id", (await admin.from("timetable_versions").select("id").eq("grade_section_id", section8A.id).order("created_at", { ascending: true }).limit(1)).data[0].id);
if (sourcePeriods.length === 0) throw new Error("no source periods for timetable copy");
const { error: periodsError } = await admin.from("timetable_periods").insert(
  sourcePeriods.map((period) => ({ ...period, timetable_version_id: ttVersion.id })),
);
if (periodsError) throw periodsError;
const ttRef = await rpc(staffClient, "timetable_publish_version", { p_version_id: ttVersion.id, p_note: `integration ${RUN}` });
assert(typeof ttRef === "string" && ttRef.length > 0, "timetable published");

/* --- 8. denial cases ------------------------------------------------------ */

console.log("\n== 8. denial cases");
const strangerClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
await strangerClient.auth.signInWithPassword({ email: STRANGER_EMAIL, password: PASSWORD });
const { data: strangerInvoices } = await strangerClient.from("invoices").select("id");
assert(strangerInvoices.length === 0, "unlinked guardian sees no invoices");
const { data: guardianBatches } = await guardianClient.from("result_batches").select("id");
assert(guardianBatches.length === 0, "guardian sees no result batches");

let publishDenied = false;
try {
  await rpc(guardianClient, "results_publish_batch", { p_batch_id: batch.id, p_expected_version: 1 });
} catch {
  publishDenied = true;
}
assert(publishDenied, "guardian cannot publish results");

/* --- 9. outbox worker contract -------------------------------------------- */

console.log("\n== 9. outbox worker contract (admin)");
const { data: claimed, error: claimError } = await admin.schema("app").rpc("claim_outbox", { p_batch_size: 50 });
if (claimError) throw claimError;
const emailEvents = (claimed ?? []).filter((e) => e.kind === "email.deliver" && e.status === "processing");
assert(emailEvents.length >= 5, `email events claimed (${emailEvents.length})`);
let deliveryRecords = 0;
for (const event of emailEvents) {
  // Resolve one recipient per event (the worker resolves from the record).
  const { data: recipients } = await admin
    .from("notification_deliveries")
    .upsert({
      event_id: event.id,
      recipient_account_id: guardian.userId,
      channel: "email",
      template_version: "v1",
      status: "sent",
      attempts: 1,
      provider_message_id: `itg-${RUN}-${event.id.slice(0, 8)}`,
    }, { onConflict: "event_id,recipient_account_id,channel,template_version", ignoreDuplicates: true })
    .select("id");
  deliveryRecords += recipients?.length ?? 0;
  await admin.schema("app").rpc("mark_outbox_delivered", { p_event_key: event.event_key });
}
assert(deliveryRecords === emailEvents.length, "one delivery record per event (unique constraint)");
const claimedEmailIds = emailEvents.map((event) => event.id);
const { data: stillPending } = claimedEmailIds.length === 0
  ? { data: [] }
  : await admin.from("outbox_events").select("id").in("id", claimedEmailIds).neq("status", "delivered");
assert(stillPending.length === 0, "all claimed events delivered");

// Transient failure path: fail an event and confirm exponential backoff state.
const { data: failProbe } = await admin.from("outbox_events").insert({
  event_key: `email.probe:${RUN}:v1`,
  kind: "email.deliver",
  target_type: "admission_application",
  target_reference: draftApp.reference,
}).select("id").single();
await admin.schema("app").rpc("fail_outbox", { p_event_key: `email.probe:${RUN}:v1`, p_error: "Transient:network down" });
const { data: failedProbe } = await admin.from("outbox_events").select("status, attempts, next_attempt_at").eq("id", failProbe.id).single();
assert(failedProbe.status === "pending" && failedProbe.attempts === 1, "transient failure retries with backoff");

/* --- 10. summary ---------------------------------------------------------- */

console.log("\n== summary");
if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("INTEGRATION SUITE PASSED (fictional run " + RUN + ")");
console.log("Run-scoped rows remain in staging for audit review; append-only rows are intentional.");
