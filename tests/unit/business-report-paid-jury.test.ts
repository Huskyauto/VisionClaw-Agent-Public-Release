import test from "node:test";
import assert from "node:assert/strict";
import { nextReportJuryBudget, assertReportJuryApproval, ALDON_JURY_BATCH, ALDON_COMPLETION_BATCH } from "../../server/lib/business-report-paid-budget";
import { runPaidReportJury, REPORT_PAID_SEATS } from "../../server/lib/business-report-paid-jury";
import { reservePaidReportJury } from "../../server/lib/business-report-paid-budget";
import { PgDialect } from "drizzle-orm/pg-core";
import { juryTriage } from "../../server/lib/jury-triage";
import { executeBoundedReportSeat } from "../../server/moa";

test("Aldon jury pins the requested Argon model, not Sonnet or a Gemini alias", () => {
  assert.deepEqual(REPORT_PAID_SEATS.map(s => [s.modelId, s.providerLane]), [
    ["gpt-5.4", "openai-api"], ["google/gemini-4-argon", "openrouter"], ["claude-opus-5-5", "anthropic-api"],
  ]);
});

test("the Aldon approval reserves at most $2 per report and $4 combined, without replay", () => {
  let state: any = {};
  const claim = (kind: "executive" | "readiness", key: string, amount: number, operatorId = kind) => {
    state = nextReportJuryBudget(state, { kind, key, amount, operatorId });
  };
  claim("executive", "initial:gpt", 1.2);
  assert.throws(() => claim("executive", "initial:gpt", 0.1), /already reserved/);
  assert.throws(() => claim("executive", "final:claude", 0.81), /ceiling/);
  claim("executive", "final:claude", 0.8);
  claim("readiness", "initial:gpt", 2);
  assert.equal(state.executive.reservedMicros + state.readiness.reservedMicros, 4_000_000);
  assert.throws(() => claim("readiness", "other", 0.01, "another operator"), /operator/);
  for (const amount of [NaN, Infinity, -1, 0, "0.1", null]) {
    assert.throws(() => claim("readiness", "bad", amount as number), /amount/);
  }
});

test("fresh Aldon completion approval has its own $3/report ceiling; old approval remains $2", () => {
  assert.equal(ALDON_COMPLETION_BATCH, "aldon-completion-2026-10-15");
  const claim = { kind: "executive" as const, operatorId: "fresh", key: "initial", amount: 2.5 };
  assert.throws(() => nextReportJuryBudget({}, claim), /ceiling/);
  let state = nextReportJuryBudget({}, claim, ALDON_COMPLETION_BATCH);
  state = nextReportJuryBudget(state, { ...claim, key: "final", amount: 0.5 }, ALDON_COMPLETION_BATCH);
  assert.throws(() => nextReportJuryBudget(state, { ...claim, key: "over", amount: 0.000001 }, ALDON_COMPLETION_BATCH), /ceiling/);
  state = nextReportJuryBudget(state, { ...claim, kind: "readiness", amount: 3 }, ALDON_COMPLETION_BATCH);
  assert.equal(state.executive!.reservedMicros + state.readiness!.reservedMicros, 6_000_000);
  assert.throws(() => nextReportJuryBudget({}, claim, "forged"), /approval/);
  const input: any = { tenantId: 1, kind: "executive", operatorJobId: "fresh", paidJuryBatch: ALDON_COMPLETION_BATCH,
    intake: { focus: "full", company: "Aldon Company", website: "https://www.aldonco.com/" } };
  assert.doesNotThrow(() => assertReportJuryApproval(input, Date.parse("2026-10-16")));
  assert.throws(() => assertReportJuryApproval({ ...input, tenantId: 2 }, Date.parse("2026-10-16")), /approval/);
});

