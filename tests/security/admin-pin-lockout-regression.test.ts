import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashPin, setAccessPin } from "../../server/auth";

// R125+137.24 — admin PIN lockout regression suite.
//
// The prod lockout: seed.ts force-overwrote agent_settings.access_pin on EVERY
// boot with hashPin(process.env.ADMIN_PIN) — but the ADMIN_PIN secret carried
// edge whitespace, so the stored hash matched no pasteable PIN and the owner
// was locked out of prod. Three fixes must stay pinned:
//   1. handleLogin trims the submitted PIN before verification.
//   2. setAccessPin (the canonical writer) trims and refuses empty PINs.
//   3. seed.ts trims the env value AND only ever writes via compare-and-swap
//      (no-pin-yet, or healing the exact corrupt untrimmed hash) — never an
//      unconditional overwrite of an operator-set PIN.

// server/auth.ts transitively imports server/db.ts, which opens a Postgres
// pool at module load. Force-exit once the suite is done (same pattern as
// admin-gate.test.ts) so the pool can't hang the runner.
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// Strip comments so text-scan assertions can't be tripped (or satisfied) by
// prose — static-guard rule: match code, not commentary.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

// ---------------------------------------------------------------------------
// 1. Hash semantics: whitespace-edged input produces a DIFFERENT hash. This is
//    the mechanism of the lockout — if this ever stops holding, the other
//    guards are moot, so document it explicitly.
// ---------------------------------------------------------------------------

test("hashPin: edge whitespace changes the hash (the lockout mechanism)", () => {
  assert.notEqual(hashPin(" 1234\n"), hashPin("1234"));
  assert.notEqual(hashPin("1234 "), hashPin("1234"));
});

// ---------------------------------------------------------------------------
// 2. setAccessPin — canonical writer normalizes and fails closed on empty.
// ---------------------------------------------------------------------------

test("setAccessPin: trims edge whitespace before hashing", async () => {
  assert.equal(await setAccessPin("  1234\n"), hashPin("1234"));
  assert.equal(await setAccessPin("secret-pin\r\n"), hashPin("secret-pin"));
});

test("setAccessPin: rejects empty and whitespace-only PINs", async () => {
  await assert.rejects(() => setAccessPin(""), /empty/i);
  await assert.rejects(() => setAccessPin("   \n\t"), /empty/i);
});

// ---------------------------------------------------------------------------
// 3. handleLogin — submitted PIN must be trimmed before verifyPin. Static scan
//    (the handler needs a live req/res + DB to run, so pin the source shape).
// ---------------------------------------------------------------------------

test("handleLogin: trimmed PIN binding flows into verifyPin", () => {
  const src = stripComments(readFileSync("server/auth.ts", "utf8"));
  // Scope the scan to the handleLogin body so a stale copy of the trim
  // expression elsewhere can't satisfy it after the handler regressed.
  const start = src.indexOf("export async function handleLogin");
  assert.ok(start >= 0, "handleLogin not found in server/auth.ts");
  const nextFn = src.indexOf("export async function", start + 1);
  const body = src.slice(start, nextFn > 0 ? nextFn : undefined);
  // 1. The pin binding is the TRIMMED request value…
  assert.match(
    body,
    /const pin = typeof req\.body\?\.pin === "string" \? req\.body\.pin\.trim\(\)/,
    "handleLogin must bind `pin` to the trimmed req.body.pin — pasted PINs routinely carry a trailing newline",
  );
  // 2. …and that same binding is what verification consumes.
  assert.match(
    body,
    /verifyPin\(pin,\s*settings\.accessPin\)/,
    "handleLogin must verify the trimmed `pin` binding (dataflow from trim to verifyPin)",
  );
  // No other verifyPin call in the handler using a different (raw) value.
  const calls = body.match(/verifyPin\(/g) || [];
  assert.equal(calls.length, 1, "handleLogin should call verifyPin exactly once, on the trimmed binding");
});

// ---------------------------------------------------------------------------
// 4. seed.ts PIN block — trim + CAS-only writes, no unconditional overwrite.
// ---------------------------------------------------------------------------

test("seed.ts: trims ADMIN_PIN and falls back when whitespace-only", () => {
  const src = stripComments(readFileSync("server/seed.ts", "utf8"));
  assert.match(
    src,
    /const rawPin = process\.env\.ADMIN_PIN[^;]*;\s*const defaultPin = rawPin\.trim\(\)\s*\|\|\s*"0000"/,
    "seed.ts must hash the TRIMMED ADMIN_PIN and fall back when the trimmed value is empty — hashing \"\" recreates the lockout",
  );
});

test("seed.ts: exactly the two sanctioned CAS UPDATEs, with their precise old-value predicates", () => {
  const src = stripComments(readFileSync("server/seed.ts", "utf8"));
  // Every SQL statement that SETs access_pin, anywhere in seed.ts.
  const updates = src.match(/UPDATE\s+agent_settings\s+SET\s+access_pin[\s\S]*?(?=`\))/g) || [];
  assert.equal(
    updates.length, 3,
    `seed.ts must contain exactly the bootstrap + stale-rotation heal + untrimmed heal CAS UPDATEs, found ${updates.length}`,
  );
  // Rotation heal: only replaces the exact known seed-written stale hash.
  const rotation = updates.find(u => /access_pin\s*=\s*\$\{STALE_SEED_PIN_HASH\}/.test(u));
  assert.ok(rotation, "rotation heal UPDATE must CAS on `access_pin = ${STALE_SEED_PIN_HASH}`");
  // Bootstrap: only fires when NO pin is stored.
  const bootstrap = updates.find(u => /access_pin\s+IS\s+NULL\s+OR\s+access_pin\s*=\s*''/.test(u));
  assert.ok(bootstrap, "bootstrap UPDATE must CAS on `access_pin IS NULL OR access_pin = ''` — a broader predicate (e.g. IS NOT NULL, id-only) is the boot-clobber regression");
  // Heal: only replaces the EXACT corrupt untrimmed-env hash.
  const heal = updates.find(u => /access_pin\s*=\s*\$\{corruptUntrimmed\}/.test(u));
  assert.ok(heal, "heal UPDATE must CAS on `access_pin = ${corruptUntrimmed}` — anything looser can overwrite an operator-set PIN");
  assert.notEqual(bootstrap, heal, "bootstrap and heal must be distinct statements");
});

test("seed.ts: no unconditional Drizzle overwrite of accessPin", () => {
  const src = stripComments(readFileSync("server/seed.ts", "utf8"));
  // The fable regression wrote db.update(agentSettings).set({ accessPin: ... })
  // gated only on id — assert no .set() touching accessPin exists in seed.ts
  // at all (the raw-SQL CAS pair above is the only sanctioned writer).
  assert.doesNotMatch(
    src,
    /\.set\(\s*{[^}]*accessPin/,
    "seed.ts must not write accessPin via db.update().set() — only the CAS raw-SQL pair may write it",
  );
});
