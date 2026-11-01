import test from "node:test";
import assert from "node:assert/strict";
import { acceptCompilation, compilationEvidence, compilationMessages, COMPANY_HEADINGS,
  COMPANY_AUTHOR_CHARACTER_LIMIT } from "../../server/lib/company-compilation-content";
import { buildCompilationCatalog, hydrateCompilationReferences } from "../../server/lib/company-evidence-reference";
import { hashReportBytes, validateCompiledReport } from "../../server/lib/business-report-evidence";
import { compilationOperations, newCompilationMatrix } from "../../server/lib/company-compilation-matrix";
import { advanceParallelCompilation } from "../../server/lib/company-compilation-parallel";
import { subdivideCompilationAdvisories } from "../../server/lib/company-compilation-layout";

function fixture(kind: "executive" | "opportunities" = "executive") {
  const text = "Our licensed team provides scheduled plumbing maintenance and emergency repairs. ".repeat(20);
  const evidence = { version: 1, capturedAt: "2026-10-22", limitations: [], sources: [{
    id: "S1", kind: "public", title: "Services", text, sha256: hashReportBytes(text),
    url: "https://example.com/services", retrievedAt: "2026-10-22",
  }] };
  const op = compilationOperations().find(op => op.stage === "author" && op.kind === kind &&
    op.model === "google/gemini-4-argon")!;
  const matrix = newCompilationMatrix("reference-budget-fixture");
  matrix.slots[op.key] = { phase: "received", outputContract: 2 };
  const state = { intake: { company: "Fixture plumbing" }, research: { evidence }, compilation: matrix } as any;
  const catalog = buildCompilationCatalog(compilationEvidence(state.research.evidence));
  const report = { formatVersion: 2, catalogId: catalog.id,
    sections: COMPANY_HEADINGS[kind].map(() => ({ blocks: [
      { type: "recommendation", text: "Assign an owner; verify the current workflow before a measured pilot. ".repeat(30).slice(0, 1800), sourceIds: [] },
      { type: "fact", evidenceRef: catalog.entries[0].id },
      { type: "assumption", text: "Assume time is available; verify staffing and costs before approving expansion. ".repeat(30).slice(0, 1800), sourceIds: [] },
    ] })), unknowns: ["Staffing and current internal systems are not verified."] };
  const raw = { model: op.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(report) } }] };
  return { state, op, catalog, report, raw };
}

test("new packages request concise bullet-led analysis without changing historical prompts or evidence", () => {
  const f = fixture();
  const current = compilationMessages(f.state, f.op, []);
  assert.equal(f.state.compilation.readingStyle, "concise-bullets-v1");
  assert.match(current[0].content, /CONCISE CUSTOMER REPORT/);
  assert.match(current[0].content, /7,000–10,000/);
  assert.doesNotMatch(current[0].content, /10,000–16,000/);
  const historical = structuredClone(f.state);
  delete historical.compilation.readingStyle;
  const original = compilationMessages(historical, f.op, []);
  assert.doesNotMatch(original[0].content, /CONCISE CUSTOMER REPORT/);
  assert.match(original[0].content, /10,000–16,000/);
  assert.deepEqual(JSON.parse(current[1].content).evidenceCatalog, JSON.parse(original[1].content).evidenceCatalog);
  const synthesis = compilationOperations().find(op => op.stage === "synthesis" && op.kind === f.op.kind)!;
  f.state.compilation.slots[synthesis.key] = { phase: "claimed", outputContract: 2 };
  const final = compilationMessages(f.state, synthesis, []);
  assert.match(final[0].content, /12,000–16,000/);
  assert.doesNotMatch(final[0].content, /20,000–28,000/);
  assert.match(final[0].content, /same PDF/);
});

