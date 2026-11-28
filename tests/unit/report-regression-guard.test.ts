import test, { mock } from "node:test";
import { Socket } from "node:net";
import assert from "node:assert/strict";
import { compareReportSnapshots, runReportRegressionGuard, type ReportSnapshot } from "../../scripts/lib/report-regression-guard";

// Set before the first dynamic production import, not merely after the first
// replay. This test file runs in its own Node test process.
mock.method(globalThis, "fetch", async () => { throw new Error("Offline report guard: fetch denied"); });
mock.method(Socket.prototype, "connect", () => { throw new Error("Offline report guard: TCP denied"); });

const snapshot = (): ReportSnapshot => ({
  id: "fictional-retailer", kind: "readiness",
  sections: [{ heading: "Executive Assessment", blocks: [
    { type: "fact", text: "The fictional shop lists 12 products.", sourceIds: ["S1"] },
    { type: "recommendation", text: "Ask the owner to test the quote form for 14 days.", sourceIds: [] },
    { type: "assumption", text: "Staff capacity is unknown; confirm before starting.", sourceIds: [] },
  ] }],
  unknowns: ["The current conversion rate is unknown."],
  sources: [{ id: "S1", sha256: "a".repeat(64), url: "https://retail.example.test/" }],
  narration: "Ask the owner to test the quote form for 14 days.",
});

test("the guard blocks fetch and TCP before loading production report code", async () => {
  await assert.rejects(fetch("http://127.0.0.1:1/"), /Offline report guard/);
  const socket = new Socket();
  try {
    assert.throws(() => socket.connect({ port: 1, host: "127.0.0.1" }), /Offline report guard/);
  } finally { socket.destroy(); }
});

test("production replay covers three fictional businesses and both retained response contracts", async () => {
  const result = await runReportRegressionGuard();
  assert.equal(result.length, 6);
  assert.equal(new Set(result.map(item => item.id)).size, 3);
  assert.deepEqual(result.map(item => item.comparison), Array.from({ length: 6 }, () => ({
    regressions: [], review: [],
  })));
});

test("unchanged report content passes while changed figures are deterministic regressions", () => {
  const before = snapshot(), after = structuredClone(before);
  assert.deepEqual(compareReportSnapshots(before, after), { regressions: [], review: [] });
  after.sections[0].blocks[1].text = "Ask the owner to test the quote form for 140 days.";
  assert.ok(compareReportSnapshots(before, after).regressions.some(issue => issue.includes("numeric")));
});

test("lost sections, evidence, limitations and changed fact labels cannot pass as wording changes", () => {
  for (const mutate of [
    (s: ReportSnapshot) => { s.sections = []; },
    (s: ReportSnapshot) => { s.sections[0].blocks = s.sections[0].blocks.slice(1); },
    (s: ReportSnapshot) => { s.sections[0].blocks[0].sourceIds = []; },
    (s: ReportSnapshot) => { s.sections[0].blocks[0].type = "recommendation"; },
    (s: ReportSnapshot) => { s.sections[0].blocks[0].text = "The fictional shop lists twelve products."; },
    (s: ReportSnapshot) => { s.sources[0].url = "https://unretrieved.example.test/"; },
    (s: ReportSnapshot) => { s.unknowns = []; },
  ]) {
    const before = snapshot(), after = structuredClone(before);
    mutate(after);
    assert.ok(compareReportSnapshots(before, after).regressions.length);
    assert.equal(before.sections[0].blocks.length, 3);
  }
});

test("spacing is ignored but changed advice requires review without a false factual regression", () => {
  const before = snapshot(), after = structuredClone(before);
  after.sections[0].blocks[1].text = "Ask  the owner to test the quote form\nfor 14 days.";
  assert.deepEqual(compareReportSnapshots(before, after), { regressions: [], review: [] });
  after.sections[0].blocks[1].text = "Do not test the quote form for 14 days.";
  const result = compareReportSnapshots(before, after);
  assert.deepEqual(result.regressions, []);
  assert.ok(result.review.length, "Reversed advice must not silently pass");
});

test("replaying production acceptance never calls fetch", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", () => { requests++; throw new Error("Offline fixture cannot access a provider"); });
  await runReportRegressionGuard();
  assert.equal(requests, 0);
});

test("a production title change is detected against an independent expected title", async () => {
  const { COMPANY_REPORT_TITLES } = await import("../../server/lib/company-compilation-content");
  const original = COMPANY_REPORT_TITLES.readiness;
  try {
    COMPANY_REPORT_TITLES.readiness = "Accidentally renamed report";
    const result = await runReportRegressionGuard();
    assert.ok(result.filter(item => item.id === "retail").every(item =>
      item.comparison.regressions.length + item.comparison.review.length > 0));
  } finally { COMPANY_REPORT_TITLES.readiness = original; }
});

test("new report requests ask for one evidence-bound action brief and low-cost customer acquisition", async () => {
  const { compilationMessages } = await import("../../server/lib/company-compilation-content");
  const { compilationOperations } = await import("../../server/lib/company-compilation-matrix");
  const { initialPackage } = await import("../../server/lib/company-report-package-core");
  const { reportRegressionCases } = await import("../../scripts/lib/report-regression-cases");
  for (const fixture of reportRegressionCases()) for (const contract of [1, 2]) {
    for (const op of compilationOperations().filter(item => item.kind === fixture.kind)) {
      const state = initialPackage({ company: fixture.company, website: fixture.source.url });
      state.research = { evidence: { version: 1, capturedAt: fixture.source.retrievedAt,
        sources: [fixture.source], limitations: [] }, coverage: { discovered: 1, reviewed: 1, failed: 0, capped: false } };
      if (contract === 2) Object.assign(state, { compilation: { slots: { [op.key]: { outputContract: 2 } } } });
      const before = JSON.stringify(state);
      const prompt = compilationMessages(state, op, [])[0].content;
      assert.match(prompt, /FIRST ACTION BRIEF/);
      assert.match(prompt, /no paid advertising/);
      assert.match(prompt, /unknown rather than inventing/);
      assert.equal(JSON.stringify(state), before);
    }
  }
});
