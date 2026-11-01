import test from "node:test";
import assert from "node:assert/strict";
import { advanceCompilationMatrix, newCompilationMatrix, compilationOperations } from "../../server/lib/company-compilation-matrix";
import { reservePackageOperation } from "../../server/lib/company-report-production";
import { initialPackage } from "../../server/lib/company-report-package-core";
import { COMPANY_HEADINGS } from "../../server/lib/company-compilation-content";
import { companyCompilationSubject } from "../../server/lib/company-package-v3";
import { compilationReceiptDigest } from "../../server/lib/company-compilation-correction-policy";
import { PgDialect } from "drizzle-orm/pg-core";
import { requestCompanyCompilation } from "../../server/lib/company-compilation-runtime";
import { acceptCompilation } from "../../server/lib/company-compilation-content";
import { advanceCompanyCompilation } from "../../server/lib/company-package-v3";
import { guardReportArgonClient } from "../../server/lib/report-argon-route";
import { canResumeCompilation } from "../../server/routes/company-report-packages";

test("new correction identities survive nested JSONB key reordering without changing legacy receipts", () => {
  const raw = { model: "gpt-5.4", choices: [{ message: { content: "saved exact text" }, finish_reason: "stop" }] };
  const reordered = { choices: [{ finish_reason: "stop", message: { content: "saved exact text" } }], model: "gpt-5.4" };
  assert.equal(compilationReceiptDigest(raw, 2), compilationReceiptDigest(reordered, 2));
  assert.notEqual(compilationReceiptDigest(raw), compilationReceiptDigest(reordered), "legacy identity remains byte/order-sensitive");
  reordered.choices[0].message.content += " changed";
  assert.notEqual(compilationReceiptDigest(raw, 2), compilationReceiptDigest(reordered, 2));
});

test("canonical correction reservation survives storage order and cannot bypass an earlier digest version", async () => {
  const f = budgetFixture(), slot = f.payload.state.compilation.slots[f.op.key];
  slot.correction.digestVersion = 2;
  slot.correction.originalDigest = compilationReceiptDigest(slot.raw, 2);
  const key = `matrix:${f.op.key}:correction:${slot.correction.originalDigest}`;
  // Simulate JSONB's reordering at every object level, not just the provider root.
  const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) :
    value && typeof value === "object" ? Object.fromEntries(Object.keys(value).reverse().map(k => [k, reorder(value[k])])) : value;
  slot.raw = reorder(slot.raw);
  const dialect = new PgDialect();
  const db: any = { transaction: async (fn: any) => fn(db), execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (q.sql.startsWith("SELECT")) return { rows: [{ payload: f.payload, status: "running", attempts: 1,
      lease_until: new Date(Date.now() + 60_000) }] };
    if (q.sql.startsWith("UPDATE")) {
      f.payload.packageSpend = JSON.parse(q.params.find(v => typeof v === "string" && v.startsWith("{")) as string);
      return { rows: [] };
    }
    throw new Error("Unexpected offline query");
  } };
  const reserve = () => reservePackageOperation(123, 1, key, 1, { parentAttempt: 1 }, { db });
  await reserve();
  assert.equal(f.payload.packageSpend[key], 1_000_000);
  await assert.rejects(reserve(), /already reserved/);
  delete f.payload.packageSpend[key];
  f.payload.packageSpend[`matrix:${f.op.key}:correction:${"a".repeat(64)}`] = 1;
  await assert.rejects(reserve(), /already reserved/);
  f.payload.state.compilation.slots[f.op.key].raw.choices[0].message.content += "changed";
  await assert.rejects(reserve(), /authority/);
});

function validResponse(op: ReturnType<typeof compilationOperations>[number]) {
  return { model: op.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    sections: COMPANY_HEADINGS[op.kind].map(heading => ({ heading, blocks: Array.from({ length: 3 }, () => ({
      type: "recommendation", text: "Assign an owner to measure the pilot before expansion. ".repeat(15), sourceIds: [],
    })) })), unknowns: ["Verify staffing before implementing this recommendation."],
  }) } }] };
}

