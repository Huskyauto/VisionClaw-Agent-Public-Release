import test from "node:test";
import assert from "node:assert/strict";
import { advanceCompanyCompilation, type CompanyCompilationState } from "../../server/lib/company-package-v3";
import { initialPackage } from "../../server/lib/company-report-package-core";

test("one submission completes nine authors, three syntheses and three linked reports without juries or repeat purchases", async () => {
  let state = initialPackage({ company: "Example", website: "https://example.com" }) as CompanyCompilationState;
  state.research = { complete: true, coverage: { discovered: 1, reviewed: 1, failed: 0, capped: false },
    evidence: { version: 1, capturedAt: "2026-10-20", sources: [], limitations: [] } };
  const calls: string[] = [];
  const ports = {
    checkpoint: async () => {},
    request: async (op: any, drafts: string[]) => {
      calls.push(op.key);
      assert.equal(drafts.length, op.stage === "author" ? 0 : 3);
      return { text: `accepted ${op.key}` };
    },
    accept: (_op: any, raw: any) => raw.text,
    publish: async (kind: any, text: string) => {
      assert.ok(text.startsWith("accepted synthesis:"));
      return { key: `${kind}-full`, label: kind, filename: `${kind}.pdf`, category: "full" as const,
        audioUrl: "https://drive.google.com/file/d/abcdefghijk/view", pdfUrl: "https://drive.google.com/file/d/lmnopqrstuv/view" };
    },
    publishTeaser: async () => ({ key: "teaser-pack", label: "Three-page teaser", filename: "free-teaser-pack.pdf",
      category: "teaser" as const, pdfUrl: "https://drive.google.com/file/d/teaserabcdefgh/view" }),
  };
  for (let i = 0; i < 16; i++) await advanceCompanyCompilation(state, ports);
  assert.equal(state.phase, "done");
  assert.equal(calls.length, 12);
  assert.equal(state.files.length, 4);
  assert.equal(state.files.find(f => f.key === "teaser-pack")?.category, "teaser");
  assert.equal(Object.values(state.reports).filter(r => r?.status === "done").length, 3);
  state = JSON.parse(JSON.stringify(state));
  await advanceCompanyCompilation(state, ports);
  assert.equal(calls.length, 12);
});

test("failed teaser delivery cannot complete a package or repeat completed model/audio work on continuation", async () => {
  const state = initialPackage({ company: "Example", website: "https://example.com" }) as CompanyCompilationState;
  state.research = { complete: true, coverage: { discovered: 1, reviewed: 1, failed: 0, capped: false },
    evidence: { version: 1, capturedAt: "2026-10-20", sources: [], limitations: [] } };
  const { companyCompilationSubject } = await import("../../server/lib/company-package-v3");
  const { newCompilationMatrix } = await import("../../server/lib/company-compilation-matrix");
  state.compilation = newCompilationMatrix(companyCompilationSubject(state));
  state.compilation.phase = "complete";
  for (const kind of ["readiness", "executive", "opportunities"] as const) {
    state.reports[kind] = { status: "done" };
    state.files.push({ key: `${kind}-full`, label: kind, filename: `${kind}.pdf`, category: "full",
      audioUrl: "https://drive.google.com/file/d/abcdefghijk/view", pdfUrl: "https://drive.google.com/file/d/lmnopqrstuv/view" });
  }
  let attempts = 0;
  const ports = {
    checkpoint: async () => {},
    request: async () => { assert.fail("completed model call repeated"); },
    accept: () => { assert.fail("completed synthesis repeated"); },
    publish: async () => { assert.fail("completed PDF/audio repeated"); },
    publishTeaser: async () => {
      attempts++;
      return { key: "teaser-pack", label: "Teaser", filename: "teaser.pdf", category: "teaser" as const,
        ...(attempts > 1 ? { pdfUrl: "https://drive.google.com/file/d/teaserabcdefgh/view" } : {}) };
    },
  };
  await assert.rejects(advanceCompanyCompilation(state, ports), /Verified three-page teaser/);
  assert.notEqual(state.phase, "done");
  assert.equal(state.files.length, 3);
  await advanceCompanyCompilation(state, ports);
  assert.equal(state.phase, "done");
  assert.equal(state.files.length, 4);
  await advanceCompanyCompilation(state, ports);
  assert.equal(attempts, 2);
});
