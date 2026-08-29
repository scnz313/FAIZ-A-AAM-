#!/usr/bin/env node
/**
 * C5.4 storage journey verification (plan.md §C5.4).
 * Tests upload intent → signed URL → bucket privacy → PDF generation reference.
 * Fictional data only (plan.md §14).
 */
import { readFileSync } from "node:fs";
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
if (!url || !publishableKey || !secretKey) {
  console.error("Missing Supabase env in .env.local");
  process.exit(1);
}

let failures = 0;
function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`);
  }
}

const RUN = Date.now().toString(36);
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const PASSWORD = `Test-${RUN}-x9!`;
const EMAIL = `itg.storage.${RUN}@example.in`;

console.log(`Storage verification run ${RUN} against ${url}`);

/* --- 1. bucket privacy verification --- */
console.log("\n== 1. bucket privacy");
const { data: buckets } = await admin.storage.listBuckets();
const privateDocs = buckets.find((b) => b.id === "fass-private-documents");
const generatedDocs = buckets.find((b) => b.id === "fass-generated-documents");
assert(privateDocs && !privateDocs.public, "fass-private-documents bucket is private");
assert(generatedDocs && !generatedDocs.public, "fass-generated-documents bucket is private");

/* --- 2. upload intent → signed URL --- */
console.log("\n== 2. upload intent → signed URL");
const { data: user, error: userError } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
});
if (userError) throw userError;

const { error: personError } = await admin.from("people").insert({
  given_name: "StorageTest",
  family_name: "Integration",
  display_name: `Storage Test ${RUN}`,
});
if (personError) throw personError;
const { data: person } = await admin.from("people").select("id").eq("display_name", `Storage Test ${RUN}`).maybeSingle();
const { error: accountError } = await admin.from("user_accounts").insert({
  id: user.user.id,
  person_id: person.id,
  status: "active",
  verified_contact: EMAIL,
});
if (accountError) throw accountError;
const { error: grantError } = await admin.from("role_grants").insert({
  account_id: user.user.id,
  role_code: "guardian",
  status: "active",
  effective_from: new Date().toISOString(),
});
if (grantError) throw grantError;

const guardianClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: signInError } = await guardianClient.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (signInError) throw signInError;
assert(true, "guardian session created");

// Create an admission application to attach the document to
const { data: years } = await admin.from("academic_years").select("id,label").eq("label", "2026-27");
const { data: grades } = await admin.from("grades").select("id,code").eq("code", "8");
const { data: app, error: appError } = await guardianClient.from("admission_applications").insert({
  owner_account_id: user.user.id,
  academic_year_id: years[0].id,
  grade_id: grades[0].id,
  current_status: "draft",
  student_name: `Storage Child ${RUN}`,
  parent_name: `Storage Test ${RUN}`,
  parent_contact: EMAIL,
}).select("id, reference").single();
if (appError) throw appError;
assert(true, `draft application ${app.reference} created`);

// Call the upload intent RPC (let the function generate the object key)
const { data: intent, error: intentError } = await guardianClient.schema("app").rpc("documents_create_upload_intent", {
  p_owner_domain: "admission_application",
  p_owner_record_id: app.id,
  p_attachment_code: "birth_certificate",
  p_safe_filename: `test-${RUN}.pdf`,
  p_declared_mime_type: "application/pdf",
  p_declared_size: 1024,
  p_allowed_mime_types: ["application/pdf", "image/png", "image/jpeg"],
  p_max_bytes: 10485760,
  p_object_key: null,
});
if (intentError) throw intentError;
assert(intent && intent.objectKey, "upload intent returned object key");
assert(intent && intent.reference, "upload intent returned document reference");
assert(intent && intent.status === "pending_scan", "document status is pending_scan");

// Create a signed upload URL for the object key (app code does this)
const { data: signedUpload, error: signedUploadError } = await admin.storage
  .from("fass-private-documents")
  .createSignedUploadUrl(intent.objectKey);
assert(!signedUploadError && signedUpload?.signedUrl, "signed upload URL created for private bucket");

/* --- 3. verify signed URL is for the private bucket --- */
console.log("\n== 3. signed URL verification");
const signedUrl = signedUpload?.signedUrl;
assert(signedUrl && signedUrl.includes("fass-private-documents"), "signed URL targets fass-private-documents bucket");
assert(signedUrl && signedUrl.includes(url), "signed URL is for the correct project");

/* --- 4. verify direct public access is denied --- */
console.log("\n== 4. public access denial");
const { data: pubList, error: pubError } = await admin.storage.from("fass-private-documents").list();
assert(!pubError, "admin can list private bucket (service role bypasses RLS)");

// Anonymous client should see no objects (RLS denies all rows)
const anonClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: anonList, error: anonError } = await anonClient.storage.from("fass-private-documents").list();
assert(!anonError && (!anonList || anonList.length === 0), "anonymous client sees no objects in private bucket");

/* --- 5. PDF generation reference (generated-documents bucket) --- */
console.log("\n== 5. generated documents bucket");
const testObjectKey = `receipts/test-${RUN}.pdf`;
const { data: uploadData, error: uploadError } = await admin.storage
  .from("fass-generated-documents")
  .upload(testObjectKey, Buffer.from("%PDF-1.4 test"), { contentType: "application/pdf" });
assert(!uploadError, "admin can upload to generated-documents bucket");

const { data: signedDownload, error: downloadError } = await admin.storage
  .from("fass-generated-documents")
  .createSignedUrl(testObjectKey, 60);
assert(!downloadError && signedDownload?.signedUrl, "signed download URL created with 60s expiry");
assert(signedDownload?.signedUrl?.includes("fass-generated-documents"), "download URL targets generated-documents bucket");

// Clean up test object
await admin.storage.from("fass-generated-documents").remove([testObjectKey]);

/* --- 6. summary --- */
console.log("\n== summary");
if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("STORAGE SUITE PASSED (fictional run " + RUN + ")");
