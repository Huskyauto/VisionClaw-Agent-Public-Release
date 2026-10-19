import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getFfmpegPath } from "./ffmpeg-paths";
import { mergeReportAudioChunks } from "./business-report-audio-merge";
import type { BusinessReportReviewInput } from "./business-report-review";
import type { ReportSection } from "./business-report-evidence";
import { assertReportAudioUrl, buildReportNarration,
  reportAudioIdentity, REPORT_AUDIO_MODEL, REPORT_AUDIO_VOICE, REPORT_AUDIO_MAX_CHARACTERS,
  REPORT_AUDIO_MAX_BYTES, splitReportNarration, type ReportAudioScope } from "./business-report-audio";

type Receipt = { phase: "reserved" | "claimed" | "generated" | "uploading" | "ready"; audioSha256?: string; viewUrl?: string };
export interface ReportAudioStore {
  claim(key: string, characters: number): Promise<{ created: boolean; receipt: Receipt }>;
  beginSynthesis?(key: string): Promise<void>;
  reserveBatch?(entries: Array<{ key: string; characters: number }>): Promise<void>;
  saveAudio(key: string, bytes: Buffer, sha: string): Promise<void>;
  readAudio(key: string): Promise<Buffer>;
  beginUpload(key: string): Promise<void>;
  ready(key: string, url: string): Promise<void>;
}
export type ReportAudioDependencies = {
  store: ReportAudioStore;
  synthesize(text: string): Promise<Buffer>;
  merge(parts: readonly Buffer[]): Promise<Buffer>;
  validate(bytes: Buffer): Promise<void>;
  upload(key: string, bytes: Buffer, label?: string): Promise<string>;
  assertAllowed(): Promise<void>;
};
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const audioFileName = (key: string) => `brr-audio-${key.slice(0, 40)}.mp3`;

/** Decode the entire recording, not only its header, before customer upload. */
export async function validateReportMp3(bytes: Buffer): Promise<void> {
  if (bytes.length < 1000 || bytes.length > REPORT_AUDIO_MAX_BYTES) throw new Error("Report MP3 size is outside its bounds");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(getFfmpegPath(), ["-v", "error", "-xerror", "-f", "mp3", "-i", "pipe:0", "-f", "null", "-"],
      { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, bytes.length > 8 * 1024 * 1024 ? 120_000 : 30_000);
    child.stderr.on("data", data => { stderr = (stderr + data).slice(0, 2048); });
    child.stdin.on("error", () => { /* exit/error determines validity; never log audio bytes */ });
    child.on("error", () => { clearTimeout(timer); reject(new Error("Report MP3 decoder unavailable")); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0 || stderr.trim()) reject(new Error("Full report MP3 could not be decoded"));
      else resolve();
    });
    child.stdin.end(bytes);
  });
}

