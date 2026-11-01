import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { publishCompanyCompilation, type CompanyPublicationPorts } from "../../server/lib/company-package-publication";
import { initialPackage } from "../../server/lib/company-report-package-core";
import { newCompilationMatrix, compilationOperations } from "../../server/lib/company-compilation-matrix";
import { COMPANY_HEADINGS, acceptCompilation } from "../../server/lib/company-compilation-content";
import { companyCompilationSubject, type CompanyCompilationState } from "../../server/lib/company-package-v3";
import { reportAudioLinkFromPdf } from "../../server/lib/business-report-audio";
import { hashReportBytes } from "../../server/lib/business-report-evidence";
import { advanceCompanyCompilation } from "../../server/lib/company-package-v3";
import { requestCompanyCompilation } from "../../server/lib/company-compilation-runtime";
import { reservePackageOperation } from "../../server/lib/company-report-production";
import { hasOwnerJuryApiGrant } from "../../server/lib/owner-jury-api-route";
import { PgDialect } from "drizzle-orm/pg-core";
import { spawnSync } from "node:child_process";
import { getFfmpegPath } from "../../server/lib/ffmpeg-paths";
import { validateReportMp3 } from "../../server/lib/business-report-audio-delivery";
import { mergeReportAudioChunks } from "../../server/lib/business-report-audio-merge";
import { approveCompilationReplacement, compilationRecoveryPlan } from "../../server/lib/company-compilation-recovery";
import { guardReportArgonClient } from "../../server/lib/report-argon-route";
import { driveArtifactPropertyValue } from "../../server/lib/drive-artifact-property";
import { publishCompanyTeaserPack } from "../../server/lib/company-package-teaser-publication";
import { PDFDocument } from "pdf-lib";

function fixture(company = "Offline Heating Services", source = "We install and maintain heating and cooling systems.", withPlans = false) {
  const state = initialPackage({ company, website: "https://example.com", notes: "Owner supplied notes" }) as CompanyCompilationState;
  state.research = { complete: true, coverage: { discovered: 1, reviewed: 1, failed: 0, capped: false },
    evidence: { version: 1, capturedAt: "2026-10-20", sources: Array.from({ length: 13 }, (_, i) => {
      const text = source + " Public link: https://example.com/contact/";
      return { id: `S${i + 1}`, text, sha256: hashReportBytes(text),
        title: "Services", url: "https://example.com", kind: "public" as const, retrievedAt: "2026-10-20" };
    }), limitations: [] } };
  state.compilation = newCompilationMatrix(companyCompilationSubject(state));
  for (const op of compilationOperations()) {
    const report = { sections: COMPANY_HEADINGS[op.kind].map(heading => ({ heading, blocks: [
      { type: "fact", text: source, sourceIds: ["S1"] },
      { type: "recommendation", text: "Run a small appointment follow-up pilot. Assign an operations owner, verify consent and current software access, measure response and completed bookings weekly. ".repeat(10) +
        " Inspect https://example.com/contact/ before the pilot.", sourceIds: Array.from({ length: 13 }, (_, i) => `S${i + 1}`) },
      { type: "assumption", text: "Pilot effort is a planning estimate, not a promised financial result. Validate labor cost and service margins before expanding. ".repeat(8), sourceIds: [] },
    ] })), unknowns: ["Internal operating costs are not independently verified."],
    ...(withPlans && op.stage === "synthesis" ? { hypothesisPlans: [{
      hypothesis: "A permission-based appointment follow-up pilot may improve completed bookings.",
      test: "Compare completed bookings per eligible inquiry against the current baseline for two weeks.",
      disproof: "Stop if completed bookings do not improve or complaints increase.",
      evidence: [{ sourceId: "S1", quote: source }], status: "supported",
    }] } : {}) };
    const raw = { model: op.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(report) } }] };
    state.compilation.slots[op.key] = { phase: "complete", raw, text: acceptCompilation(state, op, raw) };
  }
  state.compilation.phase = "complete";
  const chunks = new Map<string, Buffer>(), pdfs = new Map<string, Buffer>();
  let paid = 0, uploads = 0, deliveries = 0;
  const ports: CompanyPublicationPorts = {
    voice: "offline-voice",
    readChunk: async filename => chunks.get(filename) || null,
    saveChunk: async (filename, bytes) => { chunks.set(filename, bytes); },
    synthesize: async () => { paid++; return Buffer.alloc(2000, 1); },
    validate: async bytes => { assert.ok(bytes.length >= 1000); },
    merge: async parts => Buffer.concat(parts),
    upload: async params => {
      uploads++; assert.equal(params.customerDelivery, true); assert.equal(params.share, true);
      assert.ok(params.durableArtifactKey);
      assert.equal(driveArtifactPropertyValue(params.durableArtifactKey!), params.durableArtifactKey,
        "the actual Drive handoff must accept the key before an upload is considered successful");
      return { success: true, fileId: "offlineaudio1234" };
    },
    verifyAccess: async id => ({ verified: id === "offlineaudio1234", reason: "offline permission proof" }),
    deliver: async params => {
      deliveries++; assert.equal(params.sendEmail, false); assert.equal(params.tenantId, 1);
      assert.equal(await reportAudioLinkFromPdf(params.fileData!), "https://drive.google.com/file/d/offlineaudio1234/view");
      return { success: true, linkVerified: true, shareableLink: "https://drive.google.com/file/d/offlinepdf12345/view" };
    },
  };
  const host = {
    live: async () => {}, checkpoint: async () => {},
    storeFile: async (key: string, bytes: Uint8Array) => { pdfs.set(key, Buffer.from(bytes)); return key; },
    packageFile: async (key: string) => pdfs.get(key) || null,
  };
  const job: any = { id: 99, tenantId: 1, payload: { productionVersion: 3, audioBudgetMicros: 5_000_000 } };
  const text = state.compilation.slots[compilationOperations().find(op => op.kind === "readiness" && op.stage === "synthesis")!.key].text!;
  return { state, chunks, pdfs, ports, host, job, text, counts: () => ({ paid, uploads, deliveries }) };
}

