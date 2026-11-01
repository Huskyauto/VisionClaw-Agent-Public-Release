import test from "node:test";
import assert from "node:assert/strict";
import { acceptCompilation, COMPANY_HEADINGS } from "../../server/lib/company-compilation-content";
import { compilationOperations, advanceCompilationMatrix, newCompilationMatrix } from "../../server/lib/company-compilation-matrix";
import { initialPackage } from "../../server/lib/company-report-package-core";
import { hashReportBytes } from "../../server/lib/business-report-evidence";
import { validateCompiledReport } from "../../server/lib/business-report-evidence";
import { compilationValidationFailure } from "../../server/lib/company-compilation-checks";

function fixture() {
  const state = initialPackage({ company: "Offline fixture", website: "https://example.com" });
  const source = "A retained public source describes consulting services for small businesses.";
  state.research = { complete: true, evidence: {
    version: 1, capturedAt: "2026-10-20", limitations: [],
    sources: [{ id: "S1", text: source, sha256: hashReportBytes(source), title: "Services",
      url: "https://example.com", kind: "public", retrievedAt: "2026-10-20" }],
  } } as any;
  const report = {
    sections: COMPANY_HEADINGS.readiness.map(heading => ({ heading, blocks: [
      { type: "fact", text: source, sourceIds: ["S1"] },
      { type: "recommendation", text: "Assign an owner to run a bounded pilot, measure the outcomes, and verify the costs before expansion. ".repeat(5), sourceIds: ["S1"] },
      { type: "assumption", text: "Assume staff time is available; confirm this with management before approving the proposed pilot. ".repeat(5), sourceIds: [] },
    ] })),
    unknowns: ["Internal staffing and current systems are not verified."],
  };
  const op = compilationOperations()[1];
  const raw = (content: string) => ({ model: op.model, choices: [{ finish_reason: "stop", message: { content } }] });
  return { state, report, op, raw };
}

test("omitted advisory citation arrays are empty, without inventing factual citations", () => {
  const f = fixture();
  for (const section of f.report.sections) {
    delete (section.blocks[1] as any).sourceIds;
    delete (section.blocks[2] as any).sourceIds;
  }
  const raw = f.raw(JSON.stringify(f.report)), original = JSON.stringify(raw);
  const accepted = JSON.parse(acceptCompilation(f.state, f.op, raw));
  assert.deepEqual(accepted.sections[0].blocks[1].sourceIds, []);
  assert.equal(JSON.stringify(raw), original);
  for (const invalid of [null, "S1", ["S99"]]) {
    (f.report.sections[0].blocks[1] as any).sourceIds = invalid;
    assert.throws(() => acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report))), /Invalid block/);
  }
  delete (f.report.sections[0].blocks[1] as any).sourceIds;
  delete (f.report.sections[0].blocks[0] as any).sourceIds;
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report))), /Invalid block/);
});

test("reordered audit lines become separate verified excerpts without another model call", async () => {
  const f = fixture(), source = f.state.research!.evidence.sources[0];
  const lines = [
    "Meta description: FAIL — No meta description found.",
    "Canonical URL: FAIL — No canonical <link> found.",
    "Open Graph tags: FAIL — 0/3 core Open Graph tags present (og:title, og:description, og:image).",
    "Twitter/X card: FAIL — No twitter:card meta found.",
    "Mobile viewport: FAIL — No mobile viewport meta found.",
    "Language declaration: FAIL — No lang attribute on <html>.",
    "XML sitemap: WARN — No sitemap.xml at the site root (it may live elsewhere).",
  ];
  source.text = lines.join("\n");
  source.sha256 = hashReportBytes(source.text);
  for (const section of f.report.sections) section.blocks[0].text = lines[0];
  const reordered = [lines[6], ...lines.slice(0, 6)];
  f.report.sections[4].blocks[0].text = reordered.join("\n");
  const raw = f.raw(JSON.stringify(f.report)), original = JSON.stringify(raw);
  const matrix = newCompilationMatrix("reordered-audit-fixture");
  matrix.slots[compilationOperations()[0].key] = { phase: "complete", text: "previously accepted" };
  matrix.slots[f.op.key] = { phase: "received", raw };
  let calls = 0;
  await advanceCompilationMatrix(matrix, {
    checkpoint: async () => {},
    request: async () => { calls++; throw new Error("No repeat purchase"); },
    accept: (operation, response) => acceptCompilation(f.state, operation, response),
  });
  assert.equal(calls, 0);
  assert.equal(matrix.slots[f.op.key].phase, "complete");
  const accepted = JSON.parse(matrix.slots[f.op.key].text!);
  assert.deepEqual(accepted.sections[4].blocks.filter((block: any) => block.type === "fact")
    .map((block: any) => block.text), reordered);
  assert.equal(JSON.stringify(raw), original);
});

