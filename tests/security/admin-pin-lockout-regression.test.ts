import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeAdminPin,
  requireNormalizedAdminPin,
} from "../../server/lib/admin-pin-normalization";
import {
  hashAdminPinWithKey,
  verifyAdminPinWithKey,
} from "../../server/lib/admin-pin-crypto";
import { planAdminPinSeed } from "../../server/lib/admin-pin-seed";

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

test("settings-save and login normalize an edge-whitespace PIN identically", () => {
  const savedPin = requireNormalizedAdminPin("  1234\n");
  const submittedPin = normalizeAdminPin("\t1234 ");
  const key = "test-only-pepper";
  const storedHash = hashAdminPinWithKey(savedPin, key);
  assert.equal(savedPin, "1234");
  assert.equal(submittedPin, savedPin);
  assert.equal(verifyAdminPinWithKey(submittedPin, storedHash, key), true);
});

// ---------------------------------------------------------------------------
// 2. setAccessPin — canonical writer normalizes and fails closed on empty.
// ---------------------------------------------------------------------------

test("canonical PIN normalization trims every settings/login edge-whitespace form", () => {
  assert.equal(requireNormalizedAdminPin("  1234\n"), "1234");
  assert.equal(requireNormalizedAdminPin("secret-pin\r\n"), "secret-pin");
});

test("canonical PIN normalization rejects empty and whitespace-only settings values", () => {
  assert.throws(() => requireNormalizedAdminPin(""), /empty/i);
  assert.throws(() => requireNormalizedAdminPin("   \n\t"), /empty/i);
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
    /const pin = normalizeAdminPin\(req\.body\?\.pin\)/,
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

test("setAccessPin hashes only the shared normalized PIN binding", () => {
  const src = stripComments(readFileSync("server/auth.ts", "utf8"));
  const start = src.indexOf("export async function setAccessPin");
  assert.ok(start >= 0, "setAccessPin not found in server/auth.ts");
  const nextFn = src.indexOf("export async function", start + 1);
  const body = src.slice(start, nextFn > 0 ? nextFn : undefined);
  assert.match(body, /const normalized = requireNormalizedAdminPin\(pin\)/);
  assert.match(body, /return hashPin\(normalized\)/);
  assert.doesNotMatch(body, /hashPin\(pin\)/, "the raw settings value must never be hashed");
});

// ---------------------------------------------------------------------------
// 4. seed.ts PIN block — trim + CAS-only writes, no unconditional overwrite.
// ---------------------------------------------------------------------------

test("seed heals an untrimmed-env corrupt hash exactly once", () => {
  const hash = (pin: string) => hashAdminPinWithKey(pin, "test-seed-pepper");
  const rawPin = " 2468\n";
  let stored = hash(rawPin);
  const first = planAdminPinSeed(rawPin, stored, "known-stale", hash);
  assert.equal(first?.reason, "untrimmed-env");
  assert.equal(first?.expectedHash, stored);
  stored = first!.desiredHash;
  assert.equal(stored, hash("2468"));
  assert.equal(planAdminPinSeed(rawPin, stored, "known-stale", hash), null);
});

test("seed bootstrap normalizes ADMIN_PIN and safely falls back for whitespace-only values", () => {
  const hash = (pin: string) => hashAdminPinWithKey(pin, "test-seed-pepper");
  const configured = planAdminPinSeed(" 2468\n", null, "known-stale", hash);
  assert.deepEqual(configured, {
    expectedHash: null,
    desiredHash: hash("2468"),
    reason: "bootstrap",
  });

  const fallback = planAdminPinSeed(" \n\t", null, "known-stale", hash);
  assert.equal(fallback?.reason, "bootstrap");
  assert.equal(fallback?.desiredHash, hash("0000"));
});

test("seed rotates the exact known stale seed hash once and never loops", () => {
  const hash = (pin: string) => hashAdminPinWithKey(pin, "test-seed-pepper");
  const stale = "known-stale";
  const first = planAdminPinSeed(" 2468\n", stale, stale, hash);
  assert.deepEqual(first, {
    expectedHash: stale,
    desiredHash: hash("2468"),
    reason: "stale-seed",
  });
  assert.equal(planAdminPinSeed(" 2468\n", first!.desiredHash, stale, hash), null);
  assert.equal(planAdminPinSeed("same", hash("same"), hash("same"), hash), null);
});

test("seed CAS cannot overwrite a PIN set after its read", () => {
  const hash = (pin: string) => hashAdminPinWithKey(pin, "test-seed-pepper");
  const rawPin = " 2468\n";
  const observed = hash(rawPin);
  const plan = planAdminPinSeed(rawPin, observed, "known-stale", hash);
  assert.ok(plan);

  let current = hash("operator-set-pin");
  const applied = current === plan.expectedHash;
  if (applied) current = plan.desiredHash;

  assert.equal(applied, false);
  assert.equal(current, hash("operator-set-pin"));
});

test("seed preserves every operator-set PIN", () => {
  const hash = (pin: string) => hashAdminPinWithKey(pin, "test-seed-pepper");
  const operatorHash = hash("operator-set-pin");
  assert.equal(planAdminPinSeed(" 2468\n", operatorHash, "known-stale", hash), null);
});

test("seed.ts: exactly three sanctioned CAS UPDATEs, with precise old-value predicates", () => {
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
  const heal = updates.find(u => /access_pin\s*=\s*\$\{pinPlan\.expectedHash\}/.test(u));
  assert.ok(heal, "heal UPDATE must CAS on the plan's exact observed hash — anything looser can overwrite an operator-set PIN");
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
