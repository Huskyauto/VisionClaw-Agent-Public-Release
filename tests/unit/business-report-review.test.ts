import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { initialBusinessReportReview, buildMuseReportRequest, validateMuseReportReply,
  advanceBusinessReportReview, type BusinessReportReviewInput, type BusinessReportReviewState,
  type ReportReviewDependencies, reportJuryFailureSummary } from "../../server/lib/business-report-review";
import { hashReportBytes } from "../../server/lib/business-report-evidence";
import { sanitizeAgentOutput } from "../../server/safety-layer";
import type { AgentJob } from "../../server/job-queue";

const input: BusinessReportReviewInput = {
  compilerMode: "muse-legacy",
  tenantId: 1, kind: "readiness", orderId: "fixture", customerEmail: "private@example.com",
  modelId: "fixture", intake: { company: "Example Co", notes: "Gross margin: 25%", phone: "3125550199",
    principalName: "Private Person", paymentKey: "private-payment" },
  evidence: { version: 1, capturedAt: "2026-10-14T00:00:00Z", sources: [{
    id: "S1", title: "Services", text: "We repair heating systems.", url: "https://example.com",
    sha256: hashReportBytes("We repair heating systems."), retrievedAt: "2026-10-14T00:00:00Z", kind: "public",
  }], limitations: ["Revenue was not independently measured."] },
  sections: [{ heading: "Summary", body: "The draft should be reviewed against its retained source before any customer delivery." }],
};

test("a jury-requested evidence-limiting heading repair stays bound to the original section position", () => {
  const title = "AI Visibility Method (Competitive Comparison Not Measured)";
  const scoped = { ...input, kind: "readiness" as const, qualityContractVersion: undefined,
    sections: [{ heading: "Competitive AI Exposure", body: "Retained original section." }] };
  const state = { ...initialBusinessReportReview(scoped), phase: "wait_muse" as const,
    correctionChecklist: [{ id: "scope", text: `Competitive AI Exposure: retitle to '${title}'.` }] };
  const report = { sections: [{ heading: title, blocks: [{ type: "recommendation",
    text: "Use a measured pilot and verify the evidence before stating competitive results. ".repeat(4), sourceIds: [] }] }], unknowns: [] };
  assert.equal(buildMuseReportRequest(scoped, state).draftSections[0].heading, title);
  assert.doesNotThrow(() => validateMuseReportReply(scoped, state,
    { requestId: state.requestId, digest: state.digest, report }));
  assert.throws(() => validateMuseReportReply(scoped, { ...state, correctionChecklist: [] },
    { requestId: state.requestId, digest: state.digest, report }), /section order/);
});
const compiled = { sections: [{ heading: "Summary", blocks: [
  { type: "fact", text: "We repair heating systems.", sourceIds: ["S1"] },
  { type: "recommendation", text: "Pilot a lead follow-up workflow and measure booked appointments and gross margin before expanding the program.", sourceIds: ["S1"] },
] }], unknowns: ["Actual booking conversion is unknown."] };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("native compilation requests section overviews and detailed analysis without short-brief limits", () => {
  const full = { ...input, compilerMode: "gemini-direct-v1" as const, qualityContractVersion: 1 as const,
    sections: Array.from({ length: 12 }, (_, index) => ({ heading: `Section ${index}`, body: "Retained draft." })) };
  const packet = buildMuseReportRequest(full, initialBusinessReportReview(full));
  assert.match(packet.instruction, /bullet-point overview/);
  assert.match(packet.instruction, /detailed analysis/);
  assert.match(packet.instruction, /customer.service|customer service/);
  assert.match(packet.instruction, /product ideas/);
  assert.doesNotMatch(packet.instruction, /1100 words combined|120-word limit|1800.word hard|900–1200 words/);
  assert.match(packet.instruction, /3–6 substantive ranked actions/);
  assert.match(packet.instruction, /sourceIds must contain exactly one ID/);
  assert.match(packet.instruction, /existing output and schema bounds/);
  const legacy = buildMuseReportRequest({ ...full, compilerMode: "muse-legacy" }, initialBusinessReportReview(full));
  assert.doesNotMatch(legacy.instruction, /NATIVE COMPILER FORMAT/);
});