function budgetFixture(op = compilationOperations()[0]) {
  const state: any = initialPackage({ company: "Offline business", website: "https://example.com" });
  state.research = { complete: true, evidence: { version: 1, capturedAt: "2026-10-21", sources: [], limitations: [] } };
  const raw = { model: op.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    sections: COMPANY_HEADINGS[op.kind].map(heading => ({ heading, blocks: Array.from({ length: 3 }, () => ({
      type: "recommendation", text: "Assign an owner to measure the pilot before expansion. ".repeat(29), sourceIds: [],
    })) })), unknowns: [],
  }) } }] };
  state.phase = "drafting";
  state.compilation = newCompilationMatrix(companyCompilationSubject(state));
  const digest = compilationReceiptDigest(raw);
  state.compilation.slots[op.key] = { phase: "received", raw,
    correction: { phase: "claimed", originalDigest: digest, check: "AUTHOR_SIZE_LIMIT" } };
  const payload: any = { tenantId: 1, productionVersion: 3, state,
    modelBudgetMicros: 150_000_000, processingWindowStartedAt: new Date().toISOString(),
    packageSpend: { [`matrix:${op.key}`]: 1_000_000 },
    compilationCorrectionPolicy: { version: 1, maxPerOperation: 1, approvedAt: new Date().toISOString() } };
  const key = `matrix:${op.key}:correction:${digest}`, dialect = new PgDialect();
  const db: any = { transaction: async (fn: any) => fn(db), execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (q.sql.includes("SELECT payload,status,attempts,lease_until")) return { rows: [{
      payload, status: "running", attempts: 1, lease_until: new Date(Date.now() + 60_000),
    }] };
    if (q.sql.includes("UPDATE agent_jobs SET payload=jsonb_set")) {
      payload.packageSpend = JSON.parse(String(q.params.find(p => typeof p === "string" && p.startsWith("{"))));
      return { rows: [] };
    }
    throw new Error("Unexpected query");
  } };
  return { payload, op, raw, key, reserve: () => reservePackageOperation(123, 1, key, 1, { parentAttempt: 1 }, { db }) };
}

test("Continue refuses a received failed correction but admits a valid retained correction without repurchase", () => {
  const f = budgetFixture(), slot = f.payload.state.compilation.slots[f.op.key];
  f.payload.state.phase = "blocked";
  const job = { tenant_id: 1, status: "succeeded", payload: f.payload };
  slot.correction.phase = "received";
  slot.correction.raw = f.raw;
  assert.equal(canResumeCompilation(job), false);
  assert.equal(canResumeCompilation(job, true), false, "fresh opt-in cannot unlock a second correction");
  slot.correction.raw = validResponse(f.op);
  assert.equal(canResumeCompilation(job), true, "a saved valid response can finish validation without a purchase");
  slot.raw.choices[0].finish_reason = "length";
  slot.correction.originalDigest = compilationReceiptDigest(slot.raw);
  assert.equal(canResumeCompilation(job), true, "a received valid correction also resolves original truncation");
  slot.correction.phase = "claimed";
  assert.equal(canResumeCompilation(job), false, "uncertain correction still needs reconciliation");
});

test("central spend boundary refuses a correction without explicit policy approval", async () => {
  const f = budgetFixture();
  delete f.payload.compilationCorrectionPolicy;
  await assert.rejects(f.reserve(), /correction.*authority/);
  assert.equal(Object.keys(f.payload.packageSpend).length, 1);
});