test("final PDF contains its exact MP3 URI; restart reuses audio, PDF and delivery receipts", async () => {
  const f = fixture();
  const first = await publishCompanyCompilation(f.job, f.state, "readiness", f.text, f.host, f.ports);
  assert.equal(first.pdfUrl, "https://drive.google.com/file/d/offlinepdf12345/view");
  assert.equal(first.audioUrl, await reportAudioLinkFromPdf(f.pdfs.get("readiness-full")!));
  const counts = f.counts();
  assert.ok(counts.paid > 0);
  assert.equal(f.state.publication?.readiness?.stage, "done");
  assert.equal(f.state.publication?.readiness?.totalChunks, counts.paid);
  const restarted = JSON.parse(JSON.stringify(f.state));
  assert.deepEqual(await publishCompanyCompilation(f.job, restarted, "readiness", f.text, f.host, f.ports), first);
  assert.deepEqual(f.counts(), counts);
});

test("bounded untested evidence plans reach the actual publication narration and reuse receipts on restart", async () => {
  const f = fixture("Offline evidence fixture", undefined, true);
  const spoken: string[] = [];
  const synthesize = f.ports.synthesize;
  f.ports.synthesize = async text => { spoken.push(text); return synthesize(text); };
  const first = await publishCompanyCompilation(f.job, f.state, "readiness", f.text, f.host, f.ports);
  const narration = spoken.join(""); // splitReportNarration preserves boundary spaces.
  assert.match(narration, /Evidence.*Testable Hypotheses/);
  assert.match(narration, /Validation status: Untested/);
  assert.match(narration, /We install and maintain heating and cooling systems/);
  assert.match(narration, /Stop if completed bookings do not improve/);
  assert.doesNotMatch(narration, /Validation status: Supported/);
  assert.ok(f.pdfs.get("readiness-full")!.length > 1000);
  const extracted = spawnSync("pdftotext", ["-", "-"], { input: f.pdfs.get("readiness-full")!,
    encoding: "utf8", timeout: 10_000, maxBuffer: 512_000 });
  assert.equal(extracted.status, 0, extracted.stderr);
  const pdfText = extracted.stdout.replace(/\s+/g, " ");
  assert.match(pdfText, /Evidence & Testable Hypotheses/);
  assert.match(pdfText, /Validation status: Untested/);
  assert.match(pdfText, /Stop if completed bookings do not improve/);
  assert.equal(await reportAudioLinkFromPdf(f.pdfs.get("readiness-full")!), first.audioUrl);
  const counts = f.counts();
  await publishCompanyCompilation(f.job, JSON.parse(JSON.stringify(f.state)), "readiness", f.text, f.host, f.ports);
  assert.deepEqual(f.counts(), counts);
});

