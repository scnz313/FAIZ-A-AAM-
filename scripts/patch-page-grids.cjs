/* Patch: add `grid-template-columns: minmax(0, 1fr)` to implicit `.page` grids
 * in portal/staff module CSS so grid items never grow to min-content.
 * Run: node scripts/patch-page-grids.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "apps", "web");
const files = execSync(`find ${root}/app/portal ${root}/app/staff ${root}/components/portal ${root}/components/staff -name "*.module.css"`)
  .toString()
  .trim()
  .split("\n")
  .filter(Boolean);

let patched = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const idx = src.indexOf(".page {");
  if (idx === -1) continue;
  // Only when the .page block (next 300 chars) has display:grid but no grid-template.
  const block = src.slice(idx, idx + 300);
  if (!block.includes("display: grid")) continue;
  if (block.includes("grid-template")) continue;
  const after = block.indexOf("{") + 1;
  const insertAt = idx + after;
  const patchedSrc = src.slice(0, insertAt) + "\n  grid-template-columns: minmax(0, 1fr);" + src.slice(insertAt);
  fs.writeFileSync(file, patchedSrc);
  console.log(`patched ${path.relative(root, file)}`);
  patched++;
}
console.log(`\nPatched ${patched} files.`);
