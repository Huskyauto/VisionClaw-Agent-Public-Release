import test from "node:test";
import assert from "node:assert/strict";
import { newCompilationMatrix, compilationOperations, advanceCompilationMatrix } from "../../server/lib/company-compilation-matrix";
import { CompilationPreflightRejection } from "../../server/lib/company-compilation-matrix";
import { advanceParallelCompilation } from "../../server/lib/company-compilation-parallel";

test("nine authors overlap; each synthesis starts after its own three authors without waiting for other categories", async () => {
  const state = newCompilationMatrix("parallel-test");
  const releases = new Map<string, () => void>(), started: string[] = [];
  let checkpointActive = 0, maxCheckpointActive = 0;
  const run = advanceParallelCompilation(state, {
    checkpoint: async () => {
      checkpointActive++; maxCheckpointActive = Math.max(maxCheckpointActive, checkpointActive);
      await new Promise(resolve => setImmediate(resolve)); checkpointActive--;
    },
    request: async (op, drafts) => {
      started.push(op.key);
      if (op.stage === "author") await new Promise<void>(resolve => releases.set(op.key, resolve));
      else assert.equal(drafts.length, 3);
      return { text: op.key };
    },
    accept: (_op, raw: any) => raw.text,
  });
  for (let i = 0; i < 100 && releases.size < 9; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases.size, 9, "all authors must be in flight before any is released");
  for (const [key, release] of releases) if (key.startsWith("author:readiness:")) release();
  for (let i = 0; i < 100 && !started.some(key => key.startsWith("synthesis:readiness:")); i++)
    await new Promise(resolve => setImmediate(resolve));
  assert.ok(started.some(key => key.startsWith("synthesis:readiness:")));
  assert.ok(!started.some(key => key.startsWith("synthesis:executive:")));
  for (const release of releases.values()) release();
  await run;
  assert.equal(started.length, 12);
  assert.equal(maxCheckpointActive, 1);
  assert.equal(state.phase, "complete");
  await advanceParallelCompilation(state, { checkpoint: async () => {}, request: async () => {
    throw new Error("completed work must not be repurchased");
  }, accept: () => "" });
});

test("unspent correction and targeted-repair preflights resume, but received original receipts never change", async () => {
  const op = compilationOperations()[0];
  for (const targeted of [false, true]) {
    const state = newCompilationMatrix(`preflight-${targeted}`);
    const raw = { model: op.model, choices: [{ finish_reason: "stop", message: { content: "invalid saved report" } }] };
    let correctionCalls = 0, repairCalls = 0;
    const ports: Parameters<typeof advanceCompilationMatrix>[1] = {
      checkpoint: async () => {}, request: async () => structuredClone(raw),
      accept: (_op, value) => {
        if ((value as any)?.accepted) return "complete retained full report";
        throw Object.assign(new Error("Author compilation exceeds its synthesis input allowance"), { code: "COMPILATION_CONTENT_INVALID" });
      },
      correct: async () => {
        correctionCalls++;
        if (!targeted && correctionCalls === 1) throw new CompilationPreflightRejection(new Error("correction preflight"));
        return targeted ? structuredClone(raw) : { accepted: true };
      },
      targetedRepair: targeted ? { operation: op.key, request: async () => {
        repairCalls++;
        if (repairCalls === 1) throw new CompilationPreflightRejection(new Error("repair preflight"));
        return { accepted: true };
      } } : undefined,
    };
    await assert.rejects(advanceCompilationMatrix(state, ports), /preflight|synthesis input allowance/);
    if (targeted && !state.slots[op.key].targetedRepair) {
      state.phase = "authors";
      await assert.rejects(advanceCompilationMatrix(state, ports), /repair preflight/);
    }
    assert.equal((targeted ? state.slots[op.key].targetedRepair : state.slots[op.key].correction)?.preflightRejected, true);
    state.phase = "authors";
    await advanceCompilationMatrix(state, ports);
    assert.equal(state.slots[op.key].phase, "complete");
    assert.deepEqual(state.slots[op.key].raw, raw);
    assert.equal(correctionCalls, targeted ? 1 : 2);
    assert.equal(repairCalls, targeted ? 2 : 0);
  }
});

test("a proven pre-reservation rejection can resume without retrying uncertain siblings", async () => {
  const state = newCompilationMatrix("preflight");
  let requests = 0;
  const ports = { checkpoint: async () => {}, request: async (op: any) => {
    requests++;
    if (op.key === "author:readiness:gpt-5.4") throw new CompilationPreflightRejection(new Error("input preflight rejected"));
    return op.key;
  }, accept: (_op: any, raw: unknown) => String(raw) };
  await assert.rejects(advanceParallelCompilation(state, ports), /preflight/);
  assert.equal(state.slots["author:readiness:gpt-5.4"].preflightRejected, true);
  state.phase = "authors"; // Only an explicit owner Continue resets a stopped package.
  ports.request = async (op: any) => { requests++; return op.key; };
  await advanceParallelCompilation(state, ports);
  assert.equal(state.phase, "complete");
  assert.equal(requests, 13, "one unspent preflight, twelve actual operations, no sibling repurchase");
});

test("one author failure preserves all successful siblings and runs only eligible syntheses", async () => {
  const state = newCompilationMatrix("failed-author"), calls: string[] = [];
  await assert.rejects(advanceParallelCompilation(state, {
    checkpoint: async () => {},
    request: async op => {
      calls.push(op.key);
      if (op.key === "author:readiness:gpt-5.4") throw new Error("uncertain provider result");
      await new Promise(resolve => setImmediate(resolve));
      return op.key;
    },
    accept: (_op, raw) => String(raw),
  }), /uncertain/);
  assert.equal(state.phase, "blocked");
  assert.equal(Object.values(state.slots).filter(slot => slot.phase === "complete").length, 10);
  assert.equal(calls.some(key => key.startsWith("synthesis:readiness:")), false);
  assert.equal(calls.length, 11);
  assert.equal(state.slots["author:readiness:gpt-5.4"].phase, "claimed");
  await assert.rejects(advanceParallelCompilation(state, {
    checkpoint: async () => {}, request: async () => { throw new Error("must not run"); }, accept: () => "",
  }), /stopped/);
});