/** No LLM summarization, paid fallback or automatic replay of uncertain work. */
export async function prepareReportAudio(scope: ReportAudioScope, title: string,
  sections: ReportSection[], deps: ReportAudioDependencies): Promise<{ viewUrl: string; transcriptSha256: string }> {
  await deps.assertAllowed();
  const transcript = buildReportNarration(title, sections);
  const chunks = splitReportNarration(transcript);
  const key = reportAudioIdentity(scope, transcript);
  const { receipt, created } = await deps.store.claim(key, transcript.length);
  if (receipt.phase === "ready") {
    assertReportAudioUrl(receipt.viewUrl);
    return { viewUrl: receipt.viewUrl, transcriptSha256: sha256(transcript) };
  }
  const reserved = receipt.phase === "reserved";
  if (reserved) {
    if (!deps.store.beginSynthesis) throw new Error("Reserved narration requires a fenced synthesis claim");
    await deps.store.beginSynthesis(key);
  }
  if (!reserved && !created && receipt.phase !== "generated") {
    throw new Error("Report audio completion is uncertain; owner recovery required, no automatic regeneration or upload");
  }
  let audio: Buffer;
  if (created || reserved) {
    const parts: Buffer[] = [];
    let size = 0;
    for (const chunk of chunks) {
      await deps.assertAllowed();
      const part = await deps.synthesize(chunk);
      size += part.length;
      if (part.length < 1000 || size > REPORT_AUDIO_MAX_BYTES) throw new Error("Report audio generation returned incomplete or oversized audio");
      // Each chunk must independently decode; a complete final segment cannot
      // conceal an earlier failed segment.
      await deps.validate(part);
      parts.push(part);
    }
    await deps.assertAllowed();
    audio = await deps.merge(parts);
    await deps.validate(audio);
    await deps.store.saveAudio(key, audio, sha256(audio));
  } else {
    audio = await deps.store.readAudio(key);
    if (sha256(audio) !== receipt.audioSha256) throw new Error("Retained report audio hash mismatch");
    await deps.validate(audio);
  }
  await deps.assertAllowed();
  await deps.store.beginUpload(key);
  const viewUrl = await deps.upload(key, audio, sections.length === 1 ? `${title} - ${sections[0].heading}` : undefined);
  assertReportAudioUrl(viewUrl);
  await deps.store.ready(key, viewUrl);
  console.log(`[business-report-audio] tenant=${scope.tenantId} kind=${scope.kind} ready`);
  return { viewUrl, transcriptSha256: sha256(transcript) };
}

