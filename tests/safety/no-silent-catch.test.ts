import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "server";
const EMPTY_CATCH_RE =
  /catch\s*(?:\(\s*([A-Za-z_$][\w$]*)?(?:\s*:\s*[^)]+)?\s*\)\s*)?\{\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*\}/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

test("no empty catch blocks in server/ (silent error swallowing)", () => {
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, "utf8");
    EMPTY_CATCH_RE.lastIndex = 0;
    const matches = src.match(EMPTY_CATCH_RE);
    if (matches && matches.length > 0) {
      offenders.push(`${file}: ${matches.length} empty catch(es)`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Empty catch blocks hide bugs (e.g. the projects-click 500 stayed invisible). ` +
      `Use \`catch (e) { console.warn("[silent-catch] <file>:", (e as any)?.message ?? e); }\` ` +
      `or run \`node scripts/seal-silent-catches.mjs\` to fix automatically.\n` +
      offenders.join("\n"),
  );
});