test("owner-approved October 16 reruns have independent $3 slots, binding and expiry", () => {
  const batch = "aldon-rerun-2026-10-16";
  const input: any = { tenantId: 1, kind: "executive", operatorJobId: "rerun-executive",
    paidJuryBatch: batch, intake: { focus: "full", company: "Aldon Company", website: "https://www.aldonco.com/" } };
  const now = Date.parse("2026-10-16T16:00:00Z");
  assert.doesNotThrow(() => assertReportJuryApproval(input, now));
  let state = nextReportJuryBudget({}, {
    kind: "executive", operatorId: input.operatorJobId, key: "all", amount: 3,
  }, batch);
  state = nextReportJuryBudget(state, { kind: "readiness", operatorId: "rerun-readiness", key: "all", amount: 3 }, batch);
  assert.equal(state.executive!.reservedMicros + state.readiness!.reservedMicros, 6_000_000);
  assert.throws(() => nextReportJuryBudget(state, {
    kind: "executive", operatorId: input.operatorJobId, key: "over", amount: 0.000001,
  }, batch), /ceiling/);
  assert.throws(() => nextReportJuryBudget(state, {
    kind: "executive", operatorId: "another-attempt", key: "all", amount: 0.01,
  }, batch), /operator/);
  assert.throws(() => assertReportJuryApproval({ ...input, tenantId: 2 }, now), /approval/);
  assert.throws(() => assertReportJuryApproval(input, Date.parse("2026-10-17T04:00:00Z")), /expired/);
});

test("owner's second October 16 approval is isolated from consumed rerun slots", () => {
  const batch = "aldon-recovery-2026-10-16";
  const input: any = { tenantId: 1, kind: "executive", operatorJobId: "recovery-executive",
    paidJuryBatch: batch, intake: { focus: "full", company: "Aldon Company", website: "https://www.aldonco.com/" } };
  const now = Date.parse("2026-10-16T21:00:00Z");
  assert.doesNotThrow(() => assertReportJuryApproval(input, now));
  let state = nextReportJuryBudget({}, {
    kind: "executive", operatorId: input.operatorJobId, key: "compiler-and-jury", amount: 3,
  }, batch);
  state = nextReportJuryBudget(state, {
    kind: "readiness", operatorId: "recovery-readiness", key: "compiler-and-jury", amount: 3,
  }, batch);
  assert.equal(state.executive!.reservedMicros + state.readiness!.reservedMicros, 6_000_000);
  assert.throws(() => nextReportJuryBudget(state, {
    kind: "executive", operatorId: "another-attempt", key: "new", amount: 0.01,
  }, batch), /operator/);
  assert.throws(() => nextReportJuryBudget(state, {
    kind: "executive", operatorId: input.operatorJobId, key: "over", amount: 0.000001,
  }, batch), /ceiling/);
  for (const change of [{ tenantId: 2 }, { paidJuryBatch: "aldon-recovery-forged" },
    { intake: { ...input.intake, company: "Other Company" } },
    { intake: { ...input.intake, website: "https://example.com/" } },
    { intake: { ...input.intake, focus: "opportunities" } }]) {
    assert.throws(() => assertReportJuryApproval({ ...input, ...change }, now), /approval/);
  }
  assert.throws(() => assertReportJuryApproval(input, Date.parse("2026-10-17T04:00:00Z")), /expired/);
});

test("capped report jury does not add an unreserved TypeSafe model call", async () => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  let validations = 0;
  try {
    const result = await juryTriage({ tenantId: 1, invokedVia: "business-report-evidence-review",
      issueText: "Review this retained company report", retainedReportBinding: {
        tenantId: 1, jobId: 12, inputDigest: "digest", reportSha256: "snapshot",
      },
      runPaidReportJury: async () => ({ question: "review", aggregated: "bounded",
        aggregatorModel: "deterministic", tenantId: 1, totalLatencyMs: 1, concordance: null,
        shouldEscalate: false, proposers: [] }),
      _validationFn: async () => { validations++; throw new Error("Unreserved extra model call"); },
    });
    assert.equal(validations, 0);
    assert.match(result.typesafeValidation!.note!, /budget/);
  } finally {
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
  }
});