test("ellipsis-separated source excerpts become independently verified quotes in source order", () => {
  const f = fixture(), source = f.state.research!.evidence.sources[0];
  const first = "Weekly menu delivery is available.", last = "Delivery fees apply to all orders.";
  source.text = `${first}\nContact the office for scheduling details.\n${last}`;
  source.sha256 = hashReportBytes(source.text);
  for (const section of f.report.sections) section.blocks[0].text = first;
  f.report.sections[0].blocks[0].text = `${first}\n...\n${last}`;
  const raw = f.raw(JSON.stringify(f.report)), original = JSON.stringify(raw);
  const accepted = JSON.parse(acceptCompilation(f.state, f.op, raw));
  assert.deepEqual(accepted.sections[0].blocks.slice(0, 2).map((b: any) => b.text), [first, last]);
  assert.equal(JSON.stringify(raw), original);
  f.report.sections[0].blocks[0].text = `${last}\n...\n${first}`;
  assert.deepEqual(JSON.parse(acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report))))
    .sections[0].blocks.slice(0, 2).map((b: any) => b.text), [last, first]);
  for (const text of [`${first}\n...\nInvented unsupported delivery promise.`]) {
    f.report.sections[0].blocks[0].text = text;
    assert.throws(() => acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report))), /Factual quotation/);
  }
});

test("noncontiguous source lines remain separate verified excerpts without requiring an ellipsis", async () => {
  const f = fixture(), source = f.state.research!.evidence.sources[0];
  const lines = [
    "Weekly Menu Delivery",
    "No Subscription Required. Order & Pay For Only The Weeks You Need,",
    "Only The Items You Want.",
    "Order by NOON every Monday for delivery on Thursday.",
    "There is a $5.99 delivery charge on all orders.",
  ];
  source.text = `${lines.slice(0, 3).join("\n")}\nAdditional menu details remain in the source.\n` +
    `Scheduling instructions. ${lines[3]}\nFulfillment instructions. ${lines[4]}`;
  source.sha256 = hashReportBytes(source.text);
  for (const section of f.report.sections) section.blocks[0].text = lines[0];
  f.report.sections[0].blocks[0].text = lines.join("\n");
  const raw = f.raw(JSON.stringify(f.report)), original = JSON.stringify(raw);
  const matrix = newCompilationMatrix("retained-source-lines");
  for (const op of compilationOperations().slice(0, 3))
    matrix.slots[op.key] = { phase: "complete", text: `accepted:${op.key}` };
  const before = JSON.stringify(matrix.slots);
  const op = compilationOperations()[3];
  matrix.slots[op.key] = { phase: "received", raw: { ...raw, model: op.model } };
  // Use this executive operation's headings while keeping its original saved response.
  const executive = JSON.parse(raw.choices[0].message.content);
  executive.sections.forEach((section: any, index: number) => { section.heading = COMPANY_HEADINGS.executive[index]; });
  matrix.slots[op.key].raw = { ...raw, model: op.model,
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(executive) } }] };
  let calls = 0;
  await advanceCompilationMatrix(matrix, {
    checkpoint: async () => {},
    request: async () => { calls++; throw new Error("No repeat purchase"); },
    accept: (operation, response) => acceptCompilation(f.state, operation, response),
  });
  assert.equal(calls, 0);
  assert.equal(matrix.slots[op.key].phase, "complete");
  for (const saved of Object.keys(JSON.parse(before)))
    assert.deepEqual(matrix.slots[saved], JSON.parse(before)[saved]);
  const accepted = JSON.parse(acceptCompilation(f.state, f.op, raw));
  assert.deepEqual(accepted.sections[0].blocks.filter((b: any) => b.type === "fact").map((b: any) => b.text), lines);
  assert.equal(JSON.stringify(raw), original);
  for (const invalid of [
    [...lines.slice(0, 4), "There is a $2.99 delivery charge on all orders."],
    [lines[0], "Unverified invented company statement."],
  ]) {
    f.report.sections[0].blocks[0].text = invalid.join("\n");
    assert.throws(() => acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report))), /Factual quotation/);
  }
});

