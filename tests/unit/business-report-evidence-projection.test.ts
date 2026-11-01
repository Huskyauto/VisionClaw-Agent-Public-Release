import test from "node:test";
import assert from "node:assert/strict";
import { hashReportBytes, type ReportEvidence } from "../../server/lib/business-report-evidence";
import { buildMuseReportRequest, buildReportJurySnapshot, initialBusinessReportReview } from "../../server/lib/business-report-review";
import { sanitizeAgentOutput } from "../../server/safety-layer";

test("large-site review retains every source byte and discloses a bounded excluded-page index", () => {
  const origin = "https://example.com";
  const urls = Array.from({ length: 215 }, (_, i) =>
    `${origin}/service-areas/furnace-installation-and-maintenance-in-community-${i}/`);
  const evidence: ReportEvidence = {
    version: 1, capturedAt: "2026-10-20T07:00:00Z",
    sources: urls.slice(0, 115).map((url, i) => {
      const text = `Community ${i}: ` + "Verified heating and cooling service information. ".repeat(12);
      return { id: `S${i + 1}`, title: `Rendered browser page: ${url}`, url, text,
        sha256: hashReportBytes(text), retrievedAt: "2026-10-20T07:00:00Z", kind: "public" };
    }),
    limitations: urls.slice(115).flatMap(url => [
      `Review-bearing prose excluded from company facts: ${url}`,
      `No safely separated browser-confirmed company content: ${url}`,
    ]),
  };
  const input = { tenantId: 1, kind: "executive" as const, orderId: "offline-large-site",
    customerEmail: "", modelId: "fixture", intake: { company: "Example" }, evidence,
    sections: Array.from({ length: 10 }, (_, i) => ({ heading: `Section ${i}`,
      body: "Detailed supported recommendations and practical implementation guidance. ".repeat(80) })) };
  const original = structuredClone(input);
  const packet = buildMuseReportRequest(input, initialBusinessReportReview(input));
  assert.ok(JSON.stringify(packet).length < 180_000, "review must fit without truncating drafts or evidence");
  assert.equal(packet.evidence.sources.length, evidence.sources.length);
  for (const [i, source] of packet.evidence.sources.entries()) {
    const retained = evidence.sources[i];
    assert.equal(source.id, retained.id);
    assert.equal(source.text, retained.text);
    assert.equal(source.url, retained.url);
    assert.equal(source.kind, retained.kind);
    assert.equal(source.retrievedAt, retained.retrievedAt);
    assert.equal(Buffer.from(source.sha256.split(":")[1], "base64url").toString("hex"), retained.sha256);
    assert.equal(source.title, "Rendered browser page");
  }
  assert.ok(packet.evidence.limitations.some(line => line.includes("100 distinct page URLs")));
  assert.ok(packet.evidence.limitations.some(line => line.includes("retained in private evidence")));
  assert.ok(packet.evidence.limitations.some(line => line.includes("Counts across exclusion reasons may overlap")));
  assert.ok(packet.evidence.limitations.some(line => line.includes("Review-bearing prose excluded")));
  assert.ok(packet.evidence.limitations.some(line => line.includes("No safely separated")));
  assert.deepEqual(input, original, "wire minimization must not mutate persisted evidence or draft identity");
});

test("the executed juror snapshot uses the same checked, compact source projection without credential-shaped hashes", () => {
  const text = "We install and maintain residential heating systems.";
  const source = { id: "S1", title: "Rendered browser page: https://example.com/heating/",
    url: "https://example.com/heating/", text, sha256: hashReportBytes(text),
    retrievedAt: "2026-10-20T07:00:00Z", kind: "public" as const };
  const input = { tenantId: 1, kind: "executive" as const, orderId: "offline-juror",
    customerEmail: "", modelId: "fixture", intake: { company: "Example" },
    evidence: { version: 1 as const, capturedAt: source.retrievedAt, sources: [source], limitations: [] },
    sections: [{ heading: "Summary", body: "Retained draft." }] };
  const state = initialBusinessReportReview(input);
  const snapshot = buildReportJurySnapshot({ input, state }, true);
  const record = JSON.parse(snapshot);
  assert.deepEqual(record.evidence, buildMuseReportRequest(input, state).evidence);
  assert.equal(record.evidence.sources[0].text, text);
  assert.equal(sanitizeAgentOutput(snapshot).redacted, false);
  assert.throws(() => buildReportJurySnapshot({ input: { ...input, evidence: {
    ...input.evidence, sources: [{ ...source, sha256: "a".repeat(64) }] } }, state }, true), /hash mismatch/);
  assert.throws(() => buildMuseReportRequest({ ...input, evidence: {
    ...input.evidence, sources: [source, source] } }, state), /Ambiguous/);
});

test("post-jury packets retain exact repeated evidence and corrections once, through explicit lossless references", () => {
  const text = "Verified company service information. ".repeat(100);
  const evidence: ReportEvidence = { version: 1, capturedAt: "2026-10-20T07:00:00Z", limitations: [],
    sources: Array.from({ length: 12 }, (_, i) => ({ id: `S${i + 1}`, title: "Service page",
      url: `https://example.com/service-${i}/`, kind: "public" as const, text,
      sha256: hashReportBytes(text), retrievedAt: "2026-10-20T07:00:00Z" })) };
  const input = { tenantId: 1, kind: "executive" as const, orderId: "offline-post-jury", customerEmail: "",
    modelId: "fixture", qualityContractVersion: 1 as const, evidence, intake: { company: "Example" },
    sections: [{ heading: "Summary", body: "Detailed practical implementation guidance. ".repeat(1200) }] };
  const correction = "Explain implementation dependencies without claiming measured revenue. ".repeat(40);
  const state = { ...initialBusinessReportReview(input), phase: "wait_muse" as const,
    correctionChecklist: [{ id: "C1-1-1", text: correction }],
    juryHistory: [{ verdict: "FIX", rationale: JSON.stringify({
      votes: [{ model: "fixture", verdict: "FIX", ok: true, rationale: "Needs a concrete plan." }],
      corrections: `fixture:\n${correction}\nAdditional material not present in the checklist.`,
      unknowns: ["Private costs are unknown."],
    }) }] };
  const original = structuredClone({ input, state });
  const packet = buildMuseReportRequest(input, state);
  assert.ok(JSON.stringify(packet).length < 110_000);
  const sources: any[] = packet.evidence.sources;
  assert.equal(sources[1].textSameAsSourceId, "S1");
  for (const source of sources) {
    const expanded = source.textSameAsSourceId ? sources.find(s => s.id === source.textSameAsSourceId).text : source.text;
    assert.equal(expanded, text, "each source's exact bytes must be recoverable");
    assert.equal(Buffer.from(source.sha256.split(":")[1], "base64url").toString("hex"), hashReportBytes(expanded));
  }
  const finding = JSON.parse(packet.juryFindings[0].rationale);
  assert.ok(finding.corrections.includes("[correctionChecklist:C1-1-1]"));
  assert.ok(finding.corrections.includes("Additional material not present in the checklist."));
  assert.deepEqual(finding.unknowns, ["Private costs are unknown."]);
  assert.equal(packet.correctionChecklist[0].text, correction);
  assert.deepEqual({ input, state }, original);
});
