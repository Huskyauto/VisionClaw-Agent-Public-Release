import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import type { AgentJob } from "../job-queue";
import type { PackageKind, PackageFile } from "./company-report-package-core";
import type { CompanyCompilationState } from "./company-package-v3";
import { COMPANY_HEADINGS, COMPANY_REPORT_TITLES, COMPANY_REPORT_NARRATION_LIMIT, companyNarrationTitle, publicationCompilationEvidence } from "./company-compilation-content";
import { validateCompiledReport, reportEvidenceAppendices, type ReportSection } from "./business-report-evidence";
import { addReportAudioLinkPage, assertReportAudioUrl, buildReportNarration,
  reportAudioLinkFromPdf, splitReportNarration } from "./business-report-audio";
import { validateReportMp3 } from "./business-report-audio-delivery";
import { mergeReportAudioChunks } from "./business-report-audio-merge";
import { synthesizeFishAudio } from "./fish-audio-tts";
import { uploadToDrive, verifyDriveFilePublicAccess } from "../google-drive";
import { renderCompanyReport } from "./company-report-render";
import { COMPANY_REPORT_PACKAGE_FILE_PREFIX } from "./private-business-pilot-files";
import { driveArtifactPropertyValue } from "./drive-artifact-property";

const rows = (r: any) => r.rows || r;
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const audioName = (id: number, key: string) => `${COMPANY_REPORT_PACKAGE_FILE_PREFIX}${id}-fish-${key}.mp3`;
async function publicationStep<T>(code: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (cause) { throw Object.assign(new Error("Company report publication step failed", { cause }), { code }); }
}
export type CompanyPublicationPorts = {
  voice: string;
  readChunk(filename: string): Promise<Buffer | null>;
  saveChunk(filename: string, bytes: Buffer): Promise<void>;
  synthesize(text: string): Promise<Buffer>;
  validate(bytes: Buffer): Promise<void>;
  merge(parts: Buffer[]): Promise<Buffer>;
  upload: typeof uploadToDrive;
  verifyAccess(fileId: string): Promise<{ verified: boolean; reason: string }>;
  deliver(params: Parameters<typeof import("../delivery-pipeline").deliverDigitalProduct>[0]):
    Promise<{ success: boolean; linkVerified?: boolean; shareableLink?: string }>;
};
function productionPublicationPorts(job: AgentJob): CompanyPublicationPorts {
  if (!process.env.FISH_AUDIO_API_KEY || !process.env.FISH_VOICE_ONYX) throw new Error("Fish narration setup unavailable");
  return {
    voice: process.env.FISH_VOICE_ONYX,
    readChunk: async filename => {
      const found = rows(await db.execute(sql`SELECT data FROM file_storage WHERE tenant_id=${job.tenantId}
        AND filename=${filename} AND mime_type='audio/mpeg' ORDER BY id DESC LIMIT 2`));
      if (found.length > 1) throw new Error("Ambiguous retained Fish chunk");
      return found.length ? Buffer.from(found[0].data, "base64") : null;
    },
    saveChunk: async (filename, bytes) => {
      await db.execute(sql`INSERT INTO file_storage(filename,original_name,mime_type,size,data,tenant_id)
        VALUES(${filename},${filename},'audio/mpeg',${bytes.length},${bytes.toString("base64")},${job.tenantId})`);
    },
    synthesize: async text => (await synthesizeFishAudio(text, { model: "s2-pro", voice: "onyx",
      strictVoice: true, format: "mp3", bitrate: 128, timeoutMs: 120_000 })).buffer,
    validate: validateReportMp3, merge: parts => mergeReportAudioChunks(parts), upload: uploadToDrive,
    verifyAccess: verifyDriveFilePublicAccess,
    deliver: async params => (await import("../delivery-pipeline")).deliverDigitalProduct(params),
  };
}

/** All chunks are retained separately. A crash never repurchases an ambiguous
 * chunk. Upload recovery uses the existing exact durable Drive identity. */