test("uncertain paid Fish call is never repeated; persisted chunks survive an upload failure", async () => {
  const f = fixture();
  let requests = 0;
  f.ports.synthesize = async () => { requests++; throw new Error("Ambiguous provider timeout"); };
  await assert.rejects(publishCompanyCompilation(f.job, f.state, "readiness", f.text, f.host, f.ports));
  await assert.rejects(publishCompanyCompilation(f.job, f.state, "readiness", f.text, f.host, f.ports), /uncertain/);
  assert.equal(requests, 1);

  const g = fixture();
  const upload = g.ports.upload;
  g.ports.upload = async () => { throw new Error("Upload unavailable"); };
  await assert.rejects(publishCompanyCompilation(g.job, g.state, "readiness", g.text, g.host, g.ports),
    (error: any) => error.code === "COMPANY_AUDIO_UPLOAD_FAILED");
  assert.equal(g.state.publication?.readiness?.stage, "uploading_audio");
  assert.ok(Object.values(g.state.publication!.readiness!.chunks).every(chunk => chunk.sha));
  const paid = g.counts().paid;
  g.ports.upload = upload;
  await publishCompanyCompilation(g.job, g.state, "readiness", g.text, g.host, g.ports);
  assert.equal(g.counts().paid, paid, "upload recovery never rebuys stored narration");
});

test("no paid adapter can run outside owner scope or without the separate narration allowance", async () => {
  const f = fixture();
  await assert.rejects(publishCompanyCompilation({ ...f.job, tenantId: 2 }, f.state, "readiness", f.text, f.host, f.ports), /authority/);
  await assert.rejects(publishCompanyCompilation({ ...f.job, payload: { productionVersion: 3 } }, f.state, "readiness", f.text, f.host, f.ports), /authority/);
  assert.equal(f.counts().paid, 0);
});

