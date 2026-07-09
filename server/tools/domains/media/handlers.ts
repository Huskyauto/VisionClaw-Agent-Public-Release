/**
 * Tools-layer-split S21 — media-domain migrated handlers.
 *
 * Selection: the 6 media/video tools whose legacy switch arms depend ONLY on
 * app-graph modules pulled via call-time dynamic import — `mpeg_produce`,
 * `mpeg_produce_parallel`, `mpeg_concat`, `mpeg_add_audio` (→ ./mpeg-engine),
 * `produce_video` (→ ./build-video-from-brief), `plan_video_production`
 * (→ ./llm-task). `generate_audio` and `create_slideshow_video` STAY LEGACY —
 * their arms use tools.ts module-scope helpers (`db`/`sql`, `logSilentCatch`,
 * the `_ffprobePath` alias), out of scope for a mechanical slice (S5 write_file
 * precedent: their DEFINITIONS still move to definitions.ts, spliced as const
 * references, but the handlers remain in the legacy switch).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, no added gate, error strings verbatim).
 * The ONLY edits:
 *   - the caller-supplied `params._tenantId` read becomes `ctx.tenantId` (the
 *     dispatcher strips + re-stamps it from the trusted context). No gate is
 *     added where the legacy arm had none (plan_video_production,
 *     mpeg_produce/parallel pass tenantId straight through); the ONE fail-closed
 *     guard the legacy `produce_video` arm carried (`typeof tid !== "number" ||
 *     tid <= 0`) is preserved verbatim, now reading `ctx.tenantId`.
 *   - `params._projectDriveFolderId` is read VERBATIM — it is NOT in the
 *     dispatcher's TRUST_SIGNAL_KEYS strip list, so it survives on the stripped
 *     `params` exactly as the legacy arm saw it (a Drive-destination hint, not
 *     an authz signal; S11 documents-domain precedent).
 *
 * External dependencies are pulled via call-time dynamic `import(...)` inside
 * each handler — NOT top-level static imports — so the domain module statically
 * imports only within server/tools/ and cannot recurse back into the app graph
 * (acyclicity invariant, plan.md S2; same seam S8–S20 used). No tools.ts
 * module-scope helpers moved (none owned by the migrated six).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  produceVideoDefinition,
  planVideoProductionDefinition,
  mpegProduceDefinition,
  mpegProduceParallelDefinition,
  mpegConcatDefinition,
  mpegAddAudioDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function mpegProduceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { produceVideo } = await import("../../../mpeg-engine");
  const result = await produceVideo({
    title: params.title || "Untitled Video",
    scenes: params.scenes || [],
    voice: params.voice,
    voiceProvider: params.voiceProvider,
    strictVoice: params.strictVoice === true,
    resolution: params.resolution,
    fps: params.fps,
    transition: params.transition,
    crossfadeMs: params.crossfadeMs,
    kenBurns: params.kenBurns,
    kenBurnsIntensity: params.kenBurnsIntensity,
    backgroundMusicPath: params.backgroundMusicPath,
    musicVolume: params.musicVolume,
    introText: params.introText,
    outroText: params.outroText,
    tenantId: ctx.tenantId,
    projectId: params.projectId,
    uploadToDrive: params.uploadToDrive,
    emailTo: params.emailTo,
    _projectDriveFolderId: params._projectDriveFolderId,
  } as any);
  return result;
}

async function mpegProduceParallelHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { produceVideoParallel } = await import("../../../mpeg-engine");
  const result = await produceVideoParallel({
    title: params.title || "Untitled Video",
    chapters: params.chapters || [],
    maxParallelChapters: params.maxParallelChapters,
    voice: params.voice,
    voiceProvider: params.voiceProvider,
    strictVoice: params.strictVoice === true,
    resolution: params.resolution,
    fps: params.fps,
    transition: params.transition,
    crossfadeMs: params.crossfadeMs,
    kenBurns: params.kenBurns,
    kenBurnsIntensity: params.kenBurnsIntensity,
    backgroundMusicPath: params.backgroundMusicPath,
    musicVolume: params.musicVolume,
    tenantId: ctx.tenantId,
    projectId: params.projectId,
    uploadToDrive: params.uploadToDrive,
    emailTo: params.emailTo,
    _projectDriveFolderId: params._projectDriveFolderId,
  } as any);
  return result;
}

async function mpegConcatHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { concatenateClips } = await import("../../../mpeg-engine");
  return await concatenateClips(
    params.clipPaths || [],
    params.outputName || "concat_video",
    params.transition,
    params.crossfadeMs,
  );
}

async function mpegAddAudioHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { addAudioToVideo } = await import("../../../mpeg-engine");
  return await addAudioToVideo(
    params.videoPath,
    params.audioPath,
    params.outputName,
    params.replaceAudio,
  );
}

async function planVideoProductionHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R98.3 — VIDEO DIRECTOR sub-agent. Decomposes a topic + duration +
  // audience into a fully-structured produce_video payload (per-slide
  // narration written for voice-over + per-slide cinematic image_prompt
  // with art direction + voice + transitions). Returns a `produce_video_args`
  // object the caller can pass straight to produce_video. This is the
  // "thinking layer" that lets Felix produce a high-quality video from a
  // one-liner request without the calling agent having to write narration
  // or image prompts itself.
  try {
    const topic = String(params.topic || "").trim();
    if (!topic) return { success: false, error: "topic is required" };
    const targetSec = Math.max(15, Math.min(600, Number(params.target_duration_seconds) || 60));
    const audience = String(params.audience || "general adult viewers").trim();
    const tone = String(params.tone || "professional and engaging").trim();
    const styleNotes = String(params.style_notes || "").trim();
    const sourceMaterial = String(params.source_material || "").trim();
    const voicePref = String(params.voice_preference || "").trim();
    const cta = String(params.call_to_action || "").trim();

    // Pace planning: ~150 wpm spoken English → ~2.5 words/sec.
    // Aim for ~9-second slides → slide count = round(targetSec / 9), clamped 3-12.
    const targetSlides = Math.max(3, Math.min(12, Math.round(targetSec / 9)));
    const wordsPerSlide = Math.round((targetSec / targetSlides) * 2.5);

    const directorPrompt = `You are a SENIOR VIDEO DIRECTOR + screenwriter producing a cinematic short-form narrated video. Your output is a structured production plan that another tool will execute verbatim. Quality bar: this video will be delivered to a paying customer and must look like a professional brand piece — NOT a flat slideshow with text on a colored card.

REQUEST
- Topic: ${topic}
- Audience: ${audience}
- Tone: ${tone}
- Target length: ${targetSec} seconds (~${targetSlides} slides at ~${wordsPerSlide} words/slide spoken)
${styleNotes ? `- Style notes (apply to EVERY image_prompt): ${styleNotes}\n` : ""}${sourceMaterial ? `- Source material to ground the video in (do not invent facts that contradict it):\n${sourceMaterial.slice(0, 4000)}\n` : ""}${cta ? `- Call to action for the FINAL slide: ${cta}\n` : ""}
RULES
1. Write each slide's "narration" as the FINAL VOICE-OVER TEXT the audience will hear, in second person where natural. NOT planning notes. NOT "I will explain X". Spoken English, contractions OK, ${wordsPerSlide - 5}-${wordsPerSlide + 5} words per slide.
2. Write each slide's "image_prompt" as a vivid cinematic photograph or illustration prompt for an image-generation model. Be specific about subject, setting, lighting, composition, and mood. NEVER include on-screen text or captions in the prompt — narration is spoken, not written. Apply the style notes consistently across all slides so the video feels like one coherent piece.
3. Slide 1 is a hook (grab attention in the first 2 seconds). Slide ${targetSlides} is the payoff${cta ? " + the call to action above" : ""}.
4. Pick the BEST OpenAI TTS voice for this tone+audience: alloy (neutral/balanced), echo (warm male), fable (storyteller male, British-leaning), onyx (deep authoritative male), nova (bright friendly female), shimmer (soft warm female).${voicePref ? ` User requested: "${voicePref}" — honor it unless clearly mismatched.` : ""}
5. Pick a transition_type that matches the tone: "fade" for most, "dissolve" for soft/emotional, "wipeleft" or "slideleft" for upbeat/dynamic, "circleopen" for reveal moments. ken_burns should usually be true for documentary/professional/cinematic feel; false only for flat-illustrated styles.

OUTPUT EXACTLY THIS JSON SHAPE (no extra fields, no commentary):
{
  "plan_summary": "1-2 sentence summary of the creative direction.",
  "title": "Short video title (max 8 words, used in filename).",
  "voice": "alloy|echo|fable|onyx|nova|shimmer",
  "voice_rationale": "1 sentence why this voice fits.",
  "transition_type": "fade|dissolve|wipeleft|wiperight|slideleft|slideright|circleopen|fadeblack",
  "ken_burns": true,
  "slides": [
    { "title": "Optional short headline overlay (or empty string)", "narration": "Final spoken voice-over text for this slide.", "image_prompt": "Detailed cinematic image prompt." }
  ]
}`;

    const { runLlmTask } = await import("../../../llm-task");
    const result = await runLlmTask({
      tenantId: ctx.tenantId,
      prompt: directorPrompt,
      model: "gpt-5.5",
      temperature: 0.7,
      maxTokens: 4096,
      timeoutMs: 90000,
    });

    if (!result.success || !result.json) {
      return { success: false, error: `Director LLM failed: ${result.error || "no plan returned"}` };
    }
    const plan = result.json;
    const slides = Array.isArray(plan.slides) ? plan.slides : [];
    if (slides.length === 0) {
      return { success: false, error: "Director returned 0 slides — try giving more context in the topic field." };
    }

    // Estimate runtime from word count.
    const totalWords = slides.reduce((acc: number, s: any) => acc + String(s.narration || "").split(/\s+/).filter(Boolean).length, 0);
    const estDuration = Math.round((totalWords / 2.5));

    const slideScripts = slides.map((s: any) => ({
      title: s.title || "",
      narration: String(s.narration || "").trim(),
      image_prompt: String(s.image_prompt || "").trim(),
    }));

    const produceArgs: any = {
      title: plan.title || topic.slice(0, 60),
      slide_scripts: slideScripts,
      voice_provider: "fish",
      voice: voicePref || plan.voice || "onyx",
      transition_type: plan.transition_type || "fade",
      ken_burns: plan.ken_burns !== false,
      crossfade_ms: 500,
    };

    return {
      success: true,
      plan_summary: plan.plan_summary || "",
      voice_rationale: plan.voice_rationale || "",
      slide_count: slideScripts.length,
      estimated_duration_sec: estDuration,
      produce_video_args: produceArgs,
      instructions: `R112+ PREFERRED PATH: pass produce_video_args into build_video_from_brief (one-shot pipeline that handles render + finalize + deliver with autoFinalize+autoDeliver+customerEmail in a single call). Example: build_video_from_brief({...produce_video_args, customer_email: "user@example.com", auto_deliver: true}). LEGACY FALLBACK ONLY (do NOT use unless build_video_from_brief is unavailable): produce_video({...produce_video_args, email_to: "user@example.com"}). The watch_url in the result is the link to share.`,
    };
  } catch (err: any) {
    return { success: false, error: `plan_video_production failed: ${err?.message || String(err)}` };
  }
}

async function produceVideoHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R125 — UNIFIED VIDEO PIPELINE. Bob's HARD RULE: every video, regardless
  // of length, must go through the same job-based pipeline so the user gets
  // the same format every time — top progress banner, inline chat card,
  // /jobs history entry, Drive link, and email on finish. Previously short
  // videos (≤4 slides) ran inline through this legacy synchronous path and
  // bypassed the video_jobs row entirely, producing a different UX. We now
  // transparently forward EVERY produce_video call to build_video_from_brief.
  // Inline synchronous rendering below is DEAD CODE retained only as a
  // reference / emergency fallback.
  try {
    const tid = ctx.tenantId;
    if (typeof tid !== "number" || tid <= 0) {
      return { success: false, error: "produce_video requires tenant context (no _tenantId on params)" };
    }

    // Build a brief from whatever the caller gave us. slide_scripts (the
    // recommended path) becomes a chapter-tagged brief so the planner keeps
    // the user's narration intent. Fallback to `script` or `title` so the
    // call never explodes for lack of input.
    const slides: any[] = Array.isArray(params.slide_scripts) ? params.slide_scripts : [];
    const title = typeof params.title === "string" && params.title.trim() ? params.title.trim() : "Video";
    let brief = "";
    if (slides.length > 0) {
      brief = slides.map((s, i) => {
        const narr = typeof s?.narration === "string" ? s.narration.trim() : "";
        const head = typeof s?.title === "string" && s.title.trim() ? ` — ${s.title.trim()}` : "";
        return `Scene ${i + 1}${head}: ${narr || "(no narration provided)"}`;
      }).join("\n");
    } else if (typeof params.script === "string" && params.script.trim()) {
      brief = params.script.trim();
    } else {
      brief = title;
    }

    // Pick a reasonable target length: ~1 min per slide, clamped 1..15.
    const targetMinutes = Math.max(1, Math.min(15, slides.length || 3));

    const { buildVideoFromBrief } = await import("../../../build-video-from-brief");
    const r = await buildVideoFromBrief({
      tenantId: tid,
      brief,
      title,
      targetMinutes,
      voice: typeof params.voice === "string" ? params.voice : undefined,
      voiceProvider: typeof params.voice_provider === "string" ? params.voice_provider : undefined,
      strictVoice: typeof params.strictVoice === "boolean" ? params.strictVoice : (typeof params.strict_voice === "boolean" ? params.strict_voice : undefined),
      bwbBrand: typeof params.bwbBrand === "boolean" ? params.bwbBrand : (typeof params.bwb_brand === "boolean" ? params.bwb_brand : undefined),
      projectId: typeof params.project_id === "number" ? params.project_id : undefined,
      customerEmail: typeof params.email_to === "string" ? params.email_to : undefined,
    });
    return {
      ...r,
      _routed_from: "produce_video",
      instructions: `R125 — produce_video was transparently routed to build_video_from_brief so you get the consistent job-based UX (top banner + /jobs page + auto-delivery email). Tell the user the watch_progress_url and the estimated duration. Do NOT poll check_video_job or call finalize_video — the runner handles concat + Drive upload + email automatically.`,
    };
  } catch (err: any) {
    return { success: false, error: `produce_video (unified routing) failed: ${err?.message || String(err)}` };
  }
}

/** Registered by ./index.ts at import time. */
export const mediaDomainTools: RegisteredTool[] = [
  defineTool(produceVideoDefinition, produceVideoHandler),
  defineTool(planVideoProductionDefinition, planVideoProductionHandler),
  defineTool(mpegProduceDefinition, mpegProduceHandler),
  defineTool(mpegProduceParallelDefinition, mpegProduceParallelHandler),
  defineTool(mpegConcatDefinition, mpegConcatHandler),
  defineTool(mpegAddAudioDefinition, mpegAddAudioHandler),
];