test("a validated author fits the unchanged wire limit by losslessly referencing catalog quotations", () => {
  const f = fixture(), before = JSON.stringify(f.raw);
  const expanded = hydrateCompilationReferences(f.report, COMPANY_HEADINGS.executive, f.catalog);
  const expected = validateCompiledReport(expanded, COMPANY_HEADINGS.executive, f.catalog.evidence, true, "compilation").compiled;
  assert.ok(JSON.stringify(expected).length > COMPANY_AUTHOR_CHARACTER_LIMIT);
  assert.ok(Buffer.byteLength(JSON.stringify(expected)) < 30_000);
  const accepted = acceptCompilation(f.state, f.op, f.raw);
  assert.ok(accepted.length <= COMPANY_AUTHOR_CHARACTER_LIMIT);
  assert.ok(Buffer.byteLength(accepted) <= 30_000);
  assert.equal(JSON.parse(accepted).formatVersion, 2);
  const restored = hydrateCompilationReferences(JSON.parse(accepted), COMPANY_HEADINGS.executive, f.catalog);
  assert.deepEqual(restored, expected, "all prose, facts, citations, ordering and unknowns survive exactly");
  assert.equal(JSON.stringify(f.raw), before, "never rewrite a saved paid response");
});

test("a historical synthesis receives expanded prose, not undecodable reference-only drafts", () => {
  const f = fixture(), accepted = acceptCompilation(f.state, f.op, f.raw);
  const synthesis = compilationOperations().find(op => op.stage === "synthesis" && op.kind === "executive")!;
  const messages = compilationMessages(f.state, synthesis, [accepted, accepted, accepted]);
  const input = JSON.parse(messages[1].content);
  assert.equal(input.independentCompilations.length, 3);
  for (const draft of input.independentCompilations)
    assert.deepEqual(draft, hydrateCompilationReferences(JSON.parse(accepted), COMPANY_HEADINGS.executive, f.catalog));
});

test("a new synthesis retains compact drafts but rejects a mismatched catalog before dispatch", () => {
  const f = fixture(), accepted = acceptCompilation(f.state, f.op, f.raw);
  const synthesis = compilationOperations().find(op => op.stage === "synthesis" && op.kind === "executive")!;
  f.state.compilation.slots[synthesis.key] = { phase: "claimed", outputContract: 2 };
  const input = JSON.parse(compilationMessages(f.state, synthesis, [accepted, accepted, accepted])[1].content);
  assert.deepEqual(input.independentCompilations, Array(3).fill(JSON.parse(accepted)));
  assert.equal(input.evidenceCatalog.catalogId, JSON.parse(accepted).catalogId);
  const forged = JSON.parse(accepted);
  forged.catalogId = "wrong-catalog";
  assert.throws(() => compilationMessages(f.state, synthesis, [JSON.stringify(forged), accepted, accepted]), /Invalid block/);
});

test("catalog-bound transport measures the actual synthesis input, not duplicated hydrated excerpts", () => {
  const f = fixture();
  f.state.research.evidence.sources[0].text = "界".repeat(600);
  f.state.research.evidence.sources[0].sha256 = hashReportBytes("界".repeat(600));
  const catalog = buildCompilationCatalog(compilationEvidence(f.state.research.evidence));
  f.report.catalogId = catalog.id;
  for (const section of f.report.sections) section.blocks[1].evidenceRef = catalog.entries[0].id;
  f.raw.choices[0].message.content = JSON.stringify(f.report);
  assert.ok(f.raw.choices[0].message.content.length < COMPANY_AUTHOR_CHARACTER_LIMIT);
  const expanded = hydrateCompilationReferences(f.report, COMPANY_HEADINGS.executive, catalog);
  assert.ok(Buffer.byteLength(JSON.stringify(expanded)) > 30_000);
  const accepted = acceptCompilation(f.state, f.op, f.raw);
  assert.ok(accepted.length <= 25_000 && Buffer.byteLength(accepted) <= 30_000);
  assert.deepEqual(hydrateCompilationReferences(JSON.parse(accepted), COMPANY_HEADINGS.executive, catalog), expanded);
  const synthesis = compilationOperations().find(op => op.stage === "synthesis" && op.kind === "executive")!;
  f.state.compilation.slots[synthesis.key] = { phase: "claimed", outputContract: 2 };
  const packet = JSON.stringify(compilationMessages(f.state, synthesis, [accepted, accepted, accepted]));
  assert.ok(packet.length <= 200_000 && Buffer.byteLength(packet) <= 240_000);
  f.report.sections[0].blocks[1].evidenceRef = "E_forged";
  f.raw.choices[0].message.content = JSON.stringify(f.report);
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw), /Invalid block/);
});

