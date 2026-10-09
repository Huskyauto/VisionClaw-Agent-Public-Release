// Runs with Node alone, before npm ci, including on external builders.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const root = resolve(__dirname, "../..");

test("every locked tarball is downloadable from the public HTTPS npm registry", () => {
  const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const invalid = [];
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!entry.resolved) continue;
    const url = new URL(entry.resolved);
    if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org"
        || url.username || url.password || !entry.integrity) invalid.push(name);
  }
  assert.deepEqual(invalid, [], "Nonportable or integrity-free package downloads");
});

test("private mirror preserves remote ancestry and refuses force pushes", {
  skip: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).private !== true,
}, () => {
  const script = readFileSync(resolve(root, "scripts/build-public-mirror.sh"), "utf8");
  assert.match(script, /fetch --no-tags public main/);
  const parent = script.indexOf("git reset --soft FETCH_HEAD");
  assert.ok(parent > script.indexOf("git init -q -b main"));
  assert.ok(parent < script.indexOf("git add -A"));
  assert.doesNotMatch(script, /\bpush\s+(?:-f\b|--force(?:-with-lease)?\b)/);
});
