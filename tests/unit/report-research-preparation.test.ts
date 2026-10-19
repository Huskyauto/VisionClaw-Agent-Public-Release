import test from "node:test";
import assert from "node:assert/strict";
import { classifyReportResearch } from "../../server/lib/report-research-preparation";
import { hashReportBytes, collectBusinessReportEvidence } from "../../server/lib/business-report-evidence";
import { analyzeAgentJourney } from "../../server/lib/agent-journey";

const evidence = () => ({ version: 1 as const, capturedAt: "2026-10-15", limitations: [],
  sources: Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, title: "Product page", kind: "public" as const,
    text: "Railroad safety products. Reach sales@example.com for more information.",
    sha256: hashReportBytes("Railroad safety products. Reach sales@example.com for more information."), retrievedAt: "2026-10-15" })) });

test("Jev classifies bounded source batches without dropping evidence or sending contacts", async () => {
  const input = evidence();
  let calls = 0;
  const result = await classifyReportResearch(input, async request => {
    calls++;
    assert.ok(Object.keys(request.questions).length <= 3);
    assert.ok(JSON.stringify(request.state).length < 12_000);
    assert.ok(!JSON.stringify(request).includes("sales@example.com"));
    return { model: "jev-latest", usage: { input_tokens: 20, output_tokens: 5 },
      answers: Object.fromEntries(Object.keys(request.questions).map(key =>
        [key, { type: "choice" as const, choice: "commercial_offer", confidence: 0.95 }])) };
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.sources, input.sources);
  assert.equal(result.researchClassification.entries.length, 4);
  assert.ok(result.researchClassification.entries.every(e => e.category === "commercial_offer"));
  assert.equal(result.researchClassification.evidenceChanged, false);
});

test("free research never enters paid extraction when direct retrieval is blocked", async () => {
  let fallbacks = 0;
  const deps: any = {
    runAudit: async () => ({ checks: [], finalUrl: "https://example.com/" }),
    safeFetchText: async () => ({ ok: false, status: 403, error: "blocked" }),
    fallback: async () => { fallbacks++; return { success: true, content: "Fallback".repeat(100) }; },
  };
  const result = await collectBusinessReportEvidence({ company: "Example", website: "https://example.com/" },
    { allowPaidExtraction: false }, deps);
  assert.equal(fallbacks, 0);
  assert.ok(!result.sources.some(s => s.kind === "public"));
  assert.match(result.limitations.join(" "), /paid extraction.*disabled/i);
});

test("full-report evidence retains all five bounded journey sources and their safety/coverage limits", async () => {
  const journey = analyzeAgentJourney([{ url: "https://example.com/", html: "<p>Request a quote</p>" }]);
  const deps: any = {
    runAudit: async () => ({ checks: [], finalUrl: "https://example.com/", agentJourney: journey }),
    safeFetchText: async () => ({ ok: false, reason: "HTTP 403" }),
    fallback: async () => { throw new Error("No paid extraction allowed"); },
  };
  const result = await collectBusinessReportEvidence({ company: "Example", website: "https://example.com/" },
    { allowPaidExtraction: false }, deps);
  assert.equal(result.sources.filter(source => source.title.startsWith("Read-only agent journey:")).length, 5);
  const scope = result.sources.find(source => source.title.startsWith("Read-only agent customer journey scope"));
  assert.ok(scope);
  assert.match(scope.text, /No forms were submitted/);
  assert.match(scope.text, /Only captured server-rendered pages/);
  for (const check of journey.checks) {
    const source = result.sources.find(source => source.title === `Read-only agent journey: ${check.label}`);
    assert.ok(source);
    assert.ok(source.text.includes(check.finding));
    assert.equal(source.kind, "measurement");
    assert.equal(source.sha256, hashReportBytes(source.text));
  }
});

test("missing or invalid classification stops before expensive review instead of silently skipping Jev", async () => {
  await assert.rejects(classifyReportResearch(evidence(), async () => ({
    model: "jev-latest", usage: { input_tokens: 1, output_tokens: 1 }, answers: {},
  })), /classification/);
  await assert.rejects(classifyReportResearch(evidence(), async () => { throw new Error("Jev unavailable"); }), /Jev unavailable/);
});

test("the report stop switch prevents additional Jev classification batches", async () => {
  const previous = process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED;
  delete process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED;
  let calls = 0;
  try {
    await assert.rejects(classifyReportResearch(evidence(), async request => {
      calls++;
      process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED = "1";
      return { model: "jev-latest", usage: { input_tokens: 1, output_tokens: 1 },
        answers: Object.fromEntries(Object.keys(request.questions).map(key =>
          [key, { type: "choice" as const, choice: "other_or_unclear" }])) };
    }), /stopped/);
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED;
    else process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED = previous;
  }
});