test("durable reservations serialize overlapping workers, enforce lease and survive a reconstructed caller", async () => {
  const input: any = { tenantId: 1, kind: "executive", operatorJobId: "operator",
    paidJuryBatch: ALDON_JURY_BATCH, intake: { focus: "full", company: "Aldon Company", website: "https://www.aldonco.com/" } };
  let record: any, tail = Promise.resolve(), live = true, lockSeen = false;
  const dialect = new PgDialect();
  const db: any = { transaction: async (fn: any) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await fn({ execute: async (query: any) => {
        const { sql, params } = dialect.sqlToQuery(query);
        if (sql.includes("pg_advisory_xact_lock")) { lockSeen = true; return { rows: [] }; }
        assert.ok(lockSeen);
        if (sql.startsWith("SELECT payload FROM")) {
          assert.match(sql, /lease_until > NOW\(\)/);
          assert.match(sql, /tenant_id=/);
          return { rows: live ? [{ payload: { input, state: { juryFrom: "initial_jury", round: 1, requestId: "revision" } } }] : [] };
        }
        if (sql.startsWith("SELECT id,payload")) return { rows: record ? [record] : [] };
        const value = params.find(p => typeof p === "string" && p.startsWith('{"batch":'));
        assert.ok(value);
        record = { id: 99, payload: JSON.parse(value as string) };
        return { rows: [] };
      } });
    } finally { lockSeen = false; release(); }
  } };
  const outcomes = await Promise.allSettled(Array.from({ length: 25 }, (_, i) =>
    reservePaidReportJury(input, 12, 1, "initial_jury:1:revision", `seat-${i}`, 0.1, { db })));
  assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 20);
  assert.equal(record.payload.allocations.executive.reservedMicros, 2_000_000);
  await assert.rejects(reservePaidReportJury({ ...input, kind: "readiness" }, 12, 1,
    "initial_jury:1:revision", "wrong-kind", 0.1, { db }), /binding/);
  await assert.rejects(reservePaidReportJury(input, 12, 1,
    "final_jury:1:revision", "wrong-phase", 0.1, { db }), /binding/);
  await assert.rejects(reservePaidReportJury({ ...input }, 12, 1,
    "initial_jury:1:revision", "seat-0", 0.1, { db }), /already reserved/);
  live = false;
  await assert.rejects(reservePaidReportJury(input, 12, 1, "final_jury:1:revision", "other", 0.1, { db }), /lease/);
});