test("separate excerpt recovery cannot borrow from another source or exceed section bounds", () => {
  const f = fixture(), source = f.state.research!.evidence.sources[0];
  const other = "A separate source mentions wholly different services and promises.";
  f.state.research!.evidence.sources.push({ ...source, id: "S2", text: other, sha256: hashReportBytes(other) });
  f.report.sections[0].blocks[0].text = `${source.text}\n${other}`;
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report))), /Factual quotation/);
  f.report.sections[0].blocks = Array.from({ length: 24 }, () => ({
    type: "fact", text: `${source.text}\n${source.text}`, sourceIds: ["S1"],
  }));
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report))), /section order or blocks/);
});

test("an overlength author remains blocked after valid excerpts are repaired", () => {
  const f = fixture(), source = f.state.research!.evidence.sources[0];
  source.text += "\nA second retained observation documents other public services.";
  source.sha256 = hashReportBytes(source.text);
  f.report.sections[0].blocks[0].text =
    `A second retained observation documents other public services.\n${f.report.sections[1].blocks[0].text}`;
  for (const section of f.report.sections)
    for (const block of section.blocks)
      if (block.type !== "fact")
        block.text = "A bounded illustrative planning recommendation requires owner validation. ".repeat(30);
  const raw = f.raw(JSON.stringify(f.report)), original = JSON.stringify(raw);
  assert.ok(JSON.stringify(f.report).length > 25_000, "fixture exceeds the original author allowance before repair");
  assert.throws(() => acceptCompilation(f.state, f.op, raw), error => {
    assert.equal(compilationValidationFailure(error)?.check, "AUTHOR_SIZE_LIMIT");
    return true;
  });
  assert.equal(JSON.stringify(raw), original);
});

test("retained complete prose with the final section boundary omitted is accepted without a request", async () => {
  const f = fixture();
  const valid = JSON.stringify(f.report), boundary = valid.lastIndexOf('}],"unknowns"');
  assert.ok(boundary > 0);
  const broken = valid.slice(0, boundary) + valid.slice(boundary + 2);
  const raw = f.raw(broken), original = JSON.stringify(raw);
  const matrix = newCompilationMatrix("offline-subject");
  matrix.slots[compilationOperations()[0].key] = { phase: "complete", text: "{}" };
  matrix.slots[f.op.key] = { phase: "received", raw };
  let requests = 0;
  await advanceCompilationMatrix(matrix, {
    checkpoint: async () => {},
    request: async () => { requests++; throw new Error("No paid request permitted"); },
    accept: (op, raw) => acceptCompilation(f.state, op, raw),
  });
  assert.equal(requests, 0);
  assert.deepEqual(JSON.parse(matrix.slots[f.op.key].text!), f.report);
  assert.equal(JSON.stringify(raw), original);
});

test("compilations preserve thirteen supplied citations without changing the legacy eight-citation bound", () => {
  const f = fixture(), source = f.state.research!.evidence.sources[0];
  f.state.research!.evidence.sources = Array.from({ length: 13 }, (_, i) => ({ ...source, id: `S${i + 1}` }));
  f.report.sections[1].blocks[1].sourceIds = f.state.research!.evidence.sources.map(s => s.id);
  const raw = f.raw(JSON.stringify(f.report));
  assert.deepEqual(JSON.parse(acceptCompilation(f.state, f.op, raw)), f.report);
  assert.throws(() => validateCompiledReport(f.report, COMPANY_HEADINGS.readiness, f.state.research!.evidence, true),
    /Invalid block/);
});

