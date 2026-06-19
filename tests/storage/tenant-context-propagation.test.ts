import { test, after } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "async_hooks";

// R74.13g — End-to-end propagation test for the chat → tool → ledger path.
//
// Verifies that when chat-engine resolves a tenantId via assertTenantContext
// and threads it into step-ledger's withRun(), every downstream record*()
// call inside the run inherits THAT tenantId — not 1, not undefined, not the
// caller's accidental fall-through.
//
// This is the integration shape that proves items 1–4 of "solid all the way
// down" compose correctly:
//   1. schema audit (T001)        — every ledger row has notNull tenantId
//   2. tenantScope helper (T002)  — every storage read scopes by tenantId
//   3. STRICT_TENANT_CONTEXT (T003) — every entry point asserts a real one
//   4. e2e propagation (T004)     — they actually meet end-to-end
//
// Uses the real step-ledger module (not a mock) and intercepts the
// `ledgerEvents.entry` event, which fires synchronously before the DB
// persist — so the test runs without DATABASE_URL.

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

const skipPersist = !process.env.DATABASE_URL;

test("chat→tool→ledger: AsyncLocalStorage carries tenantId set at chat-engine entry", async () => {
  const { startRun, runContext, currentRun, endRun } = await import("../../server/step-ledger");
  const handle = startRun({ tenantId: 42, personaId: 7, task: "test:propagation" });
  assert.equal(handle.tenantId, 42);
  await runContext.run(handle, async () => {
    const inner = currentRun();
    assert.ok(inner, "currentRun must return the active handle inside runContext.run");
    assert.equal(inner!.tenantId, 42);
    // Simulate a tool call deep in the call stack — still must see tenant 42.
    await Promise.resolve().then(() => {
      assert.equal(currentRun()!.tenantId, 42);
    });
  });
  endRun(handle.runId, { status: "completed" });
});

test("chat→tool→ledger: recordExecution emits entry with the run's tenantId", async () => {
  const { startRun, recordExecution, ledgerEvents, endRun } = await import("../../server/step-ledger");
  const handle = startRun({ tenantId: 99, task: "test:exec" });
  const captured: any[] = [];
  const listener = (e: any) => captured.push(e);
  ledgerEvents.on("entry", listener);
  try {
    await recordExecution(handle.runId, { tool: "test_tool", args: { x: 1 } });
    await recordExecution(handle.runId, { tool: "test_tool", result: "ok" });
  } finally {
    ledgerEvents.off("entry", listener);
    endRun(handle.runId, { status: "completed" });
  }
  // Filter to entries from THIS run (other tests/jobs may share the bus).
  const ours = captured.filter((e) => e.runId === handle.runId);
  assert.equal(ours.length, 2);
  for (const e of ours) {
    assert.equal(e.tenantId, 99, "every entry must inherit the run's tenantId");
    assert.equal(e.kind, "execution");
  }
});

test("chat→tool→ledger: ALL kinds (intent/proposal/exec/result/approval/note) carry tenantId", async () => {
  const { startRun, recordIntent, recordProposal, recordExecution, recordResult, recordApproval, recordNote, ledgerEvents, endRun } =
    await import("../../server/step-ledger");
  const handle = startRun({ tenantId: 123, personaId: 5, task: "test:all-kinds" });
  const captured: any[] = [];
  const listener = (e: any) => { if (e.runId === handle.runId) captured.push(e); };
  ledgerEvents.on("entry", listener);
  try {
    await recordIntent(handle.runId, { goal: "x" });
    await recordProposal(handle.runId, { plan: "y" });
    await recordExecution(handle.runId, { tool: "z" });
    await recordResult(handle.runId, { ok: true });
    await recordApproval(handle.runId, { approver: "test" });
    await recordNote(handle.runId, { note: "n" });
  } finally {
    ledgerEvents.off("entry", listener);
    endRun(handle.runId, { status: "completed" });
  }
  assert.equal(captured.length, 6);
  for (const e of captured) {
    assert.equal(e.tenantId, 123, `${e.kind} entry must carry run.tenantId`);
    assert.equal(e.personaId, 5, `${e.kind} entry must carry run.personaId`);
  }
  const kinds = captured.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["approval", "execution", "intent", "note", "proposal", "result"]);
});

test("chat→tool→ledger: record() fails-closed when no run AND no tenantId fallback", async () => {
  const { recordExecution, ledgerEvents } = await import("../../server/step-ledger");
  const captured: any[] = [];
  const listener = (e: any) => captured.push(e);
  ledgerEvents.on("entry", listener);
  // Suppress the expected warn output.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await recordExecution("nonexistent-run-id-xyz", { tool: "t" });
    assert.equal(result, null, "record() must return null when no tenantId can be resolved (no fall-through to 1)");
  } finally {
    console.warn = origWarn;
    ledgerEvents.off("entry", listener);
  }
  // Critically: no entry emitted, no fall-through to ADMIN_TENANT_ID.
  const stragglers = captured.filter((e) => e.runId === "nonexistent-run-id-xyz");
  assert.equal(stragglers.length, 0, "no entry should be emitted when tenantId cannot be resolved");
});