test("Gemini correction passes its real two-message guarded adapter with one dispatch and no fallback", async () => {
  const op = compilationOperations()[1], f = budgetFixture(op);
  const prior = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  let calls = 0;
  try {
    const client = guardReportArgonClient({ chat: { completions: { create: async (params: any, options: any) => {
      calls++;
      assert.equal(params.messages.length, 2);
      assert.equal(params.provider.allow_fallbacks, false);
      assert.equal(options.maxRetries, 0);
      const input = JSON.parse(params.messages[1].content);
      assert.equal(input.intake.company, "Offline business");
      assert.equal(input.correctionFeedback.validationCheck, "AUTHOR_SIZE_LIMIT");
       assert.match(input.correctionFeedback.validationMessage, /exceeds/);
       const size = input.correctionFeedback.measuredSize;
       assert.ok(size.characters > size.maxCharacters);
       assert.equal(size.maxCharacters, 25_000);
       assert.equal(size.maxUtf8Bytes, 30_000);
       assert.equal(size.sections.length, 6);
       assert.ok(size.sections.every((s: any) => s.characters > 0 && s.utf8Bytes > 0));
       assert.equal(input.outputBudget.sections.length, 6);
       assert.equal(input.outputBudget.sections[0].targetMaxJsonCharacters, 3200);
       assert.match(params.messages[0].content, /Do not repeat the oversized draft/);
      return validResponse(op);
    } } } } as any, 1);
    const raw = await requestCompanyCompilation({ id: 123, tenantId: 1, attempts: 1, payload: f.payload } as any,
      f.payload.state, op, [], async () => {}, {
        reserve: (async () => f.reserve()) as typeof reservePackageOperation,
        getClientForModel: (async () => ({ client, actualModelId: op.model })) as any,
      }, { original: f.raw, check: "AUTHOR_SIZE_LIMIT" });
    assert.equal(calls, 1);
    assert.ok(acceptCompilation(f.payload.state, op, raw).length > 4000);
    assert.equal(f.payload.packageSpend[f.key], 1_000_000);
  } finally {
    if (prior === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
    else process.env.OWNER_JURY_DIRECT_API_ENABLED = prior;
  }
});

test("approved correction reserves once, retains original spend and respects aggregate cap", async () => {
  const f = budgetFixture();
  await f.reserve();
  assert.equal(f.payload.packageSpend[f.key], 1_000_000);
  assert.equal(f.payload.packageSpend[`matrix:${f.op.key}`], 1_000_000);
  await assert.rejects(f.reserve(), /already reserved/);
  const full = budgetFixture();
  full.payload.packageSpend.other = 148_500_000;
  await assert.rejects(full.reserve(), /budget-limited/);
});

test("central authority binds subject, original receipt, failure, phase and no manual replacement", async () => {
  for (const mutate of [
    (f: ReturnType<typeof budgetFixture>) => { f.payload.tenantId = 2; },
    (f: ReturnType<typeof budgetFixture>) => { f.payload.modelBudgetMicros = 200_000_000; },
    (f: ReturnType<typeof budgetFixture>) => { f.payload.state.compilation.subject = "changed"; },
    (f: ReturnType<typeof budgetFixture>) => { f.raw.model = "other"; },
    (f: ReturnType<typeof budgetFixture>) => { f.raw.choices[0].finish_reason = "content_filter"; },
    (f: ReturnType<typeof budgetFixture>) => { f.payload.state.compilation.slots[f.op.key].phase = "claimed"; },
    (f: ReturnType<typeof budgetFixture>) => { f.payload.state.compilation.slots[f.op.key].correction.check = "INVALID_JSON_STRUCTURE"; },
    (f: ReturnType<typeof budgetFixture>) => { f.payload.state.compilation.replacements = { [f.op.key]: {} }; },
    (f: ReturnType<typeof budgetFixture>) => { f.payload.state.compilation.slots[f.op.key].correction.raw = {}; },
    (f: ReturnType<typeof budgetFixture>) => { delete f.payload.packageSpend[`matrix:${f.op.key}`]; },
  ]) {
    const f = budgetFixture(); mutate(f);
    await assert.rejects(f.reserve(), /authority/);
    assert.equal(f.payload.packageSpend[f.key], undefined);
  }
});

test("failed or uncertain correction never repurchases on resume", async () => {
  for (const failure of ["invalid", "timeout", "checkpoint"] as const) {
    const state = newCompilationMatrix("subject"), op = compilationOperations()[0];
    const raw = { model: op.model, choices: [{ finish_reason: "stop", message: { content: "invalid" } }] };
    let paid = 0, save = 0;
    const ports = {
      checkpoint: async () => { if (failure === "checkpoint" && ++save === 4) throw new Error("Receipt persistence failed"); },
      request: async () => raw,
      accept: () => { throw new Error("Author compilation exceeds its synthesis input allowance"); },
      correct: async () => { paid++; if (failure === "timeout") throw new Error("Provider timeout"); return raw; },
    };
    await assert.rejects(advanceCompilationMatrix(state, ports));
    assert.equal(state.phase, "blocked");
    assert.equal(paid, 1);
    state.phase = "authors";
    await assert.rejects(advanceCompilationMatrix(state, ports));
    assert.equal(paid, 1);
    assert.equal(state.slots[op.key].raw, raw);
  }
});

test("transport failure, refusal, wrong identity, unknown validation and missing approval do not correct", async () => {
  for (const failure of ["transport", "refusal", "identity", "unknown", "unapproved"]) {
    const state = newCompilationMatrix("subject"), op = compilationOperations()[0];
    const raw = { model: failure === "identity" ? "wrong" : op.model,
      choices: [{ finish_reason: "stop", message: { content: "invalid", refusal: failure === "refusal" ? "Refused" : null } }] };
    let paid = 0;
    await assert.rejects(advanceCompilationMatrix(state, {
      checkpoint: async () => {},
      request: async () => { if (failure === "transport") throw new Error("Timeout"); return raw; },
      accept: () => { throw new Error(failure === "unknown" ? "Unknown validation" :
        "Author compilation exceeds its synthesis input allowance"); },
      correct: failure === "unapproved" ? undefined : async () => { paid++; return raw; },
    }));
    assert.equal(paid, 0, failure);
  }
});

test("a received corrective response resumes validation without another paid dispatch", async () => {
  const state = newCompilationMatrix("subject"), op = compilationOperations()[0];
  const raw = { model: op.model }, corrected = { model: op.model, text: "retained corrected text" };
  state.slots[op.key] = { phase: "received", raw, correction: { phase: "received", raw: corrected,
    originalDigest: compilationReceiptDigest(raw), check: "AUTHOR_SIZE_LIMIT" } };
  await advanceCompilationMatrix(state, {
    checkpoint: async () => {},
    request: async () => { throw new Error("No paid dispatch"); },
    correct: async () => { throw new Error("No corrective dispatch"); },
    accept: (_op, value: any) => value.text,
  });
  assert.equal(state.slots[op.key].text, corrected.text);
  assert.equal(state.slots[op.key].correction?.phase, "complete");
});

test("real correction runtime sends fixed feedback with unchanged original inputs and no transport retries", async () => {
  const f = budgetFixture(), prior = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  let calls = 0, reserves = 0;
  try {
    const job: any = { id: 123, tenantId: 1, attempts: 1, payload: f.payload };
    const runtime = {
      reserve: (async (_id: number, _tenant: number, key: string) => {
        assert.equal(key, f.key); reserves++; await f.reserve();
      }) as typeof reservePackageOperation,
      getClientForModel: (async (model: string) => ({ actualModelId: model, client: {
        chat: { completions: { create: async (params: any, options: any) => {
          calls++; assert.equal(options.maxRetries, 0);
          assert.equal(JSON.parse(params.messages[1].content).intake.company, "Offline business");
          assert.equal(params.messages.length, 2);
          const feedback = JSON.parse(params.messages[1].content).correctionFeedback;
          assert.equal(feedback.validationCheck, "AUTHOR_SIZE_LIMIT");
          assert.equal(feedback.originalResponse, f.raw.choices[0].message.content);
          throw new Error("Ambiguous provider timeout");
        } } },
      } })) as any,
    };
    await assert.rejects(requestCompanyCompilation(job, f.payload.state, f.op, [], async () => {}, runtime,
      { original: f.raw, check: "AUTHOR_SIZE_LIMIT" }), /timeout/);
    assert.equal(calls, 1); assert.equal(reserves, 1);
    assert.equal(f.payload.packageSpend[f.key], 1_000_000, "uncertain completion keeps its reservation");
  } finally {
    if (prior === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
    else process.env.OWNER_JURY_DIRECT_API_ENABLED = prior;
  }
});

test("offline full package survives author and synthesis corrections through three report pairs and teaser", async () => {
  const f = budgetFixture(), state = f.payload.state;
  state.compilation = newCompilationMatrix(companyCompilationSubject(state));
  let originalCalls = 0, corrections = 0, publications = 0;
  const ports = {
    checkpoint: async () => {},
    request: async (op: any) => {
      originalCalls++;
      if (op.key === compilationOperations()[0].key) return f.raw;
      const raw = validResponse(op);
      if (op.stage === "synthesis" && op.kind === "executive") raw.choices[0].message.content = '{"invalid":true}';
      return raw;
    },
    correct: async (op: any) => { corrections++; return validResponse(op); },
    accept: (op: any, raw: unknown) => acceptCompilation(state, op, raw),
    publish: async (kind: any, text: string) => {
      publications++;
      assert.equal(JSON.parse(text).sections.length, 6);
      return { key: `${kind}-full`, label: kind, filename: `${kind}.pdf`, category: "full" as const,
        audioUrl: "https://drive.google.com/file/d/offlineaudio1234/view",
        pdfUrl: "https://drive.google.com/file/d/offlinepdf12345/view" };
    },
    publishTeaser: async () => ({ key: "teaser-pack", label: "Offline teaser", filename: "teaser.pdf",
      category: "teaser" as const, pdfUrl: "https://drive.google.com/file/d/offlineteaser123/view" }),
  };
  for (let step = 0; step < 16; step++) await advanceCompanyCompilation(state, ports);
  assert.equal(state.phase, "done");
  assert.equal(originalCalls, 12); assert.equal(corrections, 2); assert.equal(publications, 3);
  assert.deepEqual(state.compilation.slots[f.op.key].raw, f.raw);
  assert.equal(state.files.length, 4);
  await advanceCompanyCompilation(state, ports);
  assert.equal(originalCalls + corrections, 14, "completed packages purchase nothing on replay");
});

test("oversized correction context discloses omission of prior response without dropping evidence or synthesis drafts", async () => {
  const op = compilationOperations()[9], f = budgetFixture(op);
  f.payload.state.research.evidence.sources = Array.from({ length: 12 }, (_, i) => ({
    id: `S${i + 1}`, text: "Source words describing available services. ".repeat(100),
    sha256: "a".repeat(64), title: "Public services", kind: "public",
    url: `https://example.com/services/${i}`, retrievedAt: "2026-10-21",
  }));
  const drafts = Array.from({ length: 3 }, (_, i) => JSON.stringify({ author: i, draft: "d".repeat(24_000) }));
  const original = { model: op.model, choices: [{ finish_reason: "stop", message: { content: "o".repeat(89_000) } }] };
  const slot = f.payload.state.compilation.slots[op.key];
  slot.raw = original;
  slot.correction.originalDigest = compilationReceiptDigest(original);
  const prior = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  let calls = 0;
  try {
    await requestCompanyCompilation({ id: 123, tenantId: 1, attempts: 1, payload: f.payload } as any,
      f.payload.state, op, drafts, async () => {}, {
        reserve: (async () => {}) as typeof reservePackageOperation,
        getClientForModel: (async () => ({ actualModelId: op.model, client: { chat: { completions: {
          create: async (params: any, options: any) => {
            calls++; assert.equal(options.maxRetries, 0); assert.equal(params.messages.length, 2);
            const input = JSON.parse(params.messages[1].content);
            assert.deepEqual(input.independentCompilations, drafts.map(d => JSON.parse(d)));
            assert.equal(input.evidence.sources.length, 12);
            assert.ok(input.correctionFeedback.originalResponseOmitted);
            assert.equal(input.correctionFeedback.originalResponse, undefined);
            return validResponse(op);
          },
        } } } })) as any,
      }, { original, check: "NARRATION_SIZE_LIMIT" });
    assert.equal(calls, 1);
  } finally {
    if (prior === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
    else process.env.OWNER_JURY_DIRECT_API_ENABLED = prior;
  }
});

test("known invalid author is corrected once with original receipt retained and same package continues", async () => {
  const state = newCompilationMatrix("subject"), op = compilationOperations()[0];
  const original = { model: op.model, choices: [{ finish_reason: "stop", message: { content: "overlong original" } }] };
  let paid = 0;
  const ports = {
    checkpoint: async () => {},
    request: async () => original,
    accept: (_op: any, raw: any) => {
      if (raw === original) throw new Error("Author compilation exceeds its synthesis input allowance");
      return "accepted corrected report";
    },
    correct: async (_op: any, _drafts: string[], raw: unknown, check: string) => {
      paid++; assert.equal(raw, original); assert.equal(check, "AUTHOR_SIZE_LIMIT");
      assert.equal(state.slots[op.key].correction?.phase, "claimed");
      return { model: op.model, choices: [{ finish_reason: "stop", message: { content: "corrected" } }] };
    },
  };
  await advanceCompilationMatrix(state, ports);
  assert.equal(paid, 1);
  assert.equal(state.slots[op.key].phase, "complete");
  assert.equal(state.slots[op.key].raw, original);
  assert.equal(state.slots[op.key].text, "accepted corrected report");
  assert.equal(state.phase, "authors");
});