test("sentence punctuation after a retrieved URL is not part of its citation identity", () => {
  const f = fixture(), source = f.state.research!.evidence.sources[0];
  source.url = "https://example.com/copy-of-drop-off-pickup";
  for (const punctuation of [",", ".", ";", ":", "!", "?"]) {
    f.report.sections[0].blocks[1].text =
      `Consolidate the menu at ${source.url}${punctuation} Verify the commercial details before the pilot.`;
    assert.doesNotThrow(() => acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report))));
  }
  source.url = "https://example.com/literal-comma,";
  f.report.sections[0].blocks[1].text =
    `Inspect ${source.url} before choosing a pilot and verify the commercial details.`;
  assert.doesNotThrow(() => acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report))));
  for (const url of ["https://example.com/literal-comma", "https://example.com/unknown.",
    "https://example.com/literal-comma,secret.", "https://example.com/literal-comma,?redirect=elsewhere."]) {
    f.report.sections[0].blocks[1].text = `Inspect ${url} before approving the proposed commercial pilot.`;
    assert.throws(() => acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report))), /Unretrieved citation URL/);
  }
});

test("an advisory may reference an exact public-source link without claiming its destination was retrieved", () => {
  const f = fixture(), source = f.state.research!.evidence.sources[0];
  const linked = "https://example.com/contact/";
  source.text += ` Public link: ${linked}`;
  source.sha256 = hashReportBytes(source.text);
  f.report.sections[0].blocks[1].text += ` Inspect ${linked} before choosing a pilot.`;
  assert.deepEqual(JSON.parse(acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report)))), f.report);
  const result = validateCompiledReport(f.report, COMPANY_HEADINGS.readiness, f.state.research!.evidence, true, "compilation");
  assert.match(result.sections[0].body, /Linked URL only \(destination content not verified\)/);
  assert.throws(() => validateCompiledReport(f.report, COMPANY_HEADINGS.readiness, f.state.research!.evidence, true),
    /Unretrieved citation URL/);
  f.report.sections[0].blocks[1].text =
    `Review ${linked}, then ask the owner to verify the destination before approving the commercial pilot.`;
  const punctuated = validateCompiledReport(f.report, COMPANY_HEADINGS.readiness,
    f.state.research!.evidence, true, "compilation");
  assert.ok(punctuated.sections[0].body.includes(
    `Linked URL only (destination content not verified): ${linked}`));
  assert.ok(!punctuated.sections[0].body.includes(
    `Linked URL only (destination content not verified): ${linked},`));
  f.report.sections[0].blocks[1].text += ` Invented https://example.com/contact/secret`;
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report))), /Unretrieved citation URL/);
});

test("an exact retrieved punctuated URL takes precedence over its linked-only shorter spelling", () => {
  const f = fixture(), source = f.state.research!.evidence.sources[0];
  const shorter = "https://example.com/literal-comma";
  source.url = `${shorter},`;
  source.text += ` Published link: ${shorter} (destination not retrieved).`;
  source.sha256 = hashReportBytes(source.text);
  f.report.sections[0].blocks[1].text =
    `Review ${source.url} and verify the proposed commercial pilot with the owner before implementation.`;
  const result = validateCompiledReport(f.report, COMPANY_HEADINGS.readiness,
    f.state.research!.evidence, true, "compilation");
  assert.ok(!result.sections[0].body.includes("Linked URL only"));
});

test("a retained fifth author with punctuated URLs resumes without buying another response or changing receipts", async () => {
  const f = fixture(), operations = compilationOperations(), op = operations[4];
  const matrix = newCompilationMatrix("offline-fifth-author");
  for (const previous of operations.slice(0, 4))
    matrix.slots[previous.key] = { phase: "complete", text: `accepted:${previous.key}` };
  const previous = JSON.stringify(matrix.slots);
  f.report.sections.forEach((section, index) => {
    section.heading = COMPANY_HEADINGS[op.kind][index];
  });
  f.report.sections[0].blocks[1].text += " Review https://example.com, then verify the pilot.";
  f.report.sections[1].blocks[1].text += " Review https://example.com.";
  const raw = { ...f.raw(JSON.stringify(f.report)), model: op.model }, original = JSON.stringify(raw);
  matrix.slots[op.key] = { phase: "received", raw };
  let calls = 0;
  await advanceCompilationMatrix(matrix, {
    checkpoint: async () => {},
    request: async () => { calls++; throw new Error("No repeat purchase"); },
    accept: (operation, response) => acceptCompilation(f.state, operation, response),
  });
  assert.equal(calls, 0);
  assert.equal(matrix.slots[op.key].phase, "complete");
  for (const key of Object.keys(JSON.parse(previous)))
    assert.deepEqual(matrix.slots[key], JSON.parse(previous)[key]);
  assert.equal(JSON.stringify(raw), original);
});