export async function createReportAudioDependencies(input: Pick<BusinessReportReviewInput,
  "tenantId" | "orderId" | "finalizationLease"> | Pick<BusinessReportReviewInput, "tenantId">): Promise<ReportAudioDependencies> {
  const { assertBusinessReportHandoffsAllowed } = await import("./business-report-review");
  // These credentials belong to the owner. Enforce at adapter creation too,
  // not only at prepareReportAudio's normal entry, before exposing the store.
  await assertBusinessReportHandoffsAllowed(input.tenantId);
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const { uploadToDrive } = await import("../google-drive");
  const tenantId = input.tenantId;
  const rowsOf = (result: any): any[] => result.rows || result;
  const providerKey = process.env.ELEVENLABS_API_KEY;
  if (!providerKey) throw new Error("Report narration ElevenLabs connection unavailable");
  const voiceResponse = await fetch(`https://api.elevenlabs.io/v1/voices/${REPORT_AUDIO_VOICE}`, {
    headers: { "xi-api-key": providerKey }, signal: AbortSignal.timeout(12_000),
  });
  if (!voiceResponse.ok) throw new Error("American narrator metadata could not be verified");
  const voice: any = await voiceResponse.json();
  if (voice.voice_id !== REPORT_AUDIO_VOICE || String(voice.labels?.accent).toLowerCase() !== "american" ||
      voice.labels?.language !== "en") throw new Error("Report narrator must be verified American English");
  const ratesResponse = await fetch("https://api.elevenlabs.io/v1/models", {
    headers: { "xi-api-key": providerKey }, signal: AbortSignal.timeout(12_000),
  });
  if (!ratesResponse.ok) throw new Error("Included narration credit rate could not be verified");
  const models: any = await ratesResponse.json();
  const rate = Array.isArray(models) ? models.find(m => m.model_id === REPORT_AUDIO_MODEL)?.model_rates : null;
  const creditMultiplier = rate?.character_cost_multiplier * rate?.cost_discount_multiplier;
  if (typeof rate?.character_cost_multiplier !== "number" || typeof rate?.cost_discount_multiplier !== "number" ||
      rate.character_cost_multiplier <= 0 || rate.cost_discount_multiplier <= 0 ||
      !Number.isFinite(creditMultiplier) || creditMultiplier <= 0 || creditMultiplier > 10)
    throw new Error("Included narration credit rate is invalid");
  const assertAllowed = async () => {
    await assertBusinessReportHandoffsAllowed(tenantId);
    if ("finalizationLease" in input && input.finalizationLease) {
      const { jobId, attempt } = input.finalizationLease;
      // Narration can span several chunks. Renew only the original, still-live
      // finalizing attempt, and check again before every provider side effect.
      const renewed = rowsOf(await db.execute(sql`UPDATE agent_jobs
        SET lease_until=NOW()+INTERVAL '5 minutes'
        WHERE tenant_id=${tenantId} AND id=${jobId} AND kind='business_report_review'
          AND status='running' AND attempts=${attempt} AND lease_until>NOW()
          AND payload->'state'->>'phase'='finalizing'
          AND payload->'input'->>'orderId'=${"orderId" in input ? input.orderId : ""}
        RETURNING id`));
      if (renewed.length !== 1) throw new Error("Report audio finalization lease lost");
    }
  };
  const claimBatch = (entries: Array<{ key: string; characters: number }>) => db.transaction(async tx => {
      // One account, one lock. Only the owner tenant can reach this adapter;
      // receipt and reservation reads still preserve that tenant boundary.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(17422,0)`);
      if (!entries.length || entries.length > 60 || new Set(entries.map(e => e.key)).size !== entries.length)
        throw new Error("Invalid section reservation batch");
      const results = new Map<string, { created: boolean; receipt: Receipt }>();
      const missing: Array<{ key: string; characters: number; credits: number }> = [];
      for (const { key, characters } of entries) {
        const records = rowsOf(await tx.execute(sql`SELECT payload FROM agent_jobs
          WHERE tenant_id=${tenantId} AND kind='business_report_audio' AND payload->>'key'=${key} FOR UPDATE`));
        if (records.length > 1) throw new Error("Ambiguous report audio receipts");
        if (records.length) { results.set(key, { created: false, receipt: records[0].payload as Receipt }); continue; }
        if (!Number.isSafeInteger(characters) || characters < 1 || characters > REPORT_AUDIO_MAX_CHARACTERS)
          throw new Error("Report narration character reservation exceeds its limit");
        missing.push({ key, characters, credits: Math.ceil(characters * creditMultiplier) });
      }
      if (!missing.length) return results;
      // Capture outstanding commitments before the provider read. A completion
      // during that read must remain covered even if its usage counter lags.
      const pending = rowsOf(await tx.execute(sql`SELECT COALESCE(SUM((payload->>'reservedChars')::int),0)::int AS reserved,
          COUNT(*) FILTER (WHERE NOT (payload ? 'reservedChars') OR jsonb_typeof(payload->'reservedChars') <> 'number')::int AS invalid
        FROM agent_jobs WHERE tenant_id=${tenantId} AND kind='business_report_audio'
          AND payload->>'phase' IS DISTINCT FROM 'ready'`));
      if (Number(pending[0]?.invalid) !== 0 || !Number.isSafeInteger(Number(pending[0]?.reserved)) ||
          Number(pending[0]?.reserved) < 0) throw new Error("Report narration reservation state is invalid");
      const keyValue = process.env.ELEVENLABS_API_KEY;
      if (!keyValue) throw new Error("Report narration ElevenLabs connection unavailable");
      const allowanceResponse = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
        headers: { "xi-api-key": keyValue }, signal: AbortSignal.timeout(12_000),
      });
      if (!allowanceResponse.ok) throw new Error(`Report narration allowance could not be verified (HTTP ${allowanceResponse.status})`);
      const allowance: any = await allowanceResponse.json();
      if (!Number.isSafeInteger(allowance.character_limit) || !Number.isSafeInteger(allowance.character_count) ||
          allowance.character_count < 0 || allowance.character_limit < allowance.character_count) {
        throw new Error("Report narration allowance has an invalid shape");
      }
      // Uncertain claims stay reserved. Conservative double counting is safer
      // than dipping into the account's automatically purchased overage.
      const credits = missing.reduce((sum, entry) => sum + entry.credits, 0);
      if (allowance.character_limit - allowance.character_count - Number(pending[0]?.reserved || 0) < credits + 2000) {
        throw new Error("Report narration included allowance is insufficient; no overage or paid fallback authorized");
      }
      for (const { key, characters, credits } of missing) {
        await tx.execute(sql`INSERT INTO agent_jobs(kind,tenant_id,status,payload,attempts,max_attempts,completed_at)
        VALUES('business_report_audio',${tenantId},'succeeded',
          ${JSON.stringify({ key, phase: "reserved", version: 2, voice: REPORT_AUDIO_VOICE,
            model: REPORT_AUDIO_MODEL, transcriptCharacters: characters, creditMultiplier,
            reservedChars: credits })}::jsonb,0,1,NOW())`);
        results.set(key, { created: true, receipt: { phase: "reserved" } });
      }
      return results;
    });
  const store: ReportAudioStore = {
    claim: async (key, characters) => (await claimBatch([{ key, characters }])).get(key)!,
    reserveBatch: async entries => { await claimBatch(entries); },
    beginSynthesis: async key => {
      const changed = rowsOf(await db.execute(sql`UPDATE agent_jobs SET payload=jsonb_set(payload,'{phase}','"claimed"'::jsonb)
        WHERE tenant_id=${tenantId} AND kind='business_report_audio' AND payload->>'key'=${key}
          AND payload->>'phase'='reserved' RETURNING id`));
      if (changed.length !== 1) throw new Error("Section narration synthesis claim lost; no duplicate synthesis");
    },
    saveAudio: (key, bytes, sha) => db.transaction(async tx => {
      const changed = rowsOf(await tx.execute(sql`UPDATE agent_jobs
        SET payload=payload || ${JSON.stringify({ phase: "generated", audioSha256: sha })}::jsonb
        WHERE tenant_id=${tenantId} AND kind='business_report_audio' AND payload->>'key'=${key}
          AND payload->>'phase'='claimed' RETURNING id`));
      if (changed.length !== 1) throw new Error("Report audio generation claim lost");
      await tx.execute(sql`INSERT INTO file_storage(filename,original_name,mime_type,size,data,tenant_id)
        VALUES(${audioFileName(key)},${audioFileName(key)},'audio/mpeg',${bytes.length},${bytes.toString("base64")},${tenantId})`);
    }),
    readAudio: async key => {
      const records = rowsOf(await db.execute(sql`SELECT data FROM file_storage WHERE tenant_id=${tenantId}
        AND filename=${audioFileName(key)} AND mime_type='audio/mpeg' ORDER BY id DESC LIMIT 2`));
      if (records.length !== 1 || typeof records[0].data !== "string") throw new Error("Retained report MP3 missing or ambiguous");
      return Buffer.from(records[0].data, "base64");
    },
    beginUpload: async key => {
      const changed = rowsOf(await db.execute(sql`UPDATE agent_jobs SET payload=jsonb_set(payload,'{phase}','"uploading"'::jsonb)
        WHERE tenant_id=${tenantId} AND kind='business_report_audio' AND payload->>'key'=${key}
          AND payload->>'phase'='generated' RETURNING id`));
      if (changed.length !== 1) throw new Error("Report audio upload claim lost");
    },
    ready: async (key, viewUrl) => {
      const changed = rowsOf(await db.execute(sql`UPDATE agent_jobs
        SET payload=payload || ${JSON.stringify({ phase: "ready", viewUrl })}::jsonb
        WHERE tenant_id=${tenantId} AND kind='business_report_audio' AND payload->>'key'=${key}
          AND payload->>'phase'='uploading' RETURNING id`));
      if (changed.length !== 1) throw new Error("Report audio upload receipt persistence failed");
    },
  };
  return {
    store,
    assertAllowed,
    synthesize: async text => {
      const key = process.env.ELEVENLABS_API_KEY;
      if (!key) throw new Error("Report narration ElevenLabs connection unavailable");
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${REPORT_AUDIO_VOICE}?output_format=mp3_44100_128`, {
        method: "POST", signal: AbortSignal.timeout(45_000),
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: REPORT_AUDIO_MODEL,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 } }),
      });
      if (!response.ok || !response.body) throw new Error(`Report narration provider unavailable (HTTP ${response.status}); no retry`);
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 8 * 1024 * 1024) throw new Error("Report narration chunk exceeds its byte limit");
          parts.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return Buffer.concat(parts);
    },
    merge: mergeReportAudioChunks,
    validate: validateReportMp3,
    upload: async (key, bytes, label) => {
      const result = await uploadToDrive({
        fileData: bytes, fileName: label ? `${label.replace(/[^\p{L}\p{N} ._-]/gu, " ").slice(0, 160)}.mp3` : audioFileName(key), mimeType: "audio/mpeg",
        customerDelivery: true, share: true, folderLabel: "Report audio",
        durableArtifactKey: `artifact:report-audio:${tenantId}:${key}`,
      });
      if (!result.success || !result.fileId) throw new Error("Report MP3 Drive upload or reader permissions unavailable; owner recovery required");
      // Construct only from the verified uploaded file ID, never provider prose.
      const url = `https://drive.google.com/file/d/${result.fileId}/view`;
      assertReportAudioUrl(url);
      return url;
    },
  };
}