test("3071- and 3018-character advisory paragraphs are losslessly subdivided before acceptance", () => {
  const f = fixture();
  f.report.sections[0].blocks[0].text = ("Keep the complete recommendation with exact spacing and citations. ".repeat(60)).slice(0, 3071);
  f.report.sections[1].blocks[2].text = ("Verify the assumptions before changing the customer workflow. ".repeat(60)).slice(0, 3018);
  f.raw.choices[0].message.content = JSON.stringify(f.report);
  const before = JSON.stringify(f.raw);
  const wire = acceptCompilation(f.state, f.op, f.raw);
  assert.ok(wire.length > 25_000 && wire.length <= 30_000,
    "explicitly exercise the revised reference-only character boundary");
  assert.ok(Buffer.byteLength(wire) <= 30_000);
  const accepted = JSON.parse(wire);
  const report = accepted.formatVersion === 2
    ? hydrateCompilationReferences(accepted, COMPANY_HEADINGS.executive, f.catalog) : accepted;
  assert.equal(report.sections[0].blocks.slice(0, 2).map((b: any) => b.text).join(""), f.report.sections[0].blocks[0].text);
  assert.equal(report.sections[1].blocks.slice(-2).map((b: any) => b.text).join(""), f.report.sections[1].blocks[2].text);
  assert.ok(report.sections.every((s: any) => s.blocks.every((b: any) => b.text.length <= 3000)));
  assert.equal(JSON.stringify(f.raw), before);
});

test("layout recovery cannot hide invalid citations, extra keys, oversized transport or excessive block count", () => {
  const f = fixture();
  f.report.sections[0].blocks[0].text = "Complete substantial advice. ".repeat(120);
  (f.report.sections[0].blocks[0] as any).sourceIds = ["not-a-source"];
  f.raw.choices[0].message.content = JSON.stringify(f.report);
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw), /Invalid block/);
  (f.report.sections[0].blocks[0] as any).sourceIds = [];
  (f.report.sections[0].blocks[0] as any).hidden = "must not be discarded";
  f.raw.choices[0].message.content = JSON.stringify(f.report);
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw), /Invalid block/);
  delete (f.report.sections[0].blocks[0] as any).hidden;
  f.report.sections[0].blocks = Array.from({ length: 24 }, () => ({ ...f.report.sections[0].blocks[0] }));
  f.raw.choices[0].message.content = JSON.stringify(f.report);
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw));
});

test("reference authors still reject more than 30k wire bytes, including multibyte prose", () => {
  const f = fixture();
  for (const section of f.report.sections) {
    section.blocks[0].text = "界".repeat(1800);
    section.blocks[2].text = "Supported planning assumptions must be verified. ".repeat(30);
  }
  f.raw.choices[0].message.content = JSON.stringify(f.report);
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw), /synthesis input allowance/);
});

test("layout subdivision preserves surrogate pairs, separators and the complete input object", () => {
  const f = fixture();
  f.report.sections[0].blocks[0].text = "😀".repeat(1501);
  const before = structuredClone(f.report);
  const normalized = subdivideCompilationAdvisories(f.report) as any;
  const parts = normalized.sections[0].blocks.slice(0, 2).map((b: any) => b.text);
  assert.equal(parts.join(""), f.report.sections[0].blocks[0].text);
  assert.ok(parts.every((part: string) => part.length <= 3000 &&
    !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(part)));
  assert.deepEqual(f.report, before);
});

