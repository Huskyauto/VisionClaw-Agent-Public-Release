import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { publishCompanyTeaserPack, teaserRecommendationExcerpt } from "../../server/lib/company-package-teaser-publication";
import { initialPackage } from "../../server/lib/company-report-package-core";
import { companyCompilationSubject, type CompanyCompilationState } from "../../server/lib/company-package-v3";
import { newCompilationMatrix, compilationOperations } from "../../server/lib/company-compilation-matrix";
import { COMPANY_HEADINGS, acceptCompilation } from "../../server/lib/company-compilation-content";
import { hashReportBytes } from "../../server/lib/business-report-evidence";

function fixture() {
  const state = initialPackage({ company: "Offline Heating Services", website: "https://example.com" }) as CompanyCompilationState;
  const text = "We install and maintain heating and cooling systems.";
  state.research = { complete: true, coverage: { discovered: 3, reviewed: 3, failed: 0, capped: false },
    evidence: { version: 1, capturedAt: "2026-10-20", sources: [{ id: "S1", text, sha256: hashReportBytes(text),
      title: "Services", url: "https://example.com", kind: "public", retrievedAt: "2026-10-20" }], limitations: [] } };
  state.compilation = newCompilationMatrix(companyCompilationSubject(state));
  for (const op of compilationOperations().filter(op => op.stage === "synthesis")) {
    const report = { sections: COMPANY_HEADINGS[op.kind].map(heading => ({ heading, blocks: [
      { type: "fact", text, sourceIds: ["S1"] },
      { type: "recommendation", text: "Run a small appointment follow-up pilot. Assign an operations owner, verify consent and current software access, measure response and completed bookings weekly. ".repeat(10), sourceIds: ["S1"] },
      { type: "assumption", text: "Pilot effort is a planning estimate, not a promised financial result. Validate labor cost and service margins before expanding. ".repeat(8), sourceIds: [] },
    ] })), unknowns: ["Internal operating costs are not independently verified."] };
    const raw = { model: op.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(report) } }] };
    state.compilation.slots[op.key] = { phase: "complete", raw, text: acceptCompilation(state, op, raw) };
  }
  state.compilation.phase = "complete";
  const files = new Map<string, Buffer>();
  const host = { live: async () => {}, checkpoint: async () => {},
    packageFile: async (key: string) => files.get(key) ?? null,
    storeFile: async (key: string, data: Uint8Array) => { files.set(key, Buffer.from(data)); return key; } };
  return { state, files, host, job: { id: 123, tenantId: 1, payload: { tenantId: 1, productionVersion: 3 } } as any };
}

test("three-page teaser retains bytes before verified delivery and reuses them on upload retry", async () => {
  const f = fixture();
  let calls = 0, identity = "";
  const deliver = async (request: any) => {
    calls++;
    assert.equal(request.sendEmail, false);
    assert.equal(request.tenantId, 1);
    assert.equal(f.files.get("teaser-pack")?.equals(request.fileData), true);
    assert.equal((await PDFDocument.load(request.fileData)).getPageCount(), 3);
    if (!identity) identity = request.idempotencyKey;
    else assert.equal(request.idempotencyKey, identity);
    return calls === 1 ? { success: false } : { success: true, linkVerified: true,
      shareableLink: "https://drive.google.com/file/d/teaserabcdefgh/view" };
  };
  await assert.rejects(publishCompanyTeaserPack(f.job, f.state, f.host, deliver), /delivery/i);
  const saved = Buffer.from(f.files.get("teaser-pack")!);
  const file = await publishCompanyTeaserPack(f.job, f.state, f.host, deliver);
  assert.equal(file.category, "teaser");
  assert.equal(file.key, "teaser-pack");
  assert.equal(file.audioUrl, undefined);
  assert.equal(f.files.get("teaser-pack")!.equals(saved), true);
  assert.equal(calls, 2);
});

test("teaser rejects wrong owner, changed subject, invalid retained PDF and unverified upload", async () => {
  const f = fixture();
  const failDelivery = async () => { assert.fail("unadmitted delivery"); };
  await assert.rejects(publishCompanyTeaserPack({ ...f.job, tenantId: 2 }, f.state, f.host, failDelivery), /scope/);
  const subject = f.state.compilation!.subject;
  f.state.compilation!.subject = "changed";
  await assert.rejects(publishCompanyTeaserPack(f.job, f.state, f.host, failDelivery), /compilation required/);
  f.state.compilation!.subject = subject;
  const single = await PDFDocument.create();
  single.addPage();
  f.files.set("teaser-pack", Buffer.from(await single.save()));
  await assert.rejects(publishCompanyTeaserPack(f.job, f.state, f.host, failDelivery), /exactly three/);
  f.files.clear();
  await assert.rejects(publishCompanyTeaserPack(f.job, f.state, f.host, async () => ({
    success: true, linkVerified: false, shareableLink: "https://drive.google.com/file/d/teaserabcdefgh/view",
  })), /delivery unverified/);
  await assert.rejects(publishCompanyTeaserPack(f.job, f.state, f.host, async () => ({
    success: true, linkVerified: true, shareableLink: "https://untrusted.example/view",
  })), /Drive delivery identity/);
});

test("customer previews omit numerical projections, spelled-out quantities and promises while preserving usable advice", () => {
  const text = teaserRecommendationExcerpt([
    "At 500 monthly visitors, a five-point conversion lift could produce 25 additional bookings each month.",
    "A five-point conversion lift could produce twenty-five additional bookings each month.",
    "Double your bookings with guaranteed results.",
    "Assign an operations owner and verify consent before a small follow-up pilot.",
  ]);
  assert.equal(text, "Assign an operations owner and verify consent before a small follow-up pilot.");
  assert.throws(() => teaserRecommendationExcerpt(["Guaranteed results with 25 more bookings."]), /Safe recommendation/);
});