/** Called by both renderers only after the approved report has been assembled. */
export async function completeBusinessReportAudio(input: BusinessReportReviewInput, title: string,
  sections: ReportSection[], pdfPath: string): Promise<{ viewUrl: string; pages: number;
    tracks: import("./business-report-section-links").ReportSectionTrack[] }> {
  const { businessReportArtifactName } = await import("./business-report-artifact");
  const expected = businessReportArtifactName(input, input.sections);
  // Finalizers can receive the approved sections in input.sections; output must
  // remain inside uploads, and never name a caller-supplied arbitrary file.
  if (pdfPath !== path.join("uploads", expected)) throw new Error("Report audio PDF identity mismatch");
  const deps = await createReportAudioDependencies(input);
  const { resolveUploadsChild } = await import("../uploads-path");
  const absolute = resolveUploadsChild(expected);
  const original = await fs.readFile(absolute);
  const recording = await prepareReportAudio(input, title, sections, deps);
  await deps.assertAllowed();
  const { addReportAudioLinkPage } = await import("./business-report-audio");
  const linked = await addReportAudioLinkPage(original, recording.viewUrl);
  await fs.writeFile(absolute, linked);
  const { PDFDocument } = await import("pdf-lib");
  return { viewUrl: recording.viewUrl, tracks: [{ heading: title, ...recording }],
    pages: (await PDFDocument.load(linked)).getPageCount() };
}

