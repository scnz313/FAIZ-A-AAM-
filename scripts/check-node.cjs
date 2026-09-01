#!/usr/bin/env node
/**
 * Runtime guard (Phase 10.7): fails when the active Node major is outside
 * the project contract (plan.md: Node 22). Verification scripts source this
 * check so gates cannot silently pass on an unsupported runtime.
 *
 * FASS_NODE_ALLOW_OTHER_MAJORS=1 permits other majors for local exploration
 * only — CI/staging checks must not set it.
 */
const major = Number(process.versions.node.split(".")[0]);
const required = 22;
if (major !== required) {
  const allowed = process.env.FASS_NODE_ALLOW_OTHER_MAJORS === "1";
  const message =
    `Node ${required} is required (active: ${process.versions.node}).` +
    (allowed ? " (FASS_NODE_ALLOW_OTHER_MAJORS=1 — recorded, not blocking)" : "");
  if (allowed) {
    console.warn(`WARNING: ${message}`);
  } else {
    console.error(`ERROR: ${message}`);
    console.error("Install Node 22 (nvm install 22 && nvm use 22) and re-run.");
    process.exit(1);
  }
}
