// Tests for the Action Ledger S1 primitives (feature contract:
// data/feature-contracts/action-ledger/ — S1 = schema + primitives, zero behavior
// change). Only the PURE helpers are exercised plus the fail-closed tenant guards
// that throw BEFORE any query; importing the module transitively touches the db
// client, so this file uses the process.exit pattern (pg-pool hang gotcha).

import {
  hashArgs,
  stableStringify,
  deriveIdempotencyKey,
  isValidTransition,
  ledgerObligation,
  prepareAttempt,
  settleAttempt,
  markUnknown,
  listUnknownAttempts,
  type ActionAttemptState,
} from "../../server/lib/action-ledger";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

async function expectThrow(fn: () => Promise<unknown> | unknown, needle: string, msg: string) {
  try {
    await fn();
    failed++; console.error(`  ✗ ${msg} (did not throw)`);
  } catch (e: any) {
    assert(String(e?.message ?? e).includes(needle), `${msg} (threw wrong error: ${e?.message})`);
  }
}

async function run() {
  // ── stableStringify / hashArgs ────────────────────────────────────────────

  // 1. Key order never changes the hash (the whole point of arguments_hash).
  assert(
    hashArgs({ a: 1, b: { d: 2, c: [3, 4] } }) === hashArgs({ b: { c: [3, 4], d: 2 }, a: 1 }),
    "hashArgs is key-order-insensitive (deep)",
  );

  // 2. Different values ⇒ different hash; array ORDER matters (positional args).
  assert(hashArgs({ a: 1 }) !== hashArgs({ a: 2 }), "different values hash differently");
  assert(hashArgs({ a: [1, 2] }) !== hashArgs({ a: [2, 1] }), "array order is significant");

  // 3. undefined properties are absent (JSON semantics), null is preserved.
  assert(hashArgs({ a: 1, b: undefined }) === hashArgs({ a: 1 }), "undefined prop ≡ absent");
  assert(hashArgs({ a: null }) !== hashArgs({}), "null prop is NOT absent");
  assert(stableStringify(undefined) === "null" && stableStringify(null) === "null",
    "top-level undefined/null both serialize as null");

  // ── deriveIdempotencyKey ──────────────────────────────────────────────────

  // 4. Deterministic: same inputs ⇒ same key (retries dedupe at the provider).
  {
    const h = hashArgs({ amount: 100, to: "acct_1" });
    const k1 = deriveIdempotencyKey("op-42", h);
    const k2 = deriveIdempotencyKey("op-42", h);
    assert(k1 === k2, "idempotency key is deterministic");
    assert(k1.startsWith("vc-al1-"), "key carries the vc-al1 prefix");
    assert(k1.length <= 64, `key stays well under provider length limits, got ${k1.length}`);
    assert(deriveIdempotencyKey("op-43", h) !== k1, "different operation ⇒ different key");
    assert(deriveIdempotencyKey("op-42", hashArgs({ amount: 101, to: "acct_1" })) !== k1,
      "different args ⇒ different key");
  }

  // 5. Missing inputs fail loud (a blank key would collide globally).
  await expectThrow(() => deriveIdempotencyKey("", "abc"), "requires", "empty operationId throws");
  await expectThrow(() => deriveIdempotencyKey("op", ""), "requires", "empty argumentsHash throws");

  // ── state machine ─────────────────────────────────────────────────────────

  // 6. Legal transitions per the contract's lifecycle.
  const legal: Array<[ActionAttemptState, ActionAttemptState]> = [
    ["prepared", "executing"], ["prepared", "committed"], ["prepared", "failed"], ["prepared", "unknown"],
    ["executing", "committed"], ["executing", "failed"], ["executing", "unknown"],
    ["unknown", "committed"], ["unknown", "failed"], ["unknown", "compensated"],
    ["committed", "compensated"],
  ];
  for (const [f, t] of legal) assert(isValidTransition(f, t), `${f} -> ${t} is legal`);

  // 7. Terminal states never transition; nothing revives to prepared; a retry is a
  //    NEW row, never failed→executing.
  const illegal: Array<[ActionAttemptState, ActionAttemptState]> = [
    ["failed", "executing"], ["failed", "committed"], ["failed", "prepared"],
    ["compensated", "committed"], ["compensated", "prepared"],
    ["committed", "failed"], ["committed", "executing"], ["committed", "prepared"],
    ["unknown", "executing"], ["unknown", "prepared"],
    ["executing", "prepared"],
  ];
  for (const [f, t] of illegal) assert(!isValidTransition(f, t), `${f} -> ${t} is illegal`);

  // ── ledgerObligation (derived from the destructive-tool-policy taxonomy) ──

  // 8. destructive ⇒ mandatory; sensitive ⇒ opt-in; safe ⇒ never (reads = pure overhead).
  assert(ledgerObligation("destructive") === "mandatory", "destructive tools are ledger-mandatory");
  assert(ledgerObligation("sensitive") === "opt-in", "sensitive tools are ledger-opt-in");
  assert(ledgerObligation("safe") === "never", "safe tools never ledger");

  // ── fail-closed guards (throw BEFORE any query — keeps this test query-free) ──

  // 9. Non-positive / non-integer tenant is rejected on every DB helper.
  await expectThrow(() => prepareAttempt({ tenantId: 0, operationId: "op", toolName: "t", args: {}, risk: "destructive" }),
    "positive integer tenantId", "prepareAttempt rejects tenantId 0");
  await expectThrow(() => prepareAttempt({ tenantId: -3, operationId: "op", toolName: "t", args: {}, risk: "destructive" }),
    "positive integer tenantId", "prepareAttempt rejects negative tenantId");
  await expectThrow(() => prepareAttempt({ tenantId: 1.5 as any, operationId: "op", toolName: "t", args: {}, risk: "destructive" }),
    "positive integer tenantId", "prepareAttempt rejects fractional tenantId");
  await expectThrow(() => settleAttempt(1, 0, "committed"), "positive integer tenantId", "settleAttempt rejects tenantId 0");
  await expectThrow(() => markUnknown(1, 0), "positive integer tenantId", "markUnknown rejects tenantId 0");
  await expectThrow(() => listUnknownAttempts(0), "positive integer tenantId", "listUnknownAttempts rejects tenantId 0");

  // 10. Missing identifiers are rejected before the INSERT.
  await expectThrow(() => prepareAttempt({ tenantId: 1, operationId: "", toolName: "t", args: {}, risk: "destructive" }),
    "requires operationId", "prepareAttempt rejects empty operationId");
  await expectThrow(() => prepareAttempt({ tenantId: 1, operationId: "op", toolName: "", args: {}, risk: "destructive" }),
    "requires operationId and toolName", "prepareAttempt rejects empty toolName");

  console.log(`\naction-ledger: ${passed} passed, ${failed} failed`);
  // Force exit: importing the module transitively instantiates a pg pool handle
  // that would otherwise hold the event loop open (node-test-db-pool-hang gotcha).
  process.exit(failed > 0 ? 1 : 0);
}

run();