test("legacy author limits and already-fitting validated report representations remain unchanged", () => {
  const f = fixture();
  const expanded = hydrateCompilationReferences(f.report, COMPANY_HEADINGS.executive, f.catalog);
  delete f.state.compilation.slots[f.op.key].outputContract;
  f.raw.choices[0].message.content = JSON.stringify(expanded);
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw), /synthesis input allowance/);
  f.state.compilation.slots[f.op.key].outputContract = 2;
  for (const section of f.report.sections) {
    section.blocks[0].text = section.blocks[0].text!.slice(0, 600);
    section.blocks[2].text = section.blocks[2].text!.slice(0, 600);
  }
  f.raw.choices[0].message.content = JSON.stringify(f.report);
  const fitting = JSON.parse(acceptCompilation(f.state, f.op, f.raw));
  assert.equal(fitting.formatVersion, undefined);
  assert.equal(fitting.evidenceContract, 2);
  assert.equal(fitting.sections[0].blocks[1].text, f.catalog.entries[0].text);
});

for (const [kind, expandedCharacters] of [["executive", 26_553], ["opportunities", 26_813]] as const)
  test(`privacy-safe ${kind} fixture reproduces the saved ${expandedCharacters}-character boundary`, () => {
    const f = fixture(kind);
    const expanded = () => ({ ...hydrateCompilationReferences(f.report, COMPANY_HEADINGS[kind], f.catalog),
      evidenceContract: 2 });
    const growth = expandedCharacters - JSON.stringify(expanded()).length;
    assert.ok(growth > 0 && growth < 1000);
    f.report.sections[0].blocks[0].text += ".".repeat(growth);
    assert.equal(JSON.stringify(expanded()).length, expandedCharacters);
    f.raw.choices[0].message.content = JSON.stringify(f.report);
    const accepted = acceptCompilation(f.state, f.op, f.raw);
    assert.ok(accepted.length <= COMPANY_AUTHOR_CHARACTER_LIMIT);
    assert.deepEqual(hydrateCompilationReferences(JSON.parse(accepted), COMPANY_HEADINGS[kind], f.catalog),
      hydrateCompilationReferences(f.report, COMPANY_HEADINGS[kind], f.catalog));
  });

test("nine oversized reference authors feed three complete syntheses without dropping report content", async () => {
  const f = fixture();
  f.state.compilation = newCompilationMatrix("all-reference-budget-fixture");
  const requests: string[] = [];
  await advanceParallelCompilation(f.state.compilation, {
    outputContract: 2,
    checkpoint: async () => {},
    request: async (op, drafts) => {
      requests.push(op.key);
      const messages = compilationMessages(f.state, op, drafts);
      assert.ok(JSON.stringify(messages).length < 200_000);
      assert.ok(Buffer.byteLength(JSON.stringify(messages)) < 240_000);
      if (op.stage === "synthesis") {
        assert.equal(drafts.length, 3);
        for (const draft of drafts) assert.equal(JSON.parse(draft).formatVersion, 2);
      }
      return { model: op.model, choices: [{ finish_reason: "stop",
        message: { content: JSON.stringify(f.report) } }] };
    },
    accept: (op, raw) => acceptCompilation(f.state, op, raw),
  });
  assert.equal(requests.length, 12);
  assert.equal(f.state.compilation.phase, "complete");
  for (const op of compilationOperations()) {
    const slot = f.state.compilation.slots[op.key];
    assert.equal(slot.phase, "complete");
    if (op.stage === "synthesis") {
      const report = JSON.parse(slot.text);
      assert.equal(report.formatVersion, undefined, "final reports remain fully expanded");
      assert.equal(report.sections.length, 6);
      assert.ok(report.sections.every((section: any) => section.blocks[1].text === f.catalog.entries[0].text));
    }
  }
});
