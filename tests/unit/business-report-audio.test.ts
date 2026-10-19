import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReportNarration, reportAudioIdentity, splitReportNarration,
  addReportAudioLinkPage } from "../../server/lib/business-report-audio";
import { PDFDocument, PDFName } from "pdf-lib";
import { createHash } from "node:crypto";
import { createReportAudioDependencies, prepareReportAudio, type ReportAudioDependencies, type ReportAudioStore } from "../../server/lib/business-report-audio-delivery";
import { reportAudioLinkFromPdf } from "../../server/lib/business-report-audio";

test("narration preserves the report body, actions and disclaimer but omits source appendices", () => {
  const sections = [
    { heading: "Executive Summary", body: "Company findings and benefits." },
    { heading: "Prioritized Action Plan", body: "Suggested owner: Sales. Pilot measurement: qualified enquiries." },
    { heading: "Sources", body: "S1. https://example.com/ captured on 2026-10-16." },
    { heading: "Disclaimer", body: "Benefits are conditional, never guaranteed." },
  ];
  const text = buildReportNarration("Aldon report", sections);
  for (const section of sections.filter(s => s.heading !== "Sources")) {
    assert.ok(text.includes(section.heading));
    assert.ok(text.includes(section.body));
  }
  assert.ok(!text.includes("https://example.com/"));
  const chunks = splitReportNarration(text.repeat(40));
  assert.equal(chunks.join(""), text.repeat(40));
  assert.ok(chunks.every(chunk => chunk.length <= 6000));
  const fullLength = text.repeat(400);
  assert.ok(fullLength.length > 36000);
  assert.equal(splitReportNarration(fullLength).join(""), fullLength);
  assert.throws(() => splitReportNarration("x".repeat(180001)), /limit/i);
});

test("audio identity binds tenant, report, order and exact transcript", () => {
  const base = { tenantId: 1, kind: "readiness" as const, orderId: "order-a" };
  const key = reportAudioIdentity(base, "Full report");
  assert.equal(key, reportAudioIdentity({ ...base, finalizationLease: { attempt: 99 } } as any, "Full report"),
    "transient executor fields cannot create a new audio purchase identity");
  assert.notEqual(key, reportAudioIdentity({ ...base, tenantId: 2 }, "Full report"));
  assert.notEqual(key, reportAudioIdentity({ ...base, orderId: "order-b" }, "Full report"));
  assert.notEqual(key, reportAudioIdentity({ ...base, kind: "executive" }, "Full report"));
  assert.notEqual(key, reportAudioIdentity(base, "Revised report"));
});

test("PDF listening page contains a real clickable Drive URI and rejects arbitrary URLs", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const url = "https://drive.google.com/file/d/abcdef123456/view";
  const bytes = await addReportAudioLinkPage(await pdf.save(), url);
  const result = await PDFDocument.load(bytes);
  assert.equal(result.getPageCount(), 2);
  const links = result.getPage(0).node.lookup(PDFName.of("Annots"));
  assert.ok(links);
  assert.equal(await reportAudioLinkFromPdf(bytes), url);
  assert.equal(await reportAudioLinkFromPdf(await pdf.save()), null);
  assert.ok(Buffer.from(bytes).length > 0);
  await assert.rejects(() => addReportAudioLinkPage(bytes, "https://evil.example/audio.mp3"), /Drive/i);
});

function fixture() {
  let receipt: any;
  let audio: Buffer;
  const calls = { spoken: [] as string[], uploads: 0, validates: 0 };
  const store: ReportAudioStore = {
    async claim() {
      if (receipt) return { created: false, receipt: { ...receipt } };
      receipt = { phase: "claimed" };
      return { created: true, receipt: { ...receipt } };
    },
    async saveAudio(_key, bytes, sha) { audio = bytes; receipt = { phase: "generated", audioSha256: sha }; },
    async readAudio() { return audio; },
    async beginUpload() {
      assert.equal(receipt.phase, "generated");
      receipt.phase = "uploading";
    },
    async ready(_key, viewUrl) { receipt = { ...receipt, phase: "ready", viewUrl }; },
  };
  const deps: ReportAudioDependencies = {
    store, async assertAllowed() {},
    async merge(parts) { return Buffer.concat(parts); },
    async synthesize(text) { calls.spoken.push(text); return Buffer.alloc(1200, "a"); },
    async validate() { calls.validates++; },
    async upload() { calls.uploads++; return "https://drive.google.com/file/d/abcdef123456/view"; },
  };
  return { deps, calls, getReceipt: () => receipt, setReceipt: (value: any) => { receipt = value; },
    setAudio: (value: Buffer) => { audio = value; } };
}
const scope = { tenantId: 1, kind: "executive" as const, orderId: "test-order" };
const reportSections = [{ heading: "Complete report", body: "Detailed finding and conditional benefit. ".repeat(350) }];