test("jury failures identify database errors without exposing private SQL parameters", () => {
  const error = Object.assign(new Error("Failed query with private customer context"), {
    cause: Object.assign(new Error("private provider payload"), { code: "23514" }),
  });
  assert.equal(reportJuryFailureSummary(error), "Report jury database failure (PostgreSQL 23514)");
  assert.doesNotMatch(reportJuryFailureSummary(new Error("secret report contents")), /secret|contents/);
  assert.match(reportJuryFailureSummary(new Error("Report jury exceeded its bounded deadline")), /deadline/);
});

test("a real Muse egress scan accepts public report/source digests without treating them as leaked credentials", () => {
  const state = initialBusinessReportReview(input);
  const packet = buildMuseReportRequest(input, state);
  const result = sanitizeAgentOutput(JSON.stringify(packet));
  assert.equal(result.redacted, false, JSON.stringify(result.warnings));
  assert.match(packet.digest, /^sha256-b64:[A-Za-z0-9_-]{43}$/);
  const decoded = Buffer.from(packet.evidence.sources[0].sha256.split(":")[1], "base64url").toString("hex");
  assert.equal(decoded, hashReportBytes(input.evidence.sources[0].text));
  validateMuseReportReply(input, { ...state, phase: "wait_muse" },
    { requestId: packet.requestId, digest: packet.digest, report: compiled });
});

test("wire digest metadata cannot excuse forged source hashes or key-shaped values in untrusted prose", () => {
  const state = initialBusinessReportReview(input);
  const altered = clone(input);
  altered.evidence.sources[0].sha256 = "b".repeat(64);
  assert.throws(() => buildMuseReportRequest(altered, state), /hash mismatch/);
  const packet = buildMuseReportRequest(input, state);
  packet.evidence.sources[0].title = `Untrusted key-shaped value: ${"a".repeat(64)}`;
  assert.equal(sanitizeAgentOutput(JSON.stringify(packet)).redacted, true);
  assert.throws(() => validateMuseReportReply(input, { ...state, phase: "wait_muse" }, {
    requestId: state.requestId, digest: `sha256-b64:${"A".repeat(43)}`, report: compiled,
  }), /mismatched/);
});
test("report-only finalization never queues customer delivery even with a retained conflicting context", async () => {
  const { mkdtempSync, readFileSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "report-only-queue-"));
  const previousQueue = process.env.SERVICE_REVIEW_QUEUE_FILE;
  process.env.SERVICE_REVIEW_QUEUE_FILE = join(directory, "queue.json");
  try {
  const h = harness();
  h.job.payload.input.reportOnly = true;
  h.job.payload.input.deliveryContext = {
    sessionId: "should-not-queue", sku: "fixture", productName: "Manual report",
    customerName: "Customer", customerEmail: "customer@example.com",
  };
  h.job.payload.state = { ...h.job.payload.state, phase: "finalizing", reply: compiled,
    approvedSections: [{ heading: "Summary", body: "Already reviewed" }],
    juryHistory: [{ verdict: "APPROVE", rationale: "Fixture approved" }] };
  const result = await h.advance();
  assert.equal(result.success, true);
  assert.equal(result.queuedReviewId, undefined);
  assert.equal(h.stats().finalized, 1);
  const queue = process.env.SERVICE_REVIEW_QUEUE_FILE;
  assert.ok(!existsSync(queue) || JSON.parse(readFileSync(queue, "utf8")).length === 0);
  } finally {
    if (previousQueue === undefined) delete process.env.SERVICE_REVIEW_QUEUE_FILE;
    else process.env.SERVICE_REVIEW_QUEUE_FILE = previousQueue;
    rmSync(directory, { recursive: true, force: true });
  }
});

