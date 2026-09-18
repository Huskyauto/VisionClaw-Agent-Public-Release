import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// R125+137.23-fable — the public static PIN salt must exist ONLY inside
// server/auth.ts (which layers PIN_PEPPER on top and handles migration).
// Any other callsite re-deriving it downgrades stored PIN hashes to a
// publicly-known salt (seed.ts did exactly this until 2026-07-15).
const SALT_LITERAL = "visionclaw-pin" + "-v1"; // split so THIS file never matches itself

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

test("static PIN salt literal appears only in server/auth.ts", () => {
  const offenders: string[] = [];
  for (const root of ["server", "scripts", "shared", "client/src"]) {
    let files: string[] = [];
    try { files = walk(root); } catch { continue; }
    for (const f of files) {
      if (f === join("server", "auth.ts")) continue;
      if (readFileSync(f, "utf8").includes(SALT_LITERAL)) offenders.push(f);
    }
  }
  assert.deepStrictEqual(offenders, [], `static PIN salt re-derived outside auth.ts: ${offenders.join(", ")}`);
});
