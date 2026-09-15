const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "apps", "web");
const manifestPath = path.join(__dirname, "material-symbols-rounded-icons.txt");
const names = new Set();

function add(value) {
  if (/^[a-z][a-z0-9_]+$/.test(value)) names.add(value);
}

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", ".next-dev"].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(full);
      continue;
    }
    if (!/\.(tsx|ts)$/.test(entry.name)) continue;
    const source = fs.readFileSync(full, "utf8");
    for (const match of source.matchAll(/<span[^>]*className=(?:"[^"]*msym[^"]*"|\{`[^`]*msym[^`]*`\})[^>]*>\s*([a-z][a-z0-9_]+)\s*<\/span>/gs)) add(match[1]);
    for (const match of source.matchAll(/(?:icon|ic)\s*[:=]\s*"([a-z][a-z0-9_]+)"/g)) add(match[1]);
    for (const match of source.matchAll(/\[\s*"\/[^"]*"\s*,\s*"[^"]*"\s*,\s*"([a-z][a-z0-9_]+)"/g)) add(match[1]);
  }
}

visit(root);
const discovered = [...names].sort();

if (process.argv.includes("--check")) {
  const manifest = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/).filter(Boolean).sort();
  const missing = discovered.filter((name) => !manifest.includes(name));
  const unused = manifest.filter((name) => !discovered.includes(name));
  if (missing.length || unused.length) {
    console.error(`Material Symbols subset mismatch. Missing from font manifest: ${missing.join(", ") || "none"}. Unused: ${unused.join(", ") || "none"}.`);
    process.exit(1);
  }
  console.log(`Material Symbols subset manifest matches ${discovered.length} source icons ✓`);
  process.exit(0);
}

console.log(discovered.join(","));
console.error(`${discovered.length} Material Symbols in source`);