export async function publishCompanyCompilation(job: AgentJob, state: CompanyCompilationState,
  kind: PackageKind, text: string, host: {
    live(): Promise<void>; checkpoint(): Promise<void>;
    storeFile(key: string, bytes: Uint8Array): Promise<string | undefined>;
    packageFile(key: string): Promise<Buffer | null>;
  }, dependencies?: CompanyPublicationPorts): Promise<PackageFile> {
  if (job.tenantId !== 1 || job.payload.productionVersion !== 3 || job.payload.audioBudgetMicros !== 5_000_000)
    throw new Error("Package narration authority missing");
  await host.live();
  const deps = dependencies ?? productionPublicationPorts(job);
  const report = JSON.parse(text);
  const evidence = publicationCompilationEvidence(state, report);
  const validated = validateCompiledReport(report, COMPANY_HEADINGS[kind], evidence, true, "compilation");
  const title = companyNarrationTitle(kind, state.intake.company);
  const narrations = (["readiness", "executive", "opportunities"] as const).map(k => {
    const slot = Object.entries(state.compilation!.slots).find(([key]) => key.startsWith(`synthesis:${k}:`))?.[1];
    if (!slot?.text) throw new Error("All three syntheses are required before audio admission");
    return buildReportNarration(companyNarrationTitle(k, state.intake.company),
      validateCompiledReport(JSON.parse(slot.text), COMPANY_HEADINGS[k],
        publicationCompilationEvidence(state, JSON.parse(slot.text)), true, "compilation").sections);
  });
  // The separate $5 allowance admits at most 150k characters for the package.
  // No overage, other provider, automatic retry or fallback is permitted.
  if (narrations.some(s => s.length > COMPANY_REPORT_NARRATION_LIMIT) ||
      narrations.reduce((n, s) => n + s.length, 0) > 150_000)
    throw new Error("Full package narration exceeds its approved character allowance");
  const transcript = buildReportNarration(title, validated.sections);
  const voice = deps.voice;
  const identity = hash(JSON.stringify({ subject: state.compilation!.subject, kind, transcript,
    provider: "fish", model: "s2-pro", voice, version: 1 }));
  // Validate the real downstream contract BEFORE any narration purchase. The
  // audio identity stays unchanged, so previously purchased chunks are reused.
  const durableArtifactKey = `artifact:company-v3-audio:${identity}`;
  driveArtifactPropertyValue(durableArtifactKey);
  state.publication ??= {};
  const receipt = state.publication[kind] ??= { chunks: {} };
  if (receipt.identity && receipt.identity !== identity) throw new Error("Narration identity changed; retained audio requires reconciliation");
  receipt.identity = identity;
  const narrationChunks = splitReportNarration(transcript);
  receipt.totalChunks = narrationChunks.length;
  await host.checkpoint();
  if (!receipt.audioUrl) {
    receipt.stage = "narrating";
    const parts: Buffer[] = [];
    for (const [index, chunk] of narrationChunks.entries()) {
      const key = hash(`${identity}:${index}:${chunk}`), filename = audioName(job.id, key);
      await host.live();
      const retained = await deps.readChunk(filename);
      let bytes: Buffer;
      if (retained) bytes = retained;
      else {
        if (receipt.chunks[key]) throw new Error("Fish chunk completion uncertain; no automatic paid retry");
        receipt.chunks[key] = { claimed: true };
        await host.checkpoint();
        await host.live();
        bytes = await deps.synthesize(chunk);
        if (bytes.length < 1000 || bytes.length > 12 * 1024 * 1024) throw new Error("Fish chunk bytes outside bounds");
        // Commit purchased bytes before any decoder or local assembly step.
        await host.live();
        await deps.saveChunk(filename, bytes);
      }
      if (receipt.chunks[key]?.sha && receipt.chunks[key].sha !== hash(bytes)) throw new Error("Retained Fish chunk hash mismatch");
      await deps.validate(bytes);
      receipt.chunks[key] = { claimed: true, sha: hash(bytes) };
      await host.checkpoint();
      parts.push(bytes);
    }
    receipt.stage = "assembling";
    await host.checkpoint();
    const audio = await publicationStep("COMPANY_AUDIO_ASSEMBLY_FAILED", async () => {
      const joined = await deps.merge(parts);
      await deps.validate(joined);
      return joined;
    });
    await host.live();
    receipt.stage = "uploading_audio";
    await host.checkpoint();
    const uploaded = await publicationStep("COMPANY_AUDIO_UPLOAD_FAILED", () => deps.upload({ fileData: audio,
      fileName: `Company-${job.id}-${kind}-full.mp3`, mimeType: "audio/mpeg",
      customerDelivery: true, share: true, folderLabel: "Report audio", durableArtifactKey }));
    await publicationStep("COMPANY_AUDIO_UPLOAD_FAILED", async () => {
      if (!uploaded.success || !uploaded.fileId || !(await deps.verifyAccess(uploaded.fileId)).verified)
        throw new Error("Verified Fish MP3 delivery incomplete; chunks retained");
    });
    receipt.audioUrl = `https://drive.google.com/file/d/${uploaded.fileId}/view`;
    assertReportAudioUrl(receipt.audioUrl);
    await host.checkpoint();
  }
  assertReportAudioUrl(receipt.audioUrl);
  const key = `${kind}-full`;
  let pdf = await host.packageFile(key);
  if (!pdf) {
    receipt.stage = "rendering_pdf";
    await host.checkpoint();
    const appendices: ReportSection[] = reportEvidenceAppendices(state.research!.evidence,
      [...validated.compiled.unknowns, ...evidence.limitations], {
        digest: state.compilation!.subject, round: 0, juryVerdict: "not used", museRequestId: "not used",
      }, true);
    appendices.push({ heading: "Compilation Method", body:
      "Three independent author models each prepared all three report categories. A fourth, distinct model synthesized the three versions of each category. No jury voting or extra model-review rounds were used. Deterministic checks require factual excerpts and citations to match retained evidence; this is not independent verification of company statements." });
    pdf = Buffer.from(await publicationStep("COMPANY_PDF_RENDER_FAILED", async () => addReportAudioLinkPage(
      await renderCompanyReport(state.intake.company, COMPANY_REPORT_TITLES[kind], [...validated.sections, ...appendices]),
      receipt.audioUrl!, "Fish Onyx")));
    await host.storeFile(key, pdf);
  }
  if (await reportAudioLinkFromPdf(pdf) !== receipt.audioUrl) throw new Error("PDF/audio identity verification failed");
  if (!receipt.pdfUrl) {
    await host.live();
    receipt.stage = "delivering_pdf";
    await host.checkpoint();
    const delivery = await publicationStep("COMPANY_PDF_DELIVERY_FAILED", () => deps.deliver({ tenantId: job.tenantId!,
      customerName: state.intake.company, productName: `${state.intake.company} - ${COMPANY_REPORT_TITLES[kind]}`,
      fileData: pdf!, fileName: `Company-${job.id}-${kind}.pdf`, mimeType: "application/pdf", sendEmail: false,
      idempotencyKey: `company-v3-pdf:${identity}:${hash(pdf!)}` }));
    if (!delivery.success || !delivery.linkVerified || !delivery.shareableLink)
      throw Object.assign(new Error("PDF delivery unverified; report retained"), { code: "COMPANY_PDF_DELIVERY_FAILED" });
    receipt.pdfUrl = delivery.shareableLink;
    await host.checkpoint();
  }
  receipt.stage = "done";
  await host.checkpoint();
  return { key, label: COMPANY_REPORT_TITLES[kind], filename: `${kind}-full.pdf`, category: "full",
    audioUrl: receipt.audioUrl, pdfUrl: receipt.pdfUrl };
}