for (const [parallel, company, source] of [
  [false, "Offline Heating Services", "We install and maintain heating and cooling systems."],
  [true, "Offline Heating Services", "We install and maintain heating and cooling systems."],
  [true, "Offline Plumbing Services", "Our licensed team provides scheduled plumbing maintenance and emergency repairs."],
  [true, "Offline Automotive Services", "Our technicians provide vehicle inspections, scheduled maintenance and mechanical repairs."],
] as const) test(`offline ${company} ${parallel ? "parallel reference-contract" : "legacy"} saved-package recovery: actual grants, Argon guard, reservations and decoded audio reach three linked PDF/audio pairs`, async () => {
  const f = fixture(company, source), raw = structuredClone(f.state.compilation!.slots);
  f.state.intake.contactEmail = "saved-only@example.test";
  const audio = spawnSync(getFfmpegPath(), ["-v", "error", "-f", "lavfi", "-i",
    "sine=frequency=440:duration=0.5", "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "pipe:1"]);
  assert.equal(audio.status, 0);
  // Synthetic provider recording, but the actual full decoder and assembler.
  f.ports.synthesize = async () => audio.stdout;
  f.ports.validate = validateReportMp3;
  f.ports.merge = parts => mergeReportAudioChunks(parts);
  f.state.compilation = newCompilationMatrix(companyCompilationSubject(f.state));
  const prior = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  f.job.attempts = 1;
  f.job.payload = { ...f.job.payload, tenantId: 1, modelBudgetMicros: 150_000_000,
    processingWindowStartedAt: new Date().toISOString(), state: f.state };
  const [saved, gemini, truncated] = compilationOperations();
  f.state.compilation!.slots[saved.key] = raw[saved.key];
  f.state.compilation!.slots[gemini.key] = raw[gemini.key];
  const priorRaw = { model: gemini.model, choices: [
    { finish_reason: "length", message: { content: '{"old-incomplete":' } }] };
  const priorReceipt = { raw: priorRaw,
    digest: createHash("sha256").update(JSON.stringify(priorRaw)).digest("hex"),
    snapshot: "a".repeat(64), approvedAt: new Date().toISOString() };
  f.state.compilation!.replacements = { [gemini.key]: priorReceipt };
  const originalTruncated = { model: truncated.model, choices: [
    { finish_reason: "length", message: { content: '{"incomplete":' } }] };
  f.state.compilation!.slots[truncated.key] = { phase: "received", raw: originalTruncated };
  f.state.compilation!.phase = "blocked"; f.state.phase = "blocked";
  f.job.payload.packageSpend = { [`matrix:${saved.key}`]: 500_000, [`matrix:${truncated.key}`]: 500_000,
    [`matrix:${gemini.key}`]: 500_000, [`matrix:${gemini.key}:replacement:${priorReceipt.digest}`]: 500_000 };
  const recoveryJob = { ...f.job, tenant_id: 1, status: "succeeded" };
  const approval = compilationRecoveryPlan(recoveryJob);
  assert.equal(approval.available, true);
  approveCompilationReplacement(recoveryJob, { snapshot: approval.snapshot, replaceTruncatedCompilation: true });
  f.state.phase = "drafting";
  const dialect = new PgDialect(), requests: string[] = [];
  const db: any = { transaction: async (fn: any) => fn(db), execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (q.sql.includes("SELECT payload,status,attempts,lease_until")) return { rows: [{
      payload: f.job.payload, status: "running", attempts: 1, lease_until: new Date(Date.now() + 300_000),
    }] };
    if (q.sql.includes("UPDATE agent_jobs SET payload=jsonb_set")) {
      f.job.payload.packageSpend = JSON.parse(String(q.params.find(p => typeof p === "string" && p.startsWith("{"))));
      return { rows: [] };
    }
    throw new Error("Unexpected budget fixture query");
  } };
  const runtime = {
    reserve: (...args: Parameters<typeof reservePackageOperation>) => reservePackageOperation(
      args[0], args[1], args[2], args[3], args[4], { db }),
    getClientForModel: (async (model: string, tenant: number, options: any) => {
      assert.equal(tenant, 1);
      assert.equal(hasOwnerJuryApiGrant(tenant, options.providerLane, model), true);
      const client = { chat: { completions: { create: async (params: any, requestOptions: any) => {
        const data = JSON.parse(params.messages[1].content), stage = data.independentCompilations ? "synthesis" : "author";
        assert.equal(JSON.stringify(params.messages).includes("saved-only@example.test"), false, "saved contact address never enters model prompts");
        assert.equal(data.independentCompilations?.length ?? 0, stage === "synthesis" ? 3 : 0);
        const key = `${stage}:${data.category}:${model}`;
        const receipt = f.state.compilation!.replacements?.[key];
        const spendKey = receipt ? `matrix:${key}:replacement:${receipt.digest}` : `matrix:${key}`;
        assert.ok(f.job.payload.packageSpend[spendKey], "durable receipt-bound reservation precedes request");
        assert.equal(requestOptions.maxRetries, 0);
        if (options.providerLane === "anthropic-api") assert.equal(params.max_tokens, stage === "synthesis" ? 32768 : 16384);
        else if (options.providerLane === "openrouter") assert.equal(params.max_tokens, 16384, "real guard translates exact output limit");
        else assert.equal(params.max_completion_tokens, 16384);
        requests.push(key);
        if (data.formatVersion !== 2) return raw[key].raw;
        const report = JSON.parse((raw[key].raw as any).choices[0].message.content);
        if (stage === "author") {
          // The actual runtime must accept and forward complete long paragraphs,
          // not merely a toy validator fixture. Source/citation bytes stay exact.
          report.sections[0].blocks[1].text = (report.sections[0].blocks[1].text + " " +
            "Assign an accountable owner and measure the existing customer workflow before expanding. ".repeat(30)).slice(0, 3071);
          report.sections[1].blocks[2].text = (report.sections[1].blocks[2].text + " " +
            "Verify all operational and pricing assumptions before committing resources. ".repeat(30)).slice(0, 3018);
        }
        const reference = data.evidenceCatalog.entries.find((entry: any) => entry.kind === "source");
        assert.ok(reference);
        return { model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
          formatVersion: 2, catalogId: data.evidenceCatalog.catalogId,
          sections: report.sections.map((section: any) => ({ blocks: section.blocks.map((block: any) =>
            block.type === "fact" ? { type: "fact", evidenceRef: reference.id } : block) })),
          unknowns: report.unknowns,
        }) } }] };
      } } } };
      return { actualModelId: model, client: options.providerLane === "openrouter"
        ? guardReportArgonClient(client as any, tenant) : client };
    }) as any,
  };
  const ports = {
    parallel,
    checkpoint: f.host.checkpoint,
    request: (op: any, drafts: string[]) => requestCompanyCompilation(f.job, f.state, op, drafts, f.host.live, runtime),
    accept: (op: any, response: unknown) => acceptCompilation(f.state, op, response),
    publish: (kind: any, text: string) => publishCompanyCompilation(f.job, f.state, kind, text, f.host, f.ports),
    publishTeaser: () => publishCompanyTeaserPack(f.job, f.state, f.host, async request => {
      assert.equal(request.sendEmail, false);
      assert.equal(request.tenantId, 1);
      assert.equal((await PDFDocument.load(request.fileData!)).getPageCount(), 3);
      assert.equal(await reportAudioLinkFromPdf(request.fileData!), null);
      return { success: true, linkVerified: true, shareableLink: "https://drive.google.com/file/d/teaserabcdefgh/view" };
    }),
  };
  try {
    for (let step = 0; step < 16; step++) await advanceCompanyCompilation(f.state, ports);
    assert.equal(f.state.phase, "done");
    assert.equal(requests.length, 10);
    assert.equal(new Set(requests).size, 10);
    assert.equal(requests.includes(saved.key), false, "Completed GPT compilation is not repurchased");
    assert.equal(requests.includes(gemini.key), false, "Completed Gemini replacement is not repurchased");
    assert.deepEqual(f.state.compilation!.replacements![gemini.key], priorReceipt);
    assert.equal(requests.filter(key => key === truncated.key).length, 1);
    assert.deepEqual(f.state.compilation!.replacements![truncated.key].raw, originalTruncated);
    assert.equal(Object.keys(f.job.payload.packageSpend).length, 14, "Four historical reservations plus ten remaining calls");
    assert.equal(f.job.payload.packageSpend[`matrix:${truncated.key}`], 500_000);
    assert.equal(f.state.files.length, 4);
    assert.ok(f.state.files.filter(file => file.category === "full").every(file => file.audioUrl && file.pdfUrl));
    assert.ok(f.state.files.find(file => file.key === "teaser-pack")?.pdfUrl);
    if (parallel) {
      assert.equal(f.state.compilation!.slots[saved.key].outputContract, undefined, "old receipts keep their contract");
      assert.equal(f.state.compilation!.slots[truncated.key].outputContract, 2, "new requests use references");
      assert.equal(JSON.parse(f.state.compilation!.slots[truncated.key].text!).evidenceContract, 2);
    }
    await advanceCompanyCompilation(f.state, ports);
    assert.equal(requests.length, 10);
  } finally {
    if (prior === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
    else process.env.OWNER_JURY_DIRECT_API_ENABLED = prior;
  }
});

test("a synthesis too large for full narration is rejected before any audio can be purchased", () => {
  const f = fixture(), op = compilationOperations().find(o => o.kind === "readiness" && o.stage === "synthesis")!;
  const report = JSON.parse(f.text);
  report.sections.forEach((section: any) => {
    section.blocks = Array.from({ length: 4 }, () => ({ type: "recommendation", text: "Plan a bounded pilot and verify the assumptions. ".repeat(50), sourceIds: [] }));
  });
  const response = { model: op.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(report) } }] };
  assert.throws(() => acceptCompilation(f.state, op, response), /narration allowance/);
  assert.equal(f.counts().paid, 0);
});

test("an unverified Drive recording cannot produce a completed PDF/audio receipt", async () => {
  const f = fixture();
  f.ports.verifyAccess = async () => ({ verified: false, reason: "access denied" });
  await assert.rejects(publishCompanyCompilation(f.job, f.state, "readiness", f.text, f.host, f.ports),
    (error: any) => error.code === "COMPANY_AUDIO_UPLOAD_FAILED");
  assert.equal(f.state.publication?.readiness?.audioUrl, undefined);
  assert.equal(f.counts().deliveries, 0);
});
