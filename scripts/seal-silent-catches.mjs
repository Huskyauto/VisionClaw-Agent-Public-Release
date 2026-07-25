#!/usr/bin/env node
// Replaces empty catch blocks in server/ with a logged warning, preserving control flow.
// Run: node scripts/seal-silent-catches.mjs [--check]
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "server";
const CHECK = process.argv.includes("--check");

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) files.push(p);
  }
}
walk(ROOT);

// Match "catch ( <ident>? ) { <only whitespace + optional comments> }".
// Capture groups: 1 = full param including parens (or undefined), 2 = ident name (or undefined)
const EMPTY_CATCH_RE = /catch\s*(?:\(\s*([A-Za-z_$][\w$]*)?(?:\s*:\s*[^)]+)?\s*\)\s*)?\{\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*\}/g;

let total = 0;
let touched = 0;
const perFile = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  let count = 0;
  const rel = relative(".", file).replace(/\\/g, "/");
  const out = src.replace(EMPTY_CATCH_RE, (match, ident) => {
    count++;
    const name = ident || "_silentErr";
    const tag = `${rel}`;
    return `catch (${name}) { logSilentCatch("${tag}", ${name}); }`;
  });
  if (count > 0) {
    perFile.push([rel, count]);
    total += count;
    if (out !== src && !CHECK) {
      writeFileSync(file, out);
      touched++;
    }
  }
}

perFile.sort((a, b) => b[1] - a[1]);
for (const [f, n] of perFile) console.log(`${n.toString().padStart(4)}  ${f}`);
console.log(`---\n${CHECK ? "Would fix" : "Fixed"} ${total} empty catches in ${perFile.length} files (${touched} written).`);
process.exit(CHECK && total > 0 ? 1 : 0);
