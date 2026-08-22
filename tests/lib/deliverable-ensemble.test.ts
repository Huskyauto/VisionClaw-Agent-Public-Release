import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  draftWithEnsemble,
  loadEnsembleConfig,
  _resetGuardrailsForTest,
  DRAFTER_ALLOWLIST,
  AGGREGATOR_ALLOWLIST,
  type CompletionFn,
} from "../../server/lib/deliverable-ensemble";

const LONG = "x".repeat(300);
const baseArgs = { tenantId: 42, system: "sys", user: "brief", label: "test" };

beforeEach(() => {
  _resetGuardrailsForTest();
  delete process.env.PREMIUM_ENSEMBLE_ENABLED;
});

test("kill switch PREMIUM_ENSEMBLE_ENABLED=0 disables the lane", async () => {
  process.env.PREMIUM_ENSEMBLE_ENABLED = "0";
  const fn: CompletionFn = async () => { throw new Error("must not be called"); };
  assert.equal(await draftWithEnsemble({ ...baseArgs, _completionFn: fn }), null);
});

test("invalid tenantId returns null (fail-open, no calls)", async () => {
  const fn: CompletionFn = async () => { throw new Error("must not be called"); };
  assert.equal(await draftWithEnsemble({ ...baseArgs, tenantId: 0, _completionFn: fn }), null);
  assert.equal(await draftWithEnsemble({ ...baseArgs, tenantId: -3, _completionFn: fn }), null);
});

test("happy path: 3 drafts merged by aggregator, tenant threaded to every call", async () => {
  const calls: { model: string; tenant: number }[] = [];
  const fn: CompletionFn = async (model, tenant) => { calls.push({ model, tenant }); return LONG; };
  const r = await draftWithEnsemble({ ...baseArgs, _completionFn: fn });
  assert.ok(r);
  assert.equal(r!.mode, "ensemble");
  assert.equal(r!.drafters.length, 3);
  assert.equal(calls.length, 4); // 3 drafters + aggregator
  assert.ok(calls.every((c) => c.tenant === 42));
});

test("fewer than 2 successful drafts ⇒ null (fall back to free path)", async () => {
  let i = 0;
  const fn: CompletionFn = async () => { i++; return i === 1 ? LONG : Promise.reject(new Error("provider down")); };
  assert.equal(await draftWithEnsemble({ ...baseArgs, _completionFn: fn }), null);
});

test("aggregator failure ⇒ null, NEVER a partial paid draft", async () => {
  let n = 0;
  const fn: CompletionFn = async () => { n++; if (n <= 3) return LONG; throw new Error("agg down"); };
  assert.equal(await draftWithEnsemble({ ...baseArgs, _completionFn: fn }), null);
});

test("aggregator empty output ⇒ null", async () => {
  let n = 0;
  const fn: CompletionFn = async () => { n++; return n <= 3 ? LONG : ""; };
  assert.equal(await draftWithEnsemble({ ...baseArgs, _completionFn: fn }), null);
});

test("circuit breaker opens after 3 consecutive failures", async () => {
  const failFn: CompletionFn = async () => { throw new Error("down"); };
  for (let i = 0; i < 3; i++) {
    assert.equal(await draftWithEnsemble({ ...baseArgs, _completionFn: failFn }), null);
  }
  // Breaker now open: even a would-succeed run is skipped (fn never called).
  let called = false;
  const okFn: CompletionFn = async () => { called = true; return LONG; };
  assert.equal(await draftWithEnsemble({ ...baseArgs, _completionFn: okFn }), null);
  assert.equal(called, false);
});

test("override config: unknown drafters/aggregator rejected against allowlists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ens-"));
  const p = path.join(dir, "premium-ensemble.json");
  fs.writeFileSync(p, JSON.stringify({
    drafters: ["evil/expensive-model", "deepseek/deepseek-v4-pro-0813", "z-ai/glm-5.2"],
    aggregator: "claude-fable-5",
  }));
  const cfg = loadEnsembleConfig(p);
  assert.deepEqual(cfg.drafters, ["deepseek/deepseek-v4-pro-0813", "z-ai/glm-5.2"]);
  assert.equal(cfg.aggregator, "gpt-5.6-sol"); // unlisted aggregator kept default
  assert.ok([...cfg.drafters].every((d) => DRAFTER_ALLOWLIST.has(d)));
  assert.ok(AGGREGATOR_ALLOWLIST.has(cfg.aggregator));
});

test("override config: fewer than 2 allowlisted drafters keeps defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ens-"));
  const p = path.join(dir, "premium-ensemble.json");
  fs.writeFileSync(p, JSON.stringify({ drafters: ["evil/one", "deepseek/deepseek-v4-pro-0813"] }));
  const cfg = loadEnsembleConfig(p);
  assert.equal(cfg.drafters.length, 3); // defaults retained
});

test("corrupt override file fails open to defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ens-"));
  const p = path.join(dir, "premium-ensemble.json");
  fs.writeFileSync(p, "{not json");
  const cfg = loadEnsembleConfig(p);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.drafters.length, 3);
});
