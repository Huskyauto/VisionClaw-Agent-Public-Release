import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  RlmWorkerSession,
  buildBootstrapSource,
  createBudgetedSubLLM,
} from "../../server/recursive-llm.ts";

// Regression guard for the recursive-llm.ts VM sandbox escape (external review
// 2026-07-08, empirically reproduced this session: the original sandbox leaked
// 262 host process.env keys). recursive-llm.ts backs the tenant-reachable
// `recursive_synthesize` tool and runs LLM-generated JS in a vm context. Three
// controls must hold together:
//   1. subLLM reboxes the host Promise into a sandbox-realm Promise resolving
//      only String(v) — no host object crosses the boundary.
//   2. The context global is Object.create(null) — no host Object.prototype in
//      the chain, so `this.constructor` is undefined.
//   3. The executed code runs in a strict-mode REGULAR async function — `this`
//      is undefined, closing the this.constructor.constructor -> host Function
//      chain even if (2) regressed.
// codeGeneration:{strings:false} alone does NOT stop this — a host Function runs
// in the host realm, unrestricted by the context's flag.

const SRC = fs.readFileSync(
  path.join(process.cwd(), "server/recursive-llm.ts"),
  "utf8",
);

test("subLLM reboxes into a sandbox-realm Promise resolving only String(v)", () => {
  // The wrapper must NOT return the host promise directly.
  assert.doesNotMatch(
    SRC,
    /globalThis\.subLLM\s*=\s*function\s+subLLM\([^)]*\)\s*\{\s*return\s+__h\.callSubLLM/,
    "subLLM returns the host-realm promise directly — escape reopened",
  );
  // It must wrap in a new Promise and resolve String(v).
  assert.match(SRC, /globalThis\.subLLM\s*=\s*function\s+subLLM/);
  assert.match(SRC, /const\s+__hostP\s*=\s*__h\.callSubLLM\(/);
  assert.match(SRC, /return\s+new\s+Promise\(/);
  assert.match(SRC, /resolve\(String\(v\)\)/);
});

test("context global is a null-prototype bag (no host Object.prototype)", () => {
  // The vm context is now built inside the worker source; it must still start
  // from Object.create(null) so `this.constructor` is undefined.
  assert.match(SRC, /sandbox\s*=\s*Object\.create\(null\)/);
  // The old vulnerable literal form must be gone.
  assert.doesNotMatch(
    SRC,
    /sandbox\s*=\s*\{\s*\n?\s*__host/,
    "sandbox is a plain host object literal — host prototype leaks in",
  );
});

test("the vm executes inside a worker thread spawned with an EMPTY env", () => {
  // Worker isolation is the hard backstop for the async-DoS class: a wedged
  // worker can be terminate()d. The empty env means no secrets ever reach it.
  assert.match(SRC, /new\s+Worker\(RLM_WORKER_SOURCE/);
  assert.match(SRC, /eval:\s*true/);
  assert.match(SRC, /env:\s*\{\}/);
  assert.match(SRC, /worker\.terminate\(\)/);
});

test("executed code runs in a strict-mode regular async function (this === undefined)", () => {
  assert.match(SRC, /async function \(\)\s*\{\s*"use strict"/);
  // The old vulnerable arrow wrapper must be gone.
  assert.doesNotMatch(
    SRC,
    /const\s+wrapped\s*=\s*`\(async \(\)\s*=>/,
    "arrow wrapper inherits lexical `this` (the global) — escape reopened",
  );
});

test("blocklist validation runs BEFORE the code is executed in the vm", () => {
  assert.match(SRC, /const\s+blockErr\s*=\s*validateSandboxCode\(code\)/);
  const gateIdx = SRC.indexOf("validateSandboxCode(code)");
  const runIdx = SRC.indexOf("session.runBlock(wrapped)");
  assert.ok(gateIdx > 0 && runIdx > 0, "both markers present");
  assert.ok(gateIdx < runIdx, "validation must gate BEFORE execution");
});

// --- Runtime proof: replicate the EXACT sandbox construction and assert the
// obfuscated constructor-chain payload cannot reach host process.env.
function buildRlmContext() {
  const sandbox: any = Object.create(null);
  sandbox.__stdout = "";
  const ctx = vm.createContext(sandbox, {
    name: "rlm-sandbox-test",
    codeGeneration: { strings: false, wasm: false },
  });
  return { sandbox, ctx };
}

function runInRlm(ctx: vm.Context, code: string): string {
  const wrapped = `(async function () { "use strict";\n${code}\n })()`;
  try {
    vm.runInContext(wrapped, ctx, { timeout: 1000 });
  } catch {
    // synchronous throw is fine — the point is no host leak
  }
  return "";
}

const escapeProbes: Array<[string, string]> = [
  [
    "this constructor-chain split-string",
    `try { const F = this["constr"+"uctor"]["constr"+"uctor"]; globalThis.__leak = String(F("return this['pro'+'cess'] ? Object.keys(this['pro'+'cess'].env).length : 'NONE'")()); } catch (e) { globalThis.__leak = "BLOCKED"; }`,
  ],
  [
    "dotted this.constructor.constructor",
    `try { globalThis.__leak = String(this.constructor.constructor("return process.env")()); } catch (e) { globalThis.__leak = "BLOCKED"; }`,
  ],
];

for (const [name, code] of escapeProbes) {
  test(`no host process leak (runtime): ${name}`, () => {
    const { sandbox, ctx } = buildRlmContext();
    runInRlm(ctx, code);
    const leak = sandbox.__leak;
    // Must not have returned a numeric count of env keys (i.e. host process.env).
    assert.ok(
      leak === undefined || leak === "BLOCKED" || Number.isNaN(Number(leak)),
      `escape leaked host process.env: __leak=${leak}`,
    );
  });
}

// --- Availability: the async boundary must not let sandbox code hang the host.
// The host bounds each block with Promise.race([result, timeout]) and therefore
// AWAITS the sandbox-returned promise. If sandbox code could redefine
// Promise.prototype.then, host-side thenable assimilation would run attacker code
// on the host event loop OUTSIDE the vm timeout (a synchronous loop no host timer
// can interrupt). The bootstrap freezes the Promise intrinsic to fail that closed.
test("bootstrap locks the Promise intrinsic before any user code runs", () => {
  assert.match(SRC, /function lockPromiseIntrinsic/);
  // then/catch/finally must be made non-writable + non-configurable.
  assert.match(
    SRC,
    /Object\.defineProperty\(P,\s*k,\s*\{\s*value:\s*P\[k\],\s*writable:\s*false,\s*configurable:\s*false\s*\}\)/,
  );
  assert.match(SRC, /for\s*\(const k of \["then",\s*"catch",\s*"finally"\]\)/);
  // The lock lives in buildBootstrapSource, which the worker executes via
  // vm.runInContext(msg.bootstrapSource) at INIT — structurally before any user
  // code, which runs later via vm.runInContext(msg.wrapped) in the run handler.
  const lockIdx = SRC.indexOf("lockPromiseIntrinsic");
  const bootstrapRunIdx = SRC.indexOf("vm.runInContext(msg.bootstrapSource");
  const userRunIdx = SRC.indexOf("vm.runInContext(msg.wrapped");
  assert.ok(lockIdx > 0 && bootstrapRunIdx > 0 && userRunIdx > 0, "all markers present");
  assert.ok(
    bootstrapRunIdx < userRunIdx,
    "bootstrap (containing the freeze) must execute before user code",
  );
});

// --- Runtime proof: replicate the freeze + host-await pattern and assert the
// then-override DoS vector is BOUNDED (rejects fast), not a host hang, and that
// benign async still resolves. (The plain-object-thenable variant is a separate,
// documented class that requires worker-thread isolation — deliberately NOT
// exercised here because it would hang the test process by design.)
function buildFrozenRlmContext() {
  const { sandbox, ctx } = buildRlmContext();
  vm.runInContext(
    `(function () {
      try {
        const P = Promise.prototype;
        for (const k of ["then", "catch", "finally"]) {
          Object.defineProperty(P, k, { value: P[k], writable: false, configurable: false });
        }
        Object.defineProperty(globalThis, "Promise", { value: Promise, writable: false, configurable: false });
      } catch (_) {}
    })();`,
    ctx,
    { timeout: 1000 },
  );
  return { sandbox, ctx };
}

async function runAndBound(ctx: vm.Context, code: string, budgetMs: number) {
  const wrapped = `(async function () { "use strict";\n${code}\n })()`;
  const result = vm.runInContext(wrapped, ctx, { timeout: 1000 });
  const t0 = Date.now();
  let outcome: "resolved" | "rejected";
  try {
    await Promise.race([
      result,
      new Promise((_, reject) => setTimeout(() => reject(new Error("HOST-TIMEOUT")), budgetMs)),
    ]);
    outcome = "resolved";
  } catch {
    outcome = "rejected";
  }
  return { outcome, elapsed: Date.now() - t0 };
}

test("async DoS vector A (override Promise.prototype.then) is bounded, not a host hang", async () => {
  const { ctx } = buildFrozenRlmContext();
  const { outcome, elapsed } = await runAndBound(
    ctx,
    `Promise.prototype.then = function () { while (true) {} }; return 1;`,
    1500,
  );
  // Frozen intrinsic => the strict reassignment throws => promise rejects fast.
  assert.equal(outcome, "rejected", "override-then should reject, not hang");
  assert.ok(elapsed < 1000, `should reject well under the host timeout (was ${elapsed}ms)`);
});

test("benign async still resolves promptly under the Promise freeze", async () => {
  const { ctx } = buildFrozenRlmContext();
  const { outcome, elapsed } = await runAndBound(
    ctx,
    `await Promise.resolve(1); return 2;`,
    1500,
  );
  assert.equal(outcome, "resolved", "benign async must not be broken by the freeze");
  assert.ok(elapsed < 1000, `benign async should resolve fast (was ${elapsed}ms)`);
});

// --- Legitimate RLM prose in string args must NOT be blocked by the blocklist
// (the validator strips string/template literals + comments before scanning).
test("blocklist static-scan: strips literals so prose like 'process' passes", () => {
  // Assert the validator strips literals + comments before matching.
  assert.match(SRC, /function stripLiteralsAndComments/);
  assert.match(SRC, /const\s+scannable\s*=\s*stripLiteralsAndComments\(code\)/);
  // BLOCKED_PATTERNS must include the core dangerous constructs.
  for (const needle of ["process", "child_process", "constructor", "__proto__", "globalThis"]) {
    assert.ok(SRC.includes(needle), `blocklist should reference ${needle}`);
  }
});

// --- Runtime proof (Vectors B/C): the worker-thread rebuild is the HARD backstop
// for the plain-object-thenable async-DoS class the Promise freeze cannot reach.
// A malicious thenable's `.then` runs on the WORKER event loop; no in-worker timer
// can fire while it spins, so the HOST watchdog must terminate() the worker. These
// exercise the real RlmWorkerSession with SHORT budgets. Every session MUST be
// terminated (a live worker keeps the pg-free test process from exiting → 124).
//
// subLLM is stubbed (no network, no DB) so these are hermetic.
const STUB_SUBLLM = async (text: string) => `echo:${text}`;

function wrap(code: string): string {
  return `(async function () { "use strict";\n${code}\n })()`;
}

async function withSession(
  opts: { totalTimeoutMs?: number; watchdogGraceMs?: number; syncTimeoutMs?: number },
  fn: (s: RlmWorkerSession) => Promise<void>,
): Promise<void> {
  const session = new RlmWorkerSession({
    onSubLLM: STUB_SUBLLM,
    totalTimeoutMs: opts.totalTimeoutMs ?? 400,
    watchdogGraceMs: opts.watchdogGraceMs ?? 300,
    syncTimeoutMs: opts.syncTimeoutMs ?? 400,
    bootstrapTimeoutMs: 1000,
    initTimeoutMs: 4000,
  });
  try {
    const init = await session.init(buildBootstrapSource("unit-test prompt"));
    assert.ok(init.ok, `worker init failed: ${init.error}`);
    await fn(session);
  } finally {
    await session.terminate();
  }
}

test("Vector B: a RETURNED plain-object thenable that spins is killed by terminate()", async () => {
  await withSession({}, async (session) => {
    const t0 = Date.now();
    const res = await session.runBlock(wrap(`return { then() { while (true) {} } };`));
    const elapsed = Date.now() - t0;
    assert.equal(res.wedged, true, "wedged worker must be reported as wedged");
    assert.equal(session.alive, false, "worker must be terminated (not alive) after a wedge");
    // watchdog fires at totalTimeoutMs(400)+grace(300)=700ms; give generous slack.
    assert.ok(elapsed < 3000, `host watchdog should fire promptly (was ${elapsed}ms)`);
  });
});

test("Vector C: an AWAITED plain-object thenable that spins is killed by terminate()", async () => {
  await withSession({}, async (session) => {
    const t0 = Date.now();
    const res = await session.runBlock(wrap(`await { then() { while (true) {} } }; return 1;`));
    const elapsed = Date.now() - t0;
    assert.equal(res.wedged, true, "wedged worker must be reported as wedged");
    assert.equal(session.alive, false, "worker must be terminated after a wedge");
    assert.ok(elapsed < 3000, `host watchdog should fire promptly (was ${elapsed}ms)`);
  });
});

test("a SYNChronous infinite loop is caught by the vm sync-timeout (error, NOT a wedge)", async () => {
  await withSession({ syncTimeoutMs: 300 }, async (session) => {
    const res = await session.runBlock(wrap(`while (true) {}`));
    // vm.runInContext throws on the sync timeout — a normal error, worker survives.
    assert.equal(res.wedged, false, "a sync-timeout is not a wedge");
    assert.ok(res.error, "sync-timeout must surface an error");
    assert.equal(session.alive, true, "worker survives a sync-timeout and can run again");
    // Prove survival: a benign follow-up block still runs.
    const ok = await session.runBlock(wrap(`setFinal("survived");`));
    assert.equal(ok.final, "survived", "worker must stay usable after a sync-timeout");
  });
});

test("benign state persists across blocks in the same worker session", async () => {
  await withSession({}, async (session) => {
    const first = await session.runBlock(wrap(`globalThis.__persist = 42; print("set");`));
    assert.equal(first.wedged, false);
    assert.equal(first.error, null, `first block errored: ${first.error}`);
    const second = await session.runBlock(wrap(`setFinal(String(globalThis.__persist));`));
    assert.equal(second.final, "42", "globals must persist across blocks in one session");
  });
});

test("subLLM round-trips through the host bridge and resolves a string", async () => {
  await withSession({}, async (session) => {
    const res = await session.runBlock(wrap(`const r = await subLLM("hi"); setFinal(r);`));
    assert.equal(res.wedged, false);
    assert.equal(res.final, "echo:hi", "subLLM must round-trip host→worker→host");
  });
});

// Regression for the atomic-budget-cap fix (architect MEDIUM, 2026-07-09):
// the tenant-reachable subLLM cost ceiling MUST hold even when the worker fires
// many subLLM requests concurrently. The pre-fix code checked `subCalls >= max`
// BEFORE awaiting a concurrency slot and incremented AFTER, so a synchronous
// burst of N requests all passed the pre-slot check (subCalls still 0) and then
// each incremented past the cap — unbounded outbound model calls. The fix makes
// check-and-increment a single synchronous critical section. Hermetic: no worker,
// no network, no DB (a stubbed `perform`), so it can't hang the pg-free process.
test("subLLM atomic budget cap holds under a concurrent burst (>maxCalls fired at once)", async () => {
  const MAX = 50;
  const state = { subCalls: 0, totalSubPromptChars: 0, totalSubResponseChars: 0 };
  let performCalls = 0;
  let curInFlight = 0;
  let peakInFlight = 0;
  const perform = async (p: string): Promise<string> => {
    performCalls++;
    curInFlight++;
    peakInFlight = Math.max(peakInFlight, curInFlight);
    // Hold the slot briefly so callers genuinely queue on the semaphore and the
    // reservation race (if any) has a window to manifest.
    await new Promise((r) => setTimeout(r, 20));
    curInFlight--;
    return `ok:${p}`;
  };
  const call = createBudgetedSubLLM(
    state,
    { maxCalls: MAX, maxConcurrency: 8, maxPromptChars: 1000 },
    perform,
  );

  const BURST = 200;
  const results = await Promise.allSettled(
    Array.from({ length: BURST }, (_, i) => call(`p${i}`)),
  );
  const overCap = results.filter(
    (r) =>
      r.status === "rejected" &&
      /budget exceeded/.test(String((r as PromiseRejectedResult).reason?.message ?? r)),
  ).length;

  assert.equal(
    performCalls,
    MAX,
    `raw subLLM executor must run at most maxCalls times (was ${performCalls})`,
  );
  assert.equal(
    state.subCalls,
    MAX,
    `reservation count must cap EXACTLY at maxCalls (was ${state.subCalls})`,
  );
  assert.equal(
    overCap,
    BURST - MAX,
    `every request beyond the cap must reject deterministically (was ${overCap})`,
  );
  assert.ok(
    peakInFlight <= 8,
    `concurrency semaphore must bound in-flight to maxConcurrency (peak ${peakInFlight})`,
  );
});

// Locks in the INTENTIONAL conservative semantics of the budget cap: a reservation
// is taken synchronously BEFORE perform() runs and is NEVER refunded when perform()
// fails. This is a deliberate fail-safe direction for a cost ceiling (over-count,
// never under-count) — a refund-on-failure would reopen a retry-storm amplification
// where an attacker forces perform() to error repeatedly and burns unbounded calls.
test("subLLM budget reservation is permanent — a failed perform() still consumes its slot", async () => {
  const MAX = 2;
  const state = { subCalls: 0, totalSubPromptChars: 0, totalSubResponseChars: 0 };
  let performCalls = 0;
  const perform = async (_p: string): Promise<string> => {
    performCalls++;
    throw new Error("boom");
  };
  const call = createBudgetedSubLLM(
    state,
    { maxCalls: MAX, maxConcurrency: 8, maxPromptChars: 1000 },
    perform,
  );

  // First MAX calls each reserve a slot then fail inside perform(); the wrapper
  // swallows the perform error into a sentinel string (does NOT reject) and does
  // NOT refund the reservation.
  const r1 = await call("a");
  const r2 = await call("b");
  assert.match(r1, /\[subLLM error: /, "failed perform() resolves to the error sentinel");
  assert.match(r2, /\[subLLM error: /, "failed perform() resolves to the error sentinel");
  assert.equal(state.subCalls, MAX, "each failed call must still consume its reservation");
  assert.equal(performCalls, MAX, "perform ran exactly maxCalls times");

  // The next call is over the (permanently consumed) budget and must hard-throw
  // BEFORE perform() is invoked — no refund reopened a slot.
  await assert.rejects(
    () => call("c"),
    /budget exceeded/,
    "a failed perform() must not refund the slot — the cap holds",
  );
  assert.equal(performCalls, MAX, "over-budget call must not reach perform()");
});