function harness(verdicts: string[] = ["FIX", "REJECT"]) {
  let job = { id: 12, tenantId: 1, attempts: 1, payload: { input: clone(input), state: initialBusinessReportReview(input) },
    kind: "business_report_review", status: "running", maxAttempts: 1600 } as unknown as AgentJob;
  let juryCalls = 0, finalized = 0, signals = 0;
  const receipts: any[] = [];
  const dialect = new PgDialect();
  const deps: Partial<ReportReviewDependencies> = {
    ownerTenantId: () => 1,
    recoverArtifact: async () => null,
    persistArtifact: async () => {},
    db: { execute: async query => {
      const { sql, params } = dialect.sqlToQuery(query);
      assert.match(sql, /tenant_id/);
      if (/SELECT payload->'reportJuryRuns' AS audit/.test(sql)) {
        return { rows: [{ audit: clone(job.payload.reportJuryRuns) }] };
      }
      if (/SELECT payload/.test(sql)) return { rows: [{ payload: clone(job.payload) }] };
      if (/UPDATE/.test(sql) && /reportJuryRuns/.test(sql)) {
        const audit = params.find(value => typeof value === "string" && value.includes('"deadlineAt"'));
        if (audit) job.payload.reportJuryRuns = JSON.parse(audit as string);
      }
      if (/UPDATE/.test(sql) && /jsonb_build_object/.test(sql)) {
        const next = params.find(value => typeof value === "string" && value.startsWith('{"input"'));
        if (next) job.payload = { ...JSON.parse(next as string), reportJuryRuns: job.payload.reportJuryRuns };
      }
      if (/jury_started/.test(sql)) job.payload.state.phase = "jury_started";
      if (/UPDATE/.test(sql) && /compilerSetupRequired/.test(sql)) {
        job.payload.state.phase = "compiling";
        job.payload.state.compilerSetupRequired = false;
      }
      if (/UPDATE/.test(sql) && /\{compilerRuns\}/.test(sql)) {
        job.payload.compilerRuns = JSON.parse(params.find(value =>
          typeof value === "string" && value.startsWith("{")) as string);
      }
      if (/max_attempts = attempts/.test(sql)) {
        job.payload.state.phase = "blocked";
        job.maxAttempts = job.attempts;
      }
      if (/fulfillment/.test(sql)) {
        const json = params.find(value => typeof value === "string" && value.startsWith('{"success"'));
        if (json) job.payload.fulfillment = JSON.parse(json as string);
      }
      if (/assemblyStarted/.test(sql) && /UPDATE/.test(sql)) job.payload.assemblyStarted = { fileName: "fixture.pdf" };
      return { rows: [{ id: job.id }] };
    } },
    deferJob: async (id, attempt, tenantId, payload) => {
      assert.equal(id, job.id); assert.equal(attempt, job.attempts); assert.equal(tenantId, 1);
      job.payload = clone(payload);
      return true;
    },
    juryTriage: async opts => {
      juryCalls++;
      assert.ok(opts.context!.length < 4000, "Initial MoA question context must not contain the full report");
      for (let index = 0; index < 3; index++) {
        const receipt = await opts.collectProposerEvidence!({ modelId: `fixture-${index}` } as any);
        assert.match(receipt.receipts[0].excerpt, /We repair heating systems/);
        receipts.push(receipt);
      }
      const verdict = verdicts[juryCalls - 1] || "ESCALATE";
      return { verdict, majority: 3, shouldEscalate: verdict === "ESCALATE",
        votes: [], aggregatorAnswer: "fixture", concordance: null, totalLatencyMs: 1 } as any;
    },
    sendSparkMessage: async () => { signals++; return { outboxId: 99, queuedAt: new Date() }; },
    finalize: async finalInput => {
      finalized++;
      assert.equal(finalInput.sections[0].heading, "Summary");
      assert.ok(finalInput.sections.some(section => section.heading === "Sources & Evidence Documentation"));
      assert.ok(finalInput.sections.some(section => /Actual booking conversion is unknown/.test(section.body)));
      return { success: true, filePath: "uploads/fixture.pdf", fileName: "fixture.pdf",
        sections: finalInput.sections, modelUsed: "fixture" };
    },
  };
  return { deps, advance: () => advanceBusinessReportReview(clone(job), deps),
    get job() { return job; }, set job(next) { job = next; },
    stats: () => ({ juryCalls, finalized, signals, receipts: receipts.length }) };
}

