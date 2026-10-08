/**
 * Tools-layer-split S30 — video-editor-domain migrated handlers.
 *
 * The word-level video auto-editing family (3 tools):
 * `video_transcribe_words` + `video_cut_fillers` + `video_burn_captions`.
 * All three are thin wrappers over server/video-editor.ts.
 *
 * `./video-editor` is pulled via call-time dynamic `import(...)` — NOT a
 * top-level static import — so the domain module statically imports only within
 * server/tools/ and cannot recurse into the app graph (acyclicity invariant,
 * plan.md S2). `server/video-editor` does not import the tools facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  videoTranscribeWordsDefinition,
  videoCutFillersDefinition,
  videoBurnCaptionsDefinition,
} from "./definitions";

async function videoTranscribeWordsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { transcribeWords } = await import("../../../video-editor");
  const r = await transcribeWords(params.source);
  if (!r.success) return r;
  return {
    success: true,
    wordCount: r.words?.length || 0,
    durationSeconds: r.durationSeconds,
    language: r.language,
    text: r.text,
    words: r.words,
    guidance: "Pass `words` directly into video_cut_fillers or video_burn_captions.",
  };
}

async function videoCutFillersHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { planFillerCuts, renderEDL, pushToDrive } = await import("../../../video-editor");
  const plan = planFillerCuts(params.words || [], {
    customFillers: params.customFillers,
    cutSilenceLongerThan: params.cutSilenceLongerThan,
  });
  const r = await renderEDL(params.source, plan.keepSegments, { outputName: params.outputName });
  if (!r.success) return r;
  const result: any = {
    success: true,
    filePath: r.filePath,
    durationSeconds: r.durationSeconds,
    sizeBytes: r.sizeBytes,
    cutsApplied: plan.removedWords.length,
    secondsRemoved: Math.round(plan.removedSeconds * 10) / 10,
    secondsKept: Math.round((r.durationSeconds || 0) * 10) / 10,
    segmentsRendered: r.segmentsRendered,
    sampleRemovedWords: plan.removedWords.slice(0, 20).map(w => w.word),
  };
  if (params.uploadToDrive === true && r.filePath) {
    const d = await pushToDrive(r.filePath, params.driveLabel || "Video Editor Output", undefined, ctx.tenantId);
    if (d.error) return { error: `Rendered video is not durable: ${d.error}` };
    if (d.driveUrl) result.driveUrl = d.driveUrl;
    if (d.error) result.driveError = d.error;
  }
  return result;
}

async function videoBurnCaptionsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { burnCaptions, pushToDrive } = await import("../../../video-editor");
  const r = await burnCaptions(params.source, params.words || [], {
    outputName: params.outputName,
    wordsPerChunk: params.wordsPerChunk,
    fontSize: params.fontSize,
    upperCase: params.upperCase,
    position: params.position,
  });
  if (!r.success) return r;
  const result: any = {
    success: true,
    filePath: r.filePath,
    durationSeconds: r.durationSeconds,
    sizeBytes: r.sizeBytes,
    captionChunks: r.segmentsRendered,
  };
  if (params.uploadToDrive === true && r.filePath) {
    const d = await pushToDrive(r.filePath, params.driveLabel || "Video Editor Output", undefined, ctx.tenantId);
    if (d.error) return { error: `Captioned video is not durable: ${d.error}` };
    if (d.driveUrl) result.driveUrl = d.driveUrl;
    if (d.error) result.driveError = d.error;
  }
  return result;
}

/** Registered by ./index.ts at import time. */
export const videoEditorDomainTools: RegisteredTool[] = [
  defineTool(videoTranscribeWordsDefinition, videoTranscribeWordsHandler),
  defineTool(videoCutFillersDefinition, videoCutFillersHandler),
  defineTool(videoBurnCaptionsDefinition, videoBurnCaptionsHandler),
];
