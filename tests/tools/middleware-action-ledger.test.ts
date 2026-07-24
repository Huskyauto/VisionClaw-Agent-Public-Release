/**
 * Action Ledger S2 seam + behavior guard (feature contract:
 * data/feature-contracts/action-ledger/ — spec.md §Acceptance 4, plan.md §S2).
 *
 * Proves:
 *   - executeTool wires withActionLedger around _executeToolInner inside the
 *     tracing span (static text-scan — server/tools.ts is NEVER imported here,
 *     pg-pool hang),
 *   - non-ledgered (safe/sensitive) tools pass through UNCHANGED (parity),
 *   - destructive tools get prepare → dispatch → settle; throw → unknown,
 *   - prepare failure fails CLOSED (structured error, inner never runs),
 *   - missing tenant context ledgers under the ADMIN tenant (every destructive
 *     attempt gets a prepared row; never a second authz gate),
 *   - settle/markUnknown failures never break the tool result / original throw.
 *
 * All DB interaction is via injected fakes (deps param) — no pg pool touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  withActionLedger,
  outcomeFromResult,
  errorFromResult,
  reasonFromThrow,
  LEDGER_OPT_IN_TOOL_NAMES,
  type ActionLedgerDeps,
} from "../../server/tools/middleware/action-ledger";
import {
  getCurrentLedgerAttempt,
  runWithLedgerRetryDirective,
  takeLedgerAttemptForSignal,
} from "../../server/lib/action-ledger-context";
import { runWithToolAbortSignal } from "../../server/lib/tool-abort-context";

const toolsSrc = readFileSync(path.join(process.cwd(), "server/tools.ts"), "utf8");
const mwSrc = readFileSync(
  path.join(process.cwd(), "server/tools/middleware/action-ledger.ts"),
  "utf8",
);

// ---------- static seam assertions ----------

test("S2: executeTool imports and wraps dispatch with withActionLedger", () => {
  assert.ok(
    toolsSrc.includes('import { withActionLedger } from "./tools/middleware/action-ledger"'),
    "executeTool must import withActionLedger",
  );
  assert.ok(
    toolsSrc.includes("withActionLedger(name, params, () => _executeToolInner(name, params))"),
    "withActionLedger must wrap _executeToolInner at the dispatch seam",
  );
});

test("S2: middleware module is acyclic (call-time dynamic imports only)", () => {
  assert.ok(
    mwSrc.includes('import("../../safety/destructive-tool-policy")'),
    "policy must be a call-time dynamic import",
  );
  assert.ok(
    mwSrc.includes('import("../../lib/action-ledger")'),
    "ledger lib must be a call-time dynamic import",
  );
  // S3/S5 carve-out: the ledger-context module is the ONE permitted static
  // import — it is zero-dep (node:async_hooks only), so it creates no edge
  // back into the app graph and touches no pg pool. Matches multi-line
  // imports too (S5 widened the named-import list).
  const withoutTypeImports = mwSrc.replace(/import type[^\n]*\n/g, "");
  const staticAppImportPaths = [...withoutTypeImports.matchAll(/from ["'](\.\.\/\.\.\/[^"']+)["']/g)].map(m => m[1]);
  assert.deepEqual(
    staticAppImportPaths,
    ["../../lib/action-ledger-context"],
    "only the zero-dep ledger-context module may be statically imported",
  );
  // S5: tool-abort-context must stay a call-time DYNAMIC import (the single
  // static-import carve-out slot belongs to action-ledger-context).
  assert.ok(
    mwSrc.includes('import("../../lib/tool-abort-context")'),
    "tool-abort-context must be a call-time dynamic import",
  );
  const ctxSrc = readFileSync(
    path.join(process.cwd(), "server/lib/action-ledger-context.ts"),
    "utf8",
  );
  const ctxImports = ctxSrc.split("\n").filter(l => /^import /.test(l));
  assert.ok(
    ctxImports.every(l => l.includes('"node:')),
    "action-ledger-context must stay zero-dep (node: builtins only) or the carve-out is invalid",
  );
});

// ---------- pure helpers ----------

test("S2: outcomeFromResult maps error-shaped results to failed", () => {
  assert.equal(outcomeFromResult({ ok: true }), "committed");
  assert.equal(outcomeFromResult(undefined), "committed");
  assert.equal(outcomeFromResult("text"), "committed");
  assert.equal(outcomeFromResult({ error: "boom" }), "failed");
  assert.equal(outcomeFromResult({ error: { code: 500 } }), "failed");
  assert.equal(outcomeFromResult({ error: "" }), "committed"); // falsy error ≠ failure
});

test("S2: errorFromResult bounds and stringifies", () => {
  assert.equal(errorFromResult({ error: "x".repeat(3000) })!.length, 2000);
  assert.equal(errorFromResult({ error: { code: 7 } }), '{"code":7}');
  assert.equal(errorFromResult({ ok: 1 }), undefined);
});

test("S2: reasonFromThrow prefixes and bounds", () => {
  assert.equal(reasonFromThrow(new Error("kaput")), "throw: kaput");
  assert.ok(reasonFromThrow("y".repeat(5000)).length <= 2007);
});

// ---------- behavior with injected fakes ----------

function makeDeps(overrides: Partial<ActionLedgerDeps> & { risk?: "safe" | "sensitive" | "destructive" } = {}) {
  const calls: string[] = [];
  const risk = overrides.risk ?? "destructive";
  const deps: ActionLedgerDeps = {
    getEffectiveToolRisk: overrides.getEffectiveToolRisk ?? (() => risk),
    ledgerObligation: overrides.ledgerObligation ?? ((r) => (r === "destructive" ? "mandatory" : r === "sensitive" ? "opt-in" : "never")),
    prepareAttempt:
      overrides.prepareAttempt ??
      (async (i) => {
        calls.push(`prepare:${i.toolName}:t${i.tenantId}`);
        return { id: 42, idempotencyKey: "vc-al1-test", argumentsHash: "h" };
      }),
    settleAttempt:
      overrides.settleAttempt ??
      (async (id, tenantId, outcome, opts) => {
        calls.push(`settle:${id}:t${tenantId}:${outcome}:${opts?.error ?? ""}`);
        return true;
      }),
    markUnknown:
      overrides.markUnknown ??
      (async (id, tenantId, reason) => {
        calls.push(`unknown:${id}:t${tenantId}:${reason ?? ""}`);
        return true;
      }),
    adminTenantId: overrides.adminTenantId ?? 1,
  };
  return { deps, calls };
}

test("S2 parity: safe tool passes through with ZERO ledger calls", async () => {
  const { deps, calls } = makeDeps({ risk: "safe" });
  const marker = { ok: "untouched" };
  const out = await withActionLedger("read_file", { _tenantId: 1 }, async () => marker, deps);
  assert.equal(out, marker, "result object must be the exact inner return (byte-identical path)");
  assert.deepEqual(calls, []);
});

test("S2/S4 parity: sensitive tool NOT in the opt-in set is NOT ledgered", async () => {
  const { deps, calls } = makeDeps({ risk: "sensitive" });
  const out = await withActionLedger("update_thing", { _tenantId: 1 }, async () => "r", deps);
  assert.equal(out, "r");
  assert.deepEqual(calls, []);
});

test("S4 opt-in: send_email (sensitive, in LEDGER_OPT_IN_TOOL_NAMES) IS ledgered", async () => {
  assert.ok(LEDGER_OPT_IN_TOOL_NAMES.has("send_email"), "send_email must be in the platform opt-in set");
  const { deps, calls } = makeDeps({ risk: "sensitive" });
  const out = await withActionLedger("send_email", { _tenantId: 7, to: "x@y.z" }, async () => ({ sent: true }), deps);
  assert.deepEqual(out, { sent: true });
  assert.deepEqual(calls, ["prepare:send_email:t7", "settle:42:t7:committed:"]);
});

test("S4 opt-in: ledgered send_email exposes the ALS attempt (header-stamp seam)", async () => {
  const { deps } = makeDeps({ risk: "sensitive" });
  let seen: ReturnType<typeof getCurrentLedgerAttempt>;
  await withActionLedger("send_email", { _tenantId: 7 }, async () => {
    seen = getCurrentLedgerAttempt();
    return { sent: true };
  }, deps);
  assert.equal(seen?.idempotencyKey, "vc-al1-test");
  assert.equal(seen?.toolName, "send_email");
});

test("S2: destructive success → prepare then settle committed", async () => {
  const { deps, calls } = makeDeps();
  const out = await withActionLedger(
    "delete_everything",
    { _tenantId: 7, _conversationId: 3, x: 1 },
    async () => ({ ok: true }),
    deps,
  );
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(calls, ["prepare:delete_everything:t7", "settle:42:t7:committed:"]);
});

test("S2: destructive error-shaped result → settle failed with bounded error", async () => {
  const { deps, calls } = makeDeps();
  const out = await withActionLedger("delete_everything", { _tenantId: 7 }, async () => ({ error: "nope" }), deps);
  assert.deepEqual(out, { error: "nope" });
  assert.deepEqual(calls, ["prepare:delete_everything:t7", "settle:42:t7:failed:nope"]);
});

test("S2: destructive throw → markUnknown then rethrow original", async () => {
  const { deps, calls } = makeDeps();
  await assert.rejects(
    () => withActionLedger("delete_everything", { _tenantId: 7 }, async () => { throw new Error("timeout"); }, deps),
    /timeout/,
  );
  assert.deepEqual(calls, ["prepare:delete_everything:t7", "unknown:42:t7:throw: timeout"]);
});

test("S2: prepare failure fails CLOSED — inner never runs", async () => {
  const { deps, calls } = makeDeps({
    prepareAttempt: async () => { throw new Error("db down"); },
  });
  let innerRan = false;
  const out = await withActionLedger("delete_everything", { _tenantId: 7 }, async () => { innerRan = true; return "x"; }, deps);
  assert.equal(innerRan, false, "destructive side effect must NOT execute unrecorded");
  assert.ok(typeof out?.error === "string" && out.error.includes("fail-closed"));
  assert.deepEqual(calls, []);
});

test("S2: missing/invalid tenant is ledgered under the ADMIN tenant (never unrecorded)", async () => {
  for (const params of [{}, { _tenantId: 0 }, { _tenantId: -3 }, { _tenantId: 1.5 }, { _tenantId: "1" }]) {
    const { deps, calls } = makeDeps({ adminTenantId: 99 });
    const out = await withActionLedger("delete_everything", params as any, async () => "ran", deps);
    assert.equal(out, "ran", "tool still runs — the ledger is not an authz gate");
    assert.deepEqual(calls, ["prepare:delete_everything:t99", "settle:42:t99:committed:"],
      "the attempt MUST get a prepared+settled row under the admin fallback tenant");
  }
});

test("S2: missing tenant + prepare failure still fails CLOSED (no unrecorded destructive path)", async () => {
  const { deps, calls } = makeDeps({ prepareAttempt: async () => { throw new Error("db down"); } });
  let innerRan = false;
  const out = await withActionLedger("delete_everything", {}, async () => { innerRan = true; return "x"; }, deps);
  assert.equal(innerRan, false);
  assert.ok(typeof out?.error === "string" && out.error.includes("fail-closed"));
  assert.deepEqual(calls, []);
});

test("S2: ledger metadata never trusts caller-supplied _conversationId", async () => {
  let seenConversationId: unknown = "unset";
  const { deps } = makeDeps({
    prepareAttempt: async (i) => {
      seenConversationId = i.conversationId;
      return { id: 42, idempotencyKey: "vc-al1-test", argumentsHash: "h" };
    },
  });
  await withActionLedger("delete_everything", { _tenantId: 7, _conversationId: 12345 }, async () => "r", deps);
  assert.equal(seenConversationId, null, "conversation_id must not be sourced from untrusted params");
});

test("S2: settle failure never breaks the tool result", async () => {
  const { deps } = makeDeps({ settleAttempt: async () => { throw new Error("settle boom"); } });
  const out = await withActionLedger("delete_everything", { _tenantId: 7 }, async () => ({ ok: 1 }), deps);
  assert.deepEqual(out, { ok: 1 });
});

test("S2: markUnknown failure never masks the original throw", async () => {
  const { deps } = makeDeps({ markUnknown: async () => { throw new Error("mu boom"); } });
  await assert.rejects(
    () => withActionLedger("delete_everything", { _tenantId: 7 }, async () => { throw new Error("original"); }, deps),
    /original/,
  );
});

test("S2: classification plumbing failure fails OPEN (tool still runs, no ledger)", async () => {
  const { deps, calls } = makeDeps({ getEffectiveToolRisk: () => { throw new Error("policy broken"); } });
  const out = await withActionLedger("delete_everything", { _tenantId: 7 }, async () => "ran", deps);
  assert.equal(out, "ran");
  assert.deepEqual(calls, []);
});

// ---------- S3: ALS idempotency-key threading ----------

test("S3: ledgered dispatch exposes the prepared attempt via ALS to the inner subtree", async () => {
  const { deps } = makeDeps();
  let seen: ReturnType<typeof getCurrentLedgerAttempt>;
  await withActionLedger("delete_everything", { _tenantId: 7 }, async () => {
    // nested async frame — depth-independence
    await Promise.resolve();
    seen = getCurrentLedgerAttempt();
    return "r";
  }, deps);
  assert.deepEqual(seen, {
    attemptId: 42,
    idempotencyKey: "vc-al1-test",
    tenantId: 7,
    toolName: "delete_everything",
  });
  assert.equal(getCurrentLedgerAttempt(), undefined, "context must not leak past the dispatch");
});

test("S3: non-ledgered tools NEVER enter the ALS context (parity holds)", async () => {
  const { deps } = makeDeps({ risk: "safe" });
  let seen: unknown = "unset";
  await withActionLedger("read_file", { _tenantId: 7 }, async () => {
    seen = getCurrentLedgerAttempt();
    return "r";
  }, deps);
  assert.equal(seen, undefined);
});

test("S3: context is absent after a ledgered dispatch throws", async () => {
  const { deps } = makeDeps();
  await assert.rejects(() =>
    withActionLedger("delete_everything", { _tenantId: 7 }, async () => { throw new Error("boom"); }, deps),
  );
  assert.equal(getCurrentLedgerAttempt(), undefined);
});

// ---------- S5: retry directive + signal registration ----------

const RETRY_KEY = "vc-al1-" + "a".repeat(48);

test("S5: matching retry directive threads reuseIdempotencyKey + retryOfAttemptId into prepare", async () => {
  let seen: any;
  const { deps } = makeDeps({
    prepareAttempt: async (i) => {
      seen = i;
      return { id: 43, idempotencyKey: i.reuseIdempotencyKey ?? "vc-al1-test", argumentsHash: "h" };
    },
  });
  await runWithLedgerRetryDirective(
    { toolName: "delete_everything", reuseIdempotencyKey: RETRY_KEY, retryOfAttemptId: 42 },
    () => withActionLedger("delete_everything", { _tenantId: 7 }, async () => "r", deps),
  );
  assert.equal(seen.reuseIdempotencyKey, RETRY_KEY);
  assert.equal(seen.retryOfAttemptId, 42);
});

test("S5: mismatched tool name IGNORES the retry directive (fresh key)", async () => {
  let seen: any;
  const { deps } = makeDeps({
    prepareAttempt: async (i) => {
      seen = i;
      return { id: 44, idempotencyKey: "vc-al1-test", argumentsHash: "h" };
    },
  });
  await runWithLedgerRetryDirective(
    { toolName: "some_other_tool", reuseIdempotencyKey: RETRY_KEY, retryOfAttemptId: 42 },
    () => withActionLedger("delete_everything", { _tenantId: 7 }, async () => "r", deps),
  );
  assert.equal(seen.reuseIdempotencyKey, undefined, "directive for another tool must not apply");
  assert.equal(seen.retryOfAttemptId, undefined);
});

test("S5: no directive ⇒ prepare receives neither retry field (parity)", async () => {
  let seen: any;
  const { deps } = makeDeps({
    prepareAttempt: async (i) => {
      seen = i;
      return { id: 45, idempotencyKey: "vc-al1-test", argumentsHash: "h" };
    },
  });
  await withActionLedger("delete_everything", { _tenantId: 7 }, async () => "r", deps);
  assert.ok(!("reuseIdempotencyKey" in seen) || seen.reuseIdempotencyKey === undefined);
  assert.ok(!("retryOfAttemptId" in seen) || seen.retryOfAttemptId === undefined);
});

test("S5: ledgered dispatch registers the prepared attempt on the current abort signal", async () => {
  const { deps } = makeDeps();
  const controller = new AbortController();
  await runWithToolAbortSignal(controller.signal, () =>
    withActionLedger("delete_everything", { _tenantId: 7 }, async () => "r", deps),
  );
  const reg = takeLedgerAttemptForSignal(controller.signal);
  assert.equal(reg?.attemptId, 42);
  assert.equal(reg?.idempotencyKey, "vc-al1-test");
  assert.equal(reg?.tenantId, 7);
  assert.equal(reg?.toolName, "delete_everything");
  assert.ok(reg?.startedAt instanceof Date, "startedAt must be captured for the probe lookback window");
  assert.equal(takeLedgerAttemptForSignal(controller.signal), undefined, "take must remove the entry (single claim)");
});

test("S5: non-ledgered tools NEVER register on the signal (parity)", async () => {
  const { deps } = makeDeps({ risk: "safe" });
  const controller = new AbortController();
  await runWithToolAbortSignal(controller.signal, () =>
    withActionLedger("read_file", { _tenantId: 7 }, async () => "r", deps),
  );
  assert.equal(takeLedgerAttemptForSignal(controller.signal), undefined);
});

test("S5: no abort signal in context ⇒ no registration, dispatch unaffected", async () => {
  const { deps, calls } = makeDeps();
  const out = await withActionLedger("delete_everything", { _tenantId: 7 }, async () => "ran", deps);
  assert.equal(out, "ran");
  assert.deepEqual(calls, ["prepare:delete_everything:t7", "settle:42:t7:committed:"]);
});