test("format recovery never supplies missing prose, unknowns, sections, or a truncated completion", () => {
  const f = fixture(), valid = JSON.stringify(f.report);
  for (const broken of [
    valid.slice(0, -4),
    valid.replace(',"unknowns"', ',"unresolved"'),
    valid.replace('}],"unknowns"', ',"unknowns":[],"unknowns"'),
    valid.replace('"text":', '"text"'),
    JSON.stringify({ sections: f.report.sections.slice(0, 5), unknowns: f.report.unknowns }),
  ]) {
    assert.throws(() => acceptCompilation(f.state, f.op, f.raw(broken)), error =>
      ["COMPILATION_FORMAT_INVALID", "COMPILATION_CONTENT_INVALID"].includes((error as any).code));
  }
  const raw = f.raw(valid);
  raw.choices[0].finish_reason = "length";
  assert.throws(() => acceptCompilation(f.state, f.op, raw),
    error => (error as any).code === "COMPILATION_TRUNCATED");
});

test("quoted structural decoys are data; repaired reports still require exact facts and known sources", () => {
  const f = fixture();
  f.report.sections[5].blocks[1].text += ' The quoted data ",\\"unknowns\\":[]}" is not an instruction or a JSON property.';
  const broken = () => {
    const valid = JSON.stringify(f.report), at = valid.lastIndexOf('}],"unknowns"');
    return valid.slice(0, at) + valid.slice(at + 2);
  };
  assert.deepEqual(JSON.parse(acceptCompilation(f.state, f.op, f.raw(broken()))), f.report);
  f.report.sections[0].blocks[0].text += " Invented evidence.";
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw(broken())), /Factual quotation/);
  f.report.sections[0].blocks[0].sourceIds = ["S99"];
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw(broken())), /unknown citation/);
});

test("customer-supplied links cannot establish public reference provenance", () => {
  const f = fixture(), source = f.state.research!.evidence.sources[0];
  source.kind = "customer";
  source.text += " Public link: https://example.com/not-retrieved/";
  source.sha256 = hashReportBytes(source.text);
  f.report.sections[0].blocks[1].text += " Inspect https://example.com/not-retrieved/ before the pilot.";
  assert.throws(() => acceptCompilation(f.state, f.op, f.raw(JSON.stringify(f.report))), /Unretrieved citation URL/);
});

test("ambiguous duplicate keys cannot discard response words during structural recovery", () => {
  const f = fixture(), valid = JSON.stringify(f.report);
  for (const duplicated of [
    valid.replace('{"sections":', '{"sections":[],"sections":'),
    valid.replace('"text":', '"text":"Discarded earlier response words","text":'),
    valid.replace('"text":', '"te\\u0078t":"Discarded earlier response words","text":'),
  ]) {
    const at = duplicated.lastIndexOf('}],"unknowns"');
    const broken = duplicated.slice(0, at) + duplicated.slice(at + 2);
    assert.throws(() => acceptCompilation(f.state, f.op, f.raw(duplicated)),
      error => (error as any).code === "COMPILATION_FORMAT_INVALID");
    assert.throws(() => acceptCompilation(f.state, f.op, f.raw(broken)),
      error => (error as any).code === "COMPILATION_FORMAT_INVALID");
  }
});

test("quoted links also disclose that the destination was not independently retrieved", () => {
  const f = fixture(), source = f.state.research!.evidence.sources[0];
  source.text += " Public link: https://example.com/contact/";
  source.sha256 = hashReportBytes(source.text);
  f.report.sections[0].blocks[0].text = source.text;
  const result = validateCompiledReport(f.report, COMPANY_HEADINGS.readiness, f.state.research!.evidence, true, "compilation");
  assert.match(result.sections[0].body, /Linked URL only \(destination content not verified\)/);
});