export async function reserveReportSectionAudio(scope: ReportAudioScope, title: string,
  sections: ReportSection[], deps: ReportAudioDependencies) {
  const { buildReportSectionNarrations } = await import("./business-report-narration");
  const tracks = buildReportSectionNarrations(title, sections);
  if (deps.store.reserveBatch) {
    await deps.assertAllowed();
    await deps.store.reserveBatch(tracks.map(track => ({
      key: reportAudioIdentity({ ...scope, orderId: `${scope.orderId}:section-v2:${track.index}:${track.heading}` }, track.transcript),
      characters: track.transcript.length,
    })));
  }
  for (const track of tracks) {
    await deps.assertAllowed();
    const trackScope = { ...scope, orderId: `${scope.orderId}:section-v2:${track.index}:${track.heading}` };
    const key = reportAudioIdentity(trackScope, track.transcript);
    const { receipt } = await deps.store.claim(key, track.transcript.length);
    if (!["reserved", "generated", "ready"].includes(receipt.phase))
      throw new Error("A section audio attempt is uncertain; no duplicate synthesis");
  }
  return tracks;
}

export async function prepareReportSectionAudio(scope: ReportAudioScope, title: string,
  sections: ReportSection[], deps: ReportAudioDependencies) {
  const tracks = await reserveReportSectionAudio(scope, title, sections, deps);
  const results: import("./business-report-section-links").ReportSectionTrack[] = [];
  for (const track of tracks) {
    const trackScope = { ...scope, orderId: `${scope.orderId}:section-v2:${track.index}:${track.heading}` };
    const result = await prepareReportAudio(trackScope, title, [sections[track.index]], deps);
    if (result.transcriptSha256 !== sha256(track.transcript)) throw new Error("Clean section transcript identity changed");
    results.push({ heading: track.heading, ...result });
  }
  return results;
}