test("new report replies reject missing action plans before final paid review and expose public advisory guidance", () => {
  const current = { ...clone(input), qualityContractVersion: 1 as const };
  const state = { ...initialBusinessReportReview(current), phase: "wait_muse" as const,
    correctionChecklist: [{ id: "C1", text: "Do not diagnose unknown CRM as absent." }] };
  const packet = buildMuseReportRequest(current, state);
  assert.match(packet.instruction, /may never have spoken with us/);
  assert.match(packet.instruction, /private revenue/);
  assert.equal(packet.qualityContractVersion, 1);
  assert.deepEqual(packet.correctionChecklist, state.correctionChecklist);
  assert.throws(() => validateMuseReportReply(current, state,
    { requestId: state.requestId, digest: state.digest, report: compiled }), /actionPlan/);
});

test("native compilation replaces Spark, retains a receipt, and still passes through final jury", async () => {
  const h = harness();
  delete h.job.payload.input.compilerMode; // Pending pre-change jobs adopt native compilation.
  h.job.payload.state.compilerSetupRequired = true;
  let calls = 0, reservations = 0;
  h.deps.reserveCompiler = async (_input, state) => {
    reservations++;
    return { [`compiler:${state.round}:${state.requestId}`]: { reservedMicros: 300000 } };
  };
  h.deps.compile = async (_tenant, prompt, _schema, deps) => {
    calls++;
    assert.equal(h.job.payload.state.phase, "compiling");
    assert.equal(h.job.payload.state.compilerSetupRequired, false, "Clear setup atomically before any in-flight call");
    assert.match(prompt, /juryFindings/);
    await deps.reserve(0.3);
    return { report: { requestId: h.job.payload.state.requestId,
      digest: h.job.payload.state.digest, report: compiled },
      receipt: { requestedModel: "gemini-4-argon", reportedModel: "gemini-4-argon",
        promptHash: "a".repeat(64), outputHash: "b".repeat(64), completedAt: new Date().toISOString() } };
  };
  await h.advance(); // Initial three-model jury.
  assert.equal(h.job.payload.state.phase, "wait_muse");
  assert.equal(h.stats().signals, 0);
  await h.advance(); // One native compiler; no finalization.
  assert.equal(calls, 1);
  assert.equal(reservations, 1);
  assert.ok(h.job.payload.state.reply);
  assert.equal((Object.values(h.job.payload.compilerRuns)[0] as any).status, "completed");
  assert.equal(h.stats().finalized, 0);
  await h.advance(); // Validate and move into final jury.
  assert.equal(h.job.payload.state.phase, "final_jury");
  await h.advance(); // Final three-model jury, still no PDF yet.
  assert.equal(h.stats().juryCalls, 2);
  assert.equal(h.job.payload.state.phase, "finalizing");
  assert.equal(h.stats().finalized, 0);
});

test("a compiler crash or invalid quotation is retained and cannot replay paid inference", async () => {
  for (const invalidQuote of [false, true]) {
    const h = harness();
    delete h.job.payload.input.compilerMode;
    h.job.payload.state.phase = "wait_muse";
    let calls = 0;
    h.deps.reserveCompiler = async () => ({ fixture: { reservedMicros: 300000 } });
    h.deps.compile = async (_tenant, _prompt, _schema, deps) => {
      calls++;
      await deps.reserve(0.3);
      if (!invalidQuote) throw new Error("provider completion uncertain");
      const bad = clone(compiled);
      bad.sections[0].blocks[0].text = "This statement is not in the retained source.";
      return { report: { requestId: h.job.payload.state.requestId, digest: h.job.payload.state.digest, report: bad },
        receipt: { requestedModel: "gemini-4-argon", reportedModel: "gemini-4-argon",
          promptHash: "a".repeat(64), outputHash: "b".repeat(64), completedAt: new Date().toISOString() } };
    };
    await assert.rejects(h.advance(), /compilation failed/);
    await assert.rejects(h.advance(), /stopped/);
    assert.equal(calls, 1);
    assert.equal(h.stats().finalized, 0);
    assert.deepEqual(h.job.payload.input.sections, input.sections);
    if (invalidQuote) assert.ok(h.job.payload.compilerRuns, "Keep the completed response audit even on quality rejection");
  }
});