test("chat→tool→ledger: opts.tenantId overrides ONLY when no active run exists (legacy path)", async () => {
  const { recordExecution, ledgerEvents } = await import("../../server/step-ledger");
  const captured: any[] = [];
  const listener = (e: any) => captured.push(e);
  ledgerEvents.on("entry", listener);
  try {
    await recordExecution("orphan-run-with-explicit-tenant", { tool: "t" }, { tenantId: 77 });
  } finally {
    ledgerEvents.off("entry", listener);
  }
  const ours = captured.filter((e) => e.runId === "orphan-run-with-explicit-tenant");
  assert.equal(ours.length, 1);
  assert.equal(ours[0].tenantId, 77, "opts.tenantId is the legacy fallback when no run is active");
});

test("chat→tool→ledger: active run's tenantId is the source of truth (opts.tenantId ignored)", async () => {
  const { startRun, recordExecution, ledgerEvents, endRun } = await import("../../server/step-ledger");
  const handle = startRun({ tenantId: 555, task: "test:override-attempt" });
  const captured: any[] = [];
  const listener = (e: any) => { if (e.runId === handle.runId) captured.push(e); };
  ledgerEvents.on("entry", listener);
  try {
    // Caller tries to spoof a different tenant via opts — should be ignored.
    await recordExecution(handle.runId, { tool: "t" }, { tenantId: 999 });
  } finally {
    ledgerEvents.off("entry", listener);
    endRun(handle.runId, { status: "completed" });
  }
  assert.equal(captured.length, 1);
  assert.equal(captured[0].tenantId, 555, "active run's tenantId wins over opts.tenantId");
});

test("chat→tool→ledger: chat-engine assertTenantContext + step-ledger withRun cooperate end-to-end", async () => {
  const { assertTenantContext } = await import("../../server/storage-helpers/tenant-context");
  const { startRun, runContext, currentRun, recordExecution, ledgerEvents, endRun } =
    await import("../../server/step-ledger");

  // Simulate chat-engine.processMessage:
  //   const tenantId = assertTenantContext(conv.tenantId, "chat-engine:processMessage");
  //   withRun({ tenantId }, () => _processMessageImpl(...))
  const conv = { tenantId: 314, personaId: 9 };
  const tenantId = assertTenantContext(conv.tenantId, "test:chat-engine-sim");
  assert.equal(tenantId, 314);

  const handle = startRun({ tenantId, personaId: conv.personaId, task: "chat:1: hello" });
  const captured: any[] = [];
  const listener = (e: any) => { if (e.runId === handle.runId) captured.push(e); };
  ledgerEvents.on("entry", listener);

  try {
    await runContext.run(handle, async () => {
      // Deep inside _processMessageImpl, a tool fires:
      assert.equal(currentRun()!.tenantId, 314);
      await recordExecution(handle.runId, { tool: "send_email", args: { to: "x" } });
      // Tool result phase:
      const { recordResult } = await import("../../server/step-ledger");
      await recordResult(handle.runId, { ok: true });
    });
  } finally {
    ledgerEvents.off("entry", listener);
    endRun(handle.runId, { status: "completed" });
  }

  assert.equal(captured.length, 2);
  for (const e of captured) {
    assert.equal(e.tenantId, 314, "ledger entry tenantId must equal asserted chat tenantId");
    assert.equal(e.personaId, 9, "ledger entry personaId must equal conv.personaId");
  }
});

test("chat→tool→ledger: STRICT_TENANT_CONTEXT=true rejects a chat call with missing tenantId", async () => {
  const { assertTenantContext } = await import("../../server/storage-helpers/tenant-context");
  const prev = process.env.STRICT_TENANT_CONTEXT;
  process.env.STRICT_TENANT_CONTEXT = "true";
  try {
    // Simulate chat-engine.processMessage with a malformed conversation:
    const conv = { tenantId: null, personaId: 1 };
    assert.throws(
      () => assertTenantContext(conv.tenantId, "chat-engine:processMessage"),
      /STRICT_TENANT_CONTEXT/,
      "chat entry MUST throw under strict mode rather than fall through to ADMIN_TENANT_ID",
    );
  } finally {
    if (prev === undefined) delete process.env.STRICT_TENANT_CONTEXT;
    else process.env.STRICT_TENANT_CONTEXT = prev;
  }
});

test("chat→tool→ledger: persist round-trip (LIVE-DB; skipped without DATABASE_URL)", { skip: skipPersist }, async () => {
  const { startRun, recordExecution, getLedger, endRun } = await import("../../server/step-ledger");
  const handle = startRun({ tenantId: 1, task: "test:persist-roundtrip" });
  await recordExecution(handle.runId, { tool: "roundtrip_probe", marker: handle.runId });
  endRun(handle.runId, { status: "completed" });
  // Give persist a beat (it runs awaited inside record(), so it's already done).
  const entries = await getLedger(handle.runId, 1);
  assert.ok(entries.length >= 1, "persisted ledger entry should be readable back");
  assert.equal(entries[0].tenantId, 1);
  assert.equal(entries[0].kind, "execution");
});