test("real paid grant wrapper matches the durable reservation and bounded output for all three seats", async () => {
  const previous = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  try {
    for (const [modelId, providerLane] of [
      ["gpt-5.4", "openai-api"], ["google/gemini-4-argon", "openrouter"], ["claude-opus-5-5", "anthropic-api"],
    ] as const) {
      let reserved = 0, calls = 0;
      const result = await executeBoundedReportSeat({ modelId, providerLane }, "Review a retained snapshot", 1,
        async usd => { reserved = usd; }, { dispatch: async (spec, _prompt, tenant, paid) => {
          assert.ok(reserved > 0 && reserved <= 2);
          assert.equal(spec.maxTokens, 4096); assert.equal(spec.noRetry, true);
          assert.equal(tenant, 1); assert.equal(paid, true);
          spec.beforeDispatch!(); calls++;
          return { modelId, provider: providerLane, ok: true, answer: "VERDICT: REJECT", latencyMs: 1 };
        } });
      assert.equal(calls, 1); assert.equal(result.ok, true);
    }
  } finally {
    if (previous === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
    else process.env.OWNER_JURY_DIRECT_API_ENABLED = previous;
  }
});

test("paid report runner collects each seat's evidence, reserves before dispatch and makes no synthesis call", async () => {
  let state: any = {}, reads = 0, calls = 0, audits = 0;
  const input: any = { tenantId: 1, kind: "executive", operatorJobId: "operator",
    paidJuryBatch: ALDON_JURY_BATCH, intake: { focus: "full", company: "Aldon Company", website: "https://www.aldonco.com/" } };
  const result = await runPaidReportJury({ tenantId: 1, question: "Review the retained report",
    invokedVia: "business-report-evidence-review", collectProposerEvidence: async spec => {
      reads++;
      return { seatId: spec.modelId, runId: spec.modelId, actor: "server-owned-juror-evidence-runner",
        receipts: [{ id: spec.modelId, runId: spec.modelId, tool: "report_snapshot_read",
          ok: true, startedAt: "2026-10-15", completedAt: "2026-10-15", excerpt: "Bound report snapshot" }] };
    } }, input, 12, 1, "1:request", {
      reserve: async (_input, _job, _attempt, _phase, model, amount) => {
        state = nextReportJuryBudget(state, { kind: "executive", operatorId: "operator", key: model, amount });
      },
      call: async (spec, _question, tenant, reserve) => {
        assert.doesNotMatch(_question, /End with CITATIONS:/);
        assert.match(_question, /citations and unknowns inside the JSON/);
        assert.equal(tenant, 1);
        await reserve(0.25);
        assert.ok(state.executive.claims.includes(spec.modelId));
        calls++;
        return { modelId: spec.modelId, provider: spec.providerLane!, providerLane: spec.providerLane,
          ok: true, answer: "VERDICT: REJECT", reportedModel: spec.modelId, latencyMs: 1 };
      },
      audit: async saved => { audits++; assert.equal(saved.proposers.length, 3); },
    });
  assert.equal(reads, 3); assert.equal(calls, 3); assert.equal(audits, 1);
  assert.equal(new Set(result.proposers.map(p => p.modelId)).size, 3);
  assert.equal(result.shouldEscalate, false);
  assert.equal(state.executive.reservedMicros, 750_000);
});

test("paid review is limited to the approved owner, company, domain and expiration", () => {
  const input: any = { tenantId: 1, kind: "executive", operatorJobId: "operator",
    paidJuryBatch: ALDON_JURY_BATCH, intake: { focus: "full", company: "Aldon Company", website: "https://www.aldonco.com/" } };
  const now = Date.parse("2026-10-15T10:00:00Z");
  assert.doesNotThrow(() => assertReportJuryApproval(input, now));
  for (const change of [{ tenantId: 2 }, { paidJuryBatch: "forged" }, { operatorJobId: "" },
    { kind: "other" }, { intake: { ...input.intake, focus: "opportunities" } },
    { intake: { company: "Other Co", website: input.intake.website } },
    { intake: { company: "Aldon Company", website: "https://evil.example/" } }]) {
    assert.throws(() => assertReportJuryApproval({ ...input, ...change }, now), /approval/);
  }
  assert.throws(() => assertReportJuryApproval(input, Date.parse("2026-10-18")), /expired/);
});

test("retained seat failures do not contain private SQL or provider exception payloads", async () => {
  const input: any = { tenantId: 1, kind: "executive", operatorJobId: "operator",
    paidJuryBatch: ALDON_JURY_BATCH, intake: {
      focus: "full", company: "Aldon Company", website: "https://www.aldonco.com/",
    } };
  const result = await runPaidReportJury({ tenantId: 1, question: "Review retained company report",
    invokedVia: "business-report-evidence-review", collectProposerEvidence: async spec => ({
      seatId: spec.modelId, runId: "fixture", actor: "server-owned-juror-evidence-runner", receipts: [],
    }) }, input, 12, 1, "initial_jury:1:revision", {
    reserve: async () => {},
    call: async () => { throw Object.assign(new Error("SQL params: private report contents"), {
      cause: { code: "23514", message: "private customer fields" },
    }); },
    audit: async saved => { assert.doesNotMatch(JSON.stringify(saved), /private|customer fields|SQL params/); },
  });
  assert.ok(result.proposers.every(p => p.error?.includes("23514")));
});