test("a valid minority FIX is retained as a concrete checklist even when the majority finds no defect", async () => {
  const h = harness(["REJECT"]);
  const run = h.deps.juryTriage!;
  h.deps.juryTriage = async options => {
    const decision = await run(options);
    return { ...decision, votes: [{ ok: true, verdict: "FIX",
      rationale: "Roadmap effort is missing.", fixProposal: "Add a clearly labelled effort estimate to the roadmap." }] as any };
  };
  await h.advance();
  assert.equal(h.job.payload.state.phase, "wait_muse");
  assert.equal(h.job.payload.state.correctionChecklist.length, 1);
  assert.match(h.job.payload.state.correctionChecklist[0].text, /effort estimate/);
});

test("both report variants carry the validated action plan unchanged into the PDF assembly boundary", async () => {
  for (const kind of ["readiness", "executive"] as const) {
    const h = harness();
    h.job.payload.input = { ...h.job.payload.input, kind, qualityContractVersion: 1 };
    h.job.payload.state = initialBusinessReportReview(h.job.payload.input);
    await h.advance();
    const actionPlan = [1, 2, 3].map(priority => ({
      priority, action: "Pilot clearer product-selection guidance", sourceIds: ["S1"],
      benefit: "Reduce unnecessary customer back-and-forth.",
      effort: "Planning estimate: one week, confirm after a technical review.",
      cost: "Obtain a quote before committing to implementation.",
      risk: "Misrouting; retain human review and escalation.",
      dependency: "Confirm who responds to incoming enquiries.",
      owner: "Sales or website lead", measurement: "Measure qualified enquiries and response time during a bounded pilot.",
    }));
    h.job.payload.state.reply = { ...clone(compiled), actionPlan, corrections: [] };
    await h.advance();
    assert.deepEqual(h.job.payload.state.actionPlan, actionPlan);
    await h.advance();
    assert.equal(h.job.payload.state.phase, "finalizing");
    let assembled = 0;
    h.deps.finalize = async finalInput => {
      const plan = finalInput.sections.find(section => section.heading === "Prioritized Action Plan");
      assert.ok(plan);
      assert.match(plan.body, /Risk: Misrouting/);
      assert.match(plan.body, /Suggested owner: Sales or website lead/);
      assert.match(plan.body, /Pilot measurement: Measure qualified enquiries/);
      assert.equal(finalInput.sections.some(section => section.heading === "Report Review Record"), false);
      assert.ok(finalInput.sections.some(section => section.heading === "Research Approach"));
      assembled++;
      return { success: true, filePath: "uploads/fixture.pdf", fileName: "fixture.pdf", sections: finalInput.sections };
    };
    await h.advance();
    assert.equal(assembled, 1);
  }
});

test("durable draft jury → Muse wait → compiled jury → documented PDF; waiting makes no LLM calls", async () => {
  const h = harness();
  await h.advance();
  assert.equal(h.job.payload.state.phase, "wait_muse");
  await h.advance();
  assert.deepEqual(h.stats(), { juryCalls: 1, finalized: 0, signals: 1, receipts: 3 });
  const state = h.job.payload.state as BusinessReportReviewState;
  validateMuseReportReply(input, state, { requestId: state.requestId, digest: state.digest, report: compiled });
  h.job.payload.state.reply = clone(compiled);
  h.job.payload.state.replyHash = hashReportBytes(JSON.stringify(compiled));
  await h.advance();
  assert.equal(h.job.payload.state.phase, "final_jury");
  await h.advance();
  assert.equal(h.job.payload.state.phase, "finalizing");
  const result = await h.advance();
  assert.equal(result.success, true);
  assert.deepEqual(h.stats(), { juryCalls: 2, finalized: 1, signals: 1, receipts: 6 });
});