test("complete spoken content is uploaded once; a ready replay spends nothing", async () => {
  const { deps, calls } = fixture();
  const first = await prepareReportAudio(scope, "Report", reportSections, deps);
  assert.equal(calls.spoken.join(""), buildReportNarration("Report", reportSections));
  assert.ok(calls.spoken.length > 1);
  assert.equal(calls.uploads, 1);
  const second = await prepareReportAudio(scope, "Report", reportSections, deps);
  assert.deepEqual(second, first);
  assert.equal(calls.uploads, 1);
  assert.equal(calls.spoken.length, splitReportNarration(buildReportNarration("Report", reportSections)).length);
});

test("provider failure retains its claim and cannot automatically repeat paid synthesis", async () => {
  const { deps, calls, getReceipt } = fixture();
  deps.synthesize = async () => { calls.spoken.push("attempt"); throw new Error("timeout"); };
  await assert.rejects(() => prepareReportAudio(scope, "Report", reportSections, deps), /timeout/);
  assert.equal(getReceipt().phase, "claimed");
  await assert.rejects(() => prepareReportAudio(scope, "Report", reportSections, deps), /uncertain/);
  assert.equal(calls.spoken.length, 1);
  assert.equal(calls.uploads, 0);
});

test("provider success followed by receipt failure is uncertain, never an automatic reupload", async () => {
  const { deps, calls, getReceipt } = fixture();
  deps.store.ready = async () => { throw new Error("database unavailable"); };
  await assert.rejects(() => prepareReportAudio(scope, "Report", reportSections, deps), /database/);
  assert.equal(getReceipt().phase, "uploading");
  await assert.rejects(() => prepareReportAudio(scope, "Report", reportSections, deps), /uncertain/);
  assert.equal(calls.uploads, 1);
});

test("durable generated audio resumes upload without regenerating and detects changed bytes", async () => {
  const f = fixture();
  const audio = Buffer.alloc(1200, "a");
  f.setAudio(audio);
  f.setReceipt({ phase: "generated", audioSha256: createHash("sha256").update(audio).digest("hex") });
  await prepareReportAudio(scope, "Report", reportSections, f.deps);
  assert.equal(f.calls.spoken.length, 0);
  assert.equal(f.calls.uploads, 1);
  f.setReceipt({ phase: "generated", audioSha256: "wrong" });
  await assert.rejects(() => prepareReportAudio(scope, "Report", reportSections, f.deps), /hash mismatch/);
});

test("missing audio, invalid Drive destinations and disabled handoffs cannot complete", async () => {
  const f = fixture();
  f.deps.synthesize = async () => Buffer.alloc(0);
  await assert.rejects(() => prepareReportAudio(scope, "Report", reportSections, f.deps), /incomplete/);
  assert.equal(f.calls.uploads, 0);
  const g = fixture();
  g.deps.upload = async () => "https://example.com/private.mp3";
  await assert.rejects(() => prepareReportAudio(scope, "Report", reportSections, g.deps), /Drive/);
  assert.equal(g.getReceipt().phase, "uploading");
  const h = fixture();
  h.deps.assertAllowed = async () => { throw new Error("stopped"); };
  await assert.rejects(() => prepareReportAudio(scope, "Report", reportSections, h.deps), /stopped/);
  assert.equal(h.getReceipt(), undefined);
});

test("the real provider/storage adapter refuses another tenant before exposing owner resources", async () => {
  await assert.rejects(() => createReportAudioDependencies({ tenantId: 2 }), /authorized owner/i);
});