test("exact request and digest binding reject stale Muse replies and missing sections", () => {
  const state = { ...initialBusinessReportReview(input), phase: "wait_muse" as const };
  assert.throws(() => validateMuseReportReply(input, state, {
    requestId: state.requestId, digest: "different", report: compiled,
  }), /mismatched/);
  assert.throws(() => validateMuseReportReply(input, state, {
    requestId: state.requestId, digest: state.digest, report: { sections: [], unknowns: [] },
  }), /contract/);
});

test("second Muse handoff retains the compiled draft and a new digest; second failed revision stops without delivery", async () => {
  const h = harness(["FIX", "FIX", "FIX"]);
  await h.advance();
  h.job.payload.state.reply = clone(compiled);
  await h.advance(); await h.advance();
  assert.equal(h.job.payload.state.round, 2);
  const packet = buildMuseReportRequest(input, h.job.payload.state);
  assert.match(packet.draftSections[0].body, /Observed source quotation/);
  assert.doesNotMatch(JSON.stringify(packet), /private@example|private-payment|Private Person|3125550199/);
  h.job.payload.state.reply = clone(compiled);
  await h.advance();
  await assert.rejects(h.advance(), /two-round limit/);
  assert.equal(h.job.payload.state.phase, "blocked");
  assert.equal(h.stats().finalized, 0);
  assert.equal(h.stats().juryCalls, 3);
});

test("a crash after jury spend claim cannot repeat the jury; expired and cross-tenant jobs cannot assemble PDFs", async () => {
  const h = harness();
  h.job.payload.state.phase = "jury_started";
  await assert.rejects(h.advance(), /uncertain/);
  assert.equal(h.job.maxAttempts, h.job.attempts);
  assert.equal(h.stats().juryCalls, 0);
  h.job.payload.state.phase = "wait_muse";
  h.job.payload.state.expiresAt = "2020-01-01T00:00:00Z";
  await assert.rejects(h.advance(), /expired/);
  h.job.tenantId = 2;
  await assert.rejects(h.advance(), /tenant binding/);
  assert.equal(h.stats().finalized, 0);
});

test("a restart recovers the exact durable artifact instead of assembling a second PDF", async () => {
  const h = harness();
  h.job.payload.state = { ...h.job.payload.state, phase: "finalizing", reply: compiled,
    approvedSections: [{ heading: "Summary", body: "retained" }],
    juryHistory: [{ verdict: "REJECT", rationale: "No defects found" }] };
  h.job.payload.assemblyStarted = { fileName: "retained.pdf" };
  h.deps.recoverArtifact = async (_input, sections) => ({
    success: true, filePath: "uploads/retained.pdf", fileName: "retained.pdf", sections,
  });
  const recovered = await h.advance();
  assert.equal(recovered.fileName, "retained.pdf");
  assert.equal(h.stats().finalized, 0);
});

test("ambiguous assembly without durable bytes stops instead of automatically rendering twice; lost lease blocks assembly", async () => {
  const h = harness();
  h.job.payload.state = { ...h.job.payload.state, phase: "finalizing", reply: compiled,
    approvedSections: [{ heading: "Summary", body: "retained" }],
    juryHistory: [{ verdict: "REJECT", rationale: "No defects found" }] };
  h.job.payload.assemblyStarted = { fileName: "uncertain.pdf" };
  await assert.rejects(h.advance(), /no automatic reassembly/);
  assert.equal(h.stats().finalized, 0);
  h.job.payload.state.phase = "finalizing";
  h.deps.db = { execute: async () => ({ rows: [] }) };
  await assert.rejects(h.advance(), /lease lost/);
  assert.equal(h.stats().finalized, 0);
});
