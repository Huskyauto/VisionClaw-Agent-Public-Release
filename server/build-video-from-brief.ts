// R112 — Brief-Driven Video Deliverable.
//
// The "AI-Tinkers pattern" applied to video. Felix used to manually orchestrate
// 6 steps (director → produce_video|start_video_job|mpeg_produce_parallel →
// poll → finalize → deliver). Six decision points = six failure modes; the
// chronic one being "Felix narrates the render without ever calling the tool."
//
// This module collapses all six into ONE tool call (`build_video_from_brief`)
// modeled exactly on `build_presentation_distributed` (server/distributed-slides.ts):
//   1. Plan chapters+scenes from the brief via runLlmTask (single JSON call).
//   2. Hand the plan to startVideoJob with autoFinalize+autoDeliver flags
//      tucked into spec — the existing R111 background runner now owns
//      render → concat → upload → delivery without Felix touching it.
//   3. Return {job_id, watch_progress_url, total_chapters, total_scenes}
//      immediately so the chat turn closes cleanly and the user can watch
//      progress on /jobs.
//
// The persistent /jobs surface (R111) was already correct — it stayed empty
// only because Felix never invoked start_video_job. This tool guarantees the
// invocation, so the surface always populates.

import { runLlmTask } from "./llm-task";
import { startVideoJob, type StartVideoJobInput } from "./video-job-runner";
import type { ChapterSpec, MpegScene } from "./mpeg-engine";

export interface BuildVideoFromBriefInput {
  brief: string;
  tenantId: number;
  title?: string;
  targetMinutes?: number;       // default 5
  voice?: string;               // default "onyx"
  voiceProvider?: string;       // default "fish" (R110.6)
  resolution?: string;          // default "1920x1080"
  customerName?: string;        // for deliverDigitalProduct
  customerEmail?: string;       // emailTo
  uploadToDrive?: boolean;      // default true
  projectId?: number;
  bwbBrand?: boolean;           // default false; if true, applies BWB rules in plan prompt
  userImagePath?: string;       // R112.2 — local path to a user-supplied photo (already downloaded from Drive/etc by the persona). When set, scene 1's AI image is REPLACED with this file; remaining scenes still AI-generate. The narration for scene 1 is steered to introduce the person on screen.
  userImageDriveFileId?: string; // R112.3 — Google Drive file ID. Tool downloads it server-side via existing Drive integration, then uses it as the hero photo. Avoids dev/prod filesystem split — works the same in both. Takes precedence over userImagePath if both are set.
}

export interface BuildVideoFromBriefResult {
  success: boolean;
  job_id?: string;
  status?: string;
  total_chapters?: number;
  total_scenes?: number;
  watch_progress_url?: string;
  plan_summary?: string;
  estimated_duration_sec?: number;
  message: string;
  error?: string;
  _instruction?: string;
}

interface PlannedScene {
  imagePrompt: string;
  narration: string;
}
interface PlannedChapter {
  chapterTitle: string;
  scenes: PlannedScene[];
}
interface VideoPlan {
  videoTitle: string;
  chapters: PlannedChapter[];
}

const SCENES_PER_CHAPTER_TARGET = 3;
const WORDS_PER_MIN = 150;        // conversational TTS pace
// R112.4 — was 12s/scene → 5min video plan = 25 scenes / 6-chapter cap = 5
// scenes per chapter, which routinely overshot the 300s per-chapter render
// budget (5 sequential image bakes alone ~120s before TTS or ffmpeg).
// Bumped to 20s narration per scene (~50 words) so a 5-min video plans as
// 15 scenes / 3-per-chapter — fits comfortably in the per-chapter timeout
// AND reads less like rapid-fire slideshow cuts.
const SCENE_LEN_SEC = 20;         // narration target per scene (~50 words)

function estimateScenesNeeded(targetMinutes: number): { totalScenes: number; chapters: number; scenesPerChapter: number } {
  const totalSec = Math.max(60, targetMinutes * 60);
  const totalScenes = Math.max(3, Math.round(totalSec / SCENE_LEN_SEC));
  const chapters = Math.max(1, Math.min(6, Math.ceil(totalScenes / SCENES_PER_CHAPTER_TARGET)));
  const scenesPerChapter = Math.ceil(totalScenes / chapters);
  return { totalScenes: chapters * scenesPerChapter, chapters, scenesPerChapter };
}

const NARRATION_RULES = `NARRATION RULES (R98.5 — REJECTED otherwise):
- Write FINAL spoken-aloud script the audience hears, NOT planning prose.
- 1-3 sentences per scene, ~25-35 words. Second person ("you").
- BANNED phrases: "I'll explain", "first I'll cover", "in this video", "today I'll", "let me tell you about how I", "we'll explore", "we'll look at".
- Every scene MUST have non-empty narration (>30% empty rejects the render).`;

const IMAGE_RULES = `IMAGE PROMPT RULES:
- Cinematic, vivid, single-scene description. 15-30 words.
- Specify subject, mood, lighting, color palette, camera angle.
- NO text overlays in the image (text is added in the video layer).
- Avoid "split screen", "infographic", "diagram" unless explicitly needed.`;

const BWB_RULES = `BUILT WITH BOB BRAND RULES (HARD GATES — render fails if violated):
- NEVER speak URLs in narration ("visit X dot com" forbidden — use on-screen text instead).
- "wellness-program" spelling exact (not "Manjaro" / "Manjurio").
- Weight numbers: "234 lbs lost" / "268 lbs current" (as of 2026-05-10).
- 1920x1080 16:9, voice "onyx", no per-video script files.`;

export async function buildVideoFromBrief(input: BuildVideoFromBriefInput): Promise<BuildVideoFromBriefResult> {
  if (!input?.brief || !input.brief.trim()) {
    return { success: false, message: "brief is required (a short description of the video you want)", error: "missing_brief" };
  }
  if (typeof input.tenantId !== "number" || input.tenantId <= 0) {
    return { success: false, message: "tenantId required", error: "missing_tenant" };
  }

  const targetMinutes = Math.max(1, Math.min(15, input.targetMinutes || 5));
  const shape = estimateScenesNeeded(targetMinutes);
  const brandBlock = input.bwbBrand ? `\n\n${BWB_RULES}\n` : "";

  // R112.2 — if persona provided a user photo path, validate it exists on
  // disk before kicking off the render. Better to fail loud here than to
  // silently fall back to AI image gen and ship a "generic slideshow" again.
  // R112.3 — also accept a Drive file ID; download it server-side here so
  // dev and prod containers behave identically (no shared filesystem).
  let validatedUserImage: string | undefined;
  const fsmod = await import("fs");
  const pathmod = await import("path");
  if (input.userImageDriveFileId && input.userImageDriveFileId.trim()) {
    try {
      const { downloadFromDrive } = await import("./google-drive");
      const fileId = input.userImageDriveFileId.trim();
      const safeId = fileId.replace(/[^A-Za-z0-9_-]/g, "");
      const savePath = `uploads/hero-${safeId}`;
      const dl = await downloadFromDrive({ fileId, savePath });
      if (!dl.success || !dl.path) {
        return { success: false, message: `Failed to download Drive file ${fileId}: ${dl.error || "unknown error"}. Check the file ID and that the Drive integration has access.`, error: "drive_download_failed" };
      }
      validatedUserImage = pathmod.resolve(process.cwd(), dl.path);
    } catch (e: any) {
      return { success: false, message: `Drive download threw: ${e?.message || String(e)}`, error: "drive_download_threw" };
    }
  } else if (input.userImagePath && input.userImagePath.trim()) {
    const candidate = pathmod.resolve(input.userImagePath.trim());
    if (!fsmod.existsSync(candidate)) {
      return { success: false, message: `userImagePath does not exist on disk: ${candidate}. Pass userImageDriveFileId instead so the tool downloads the photo itself (works on prod), or upload via the chat attachment first.`, error: "user_image_missing" };
    }
    validatedUserImage = candidate;
  }
  const heroBlock = validatedUserImage ? `\n\nHERO IMAGE: Scene 1 will use a REAL PHOTO of the narrator (already on disk — do not generate an image prompt for scene 1). Write scene 1's narration to introduce the person on screen by name and hook the viewer (e.g. "This is Bob. Two and a half years ago he weighed 504 pounds…"). All other scenes get AI-generated cinematic images per the IMAGE PROMPT RULES below.\n` : "";

  console.log(`[build-video-from-brief] Planning: brief="${input.brief.slice(0, 80)}..." target=${targetMinutes}min → ${shape.chapters} chapters × ${shape.scenesPerChapter} scenes${validatedUserImage ? ` (hero image: ${validatedUserImage})` : ""}`);

  const planResult = await runLlmTask({
    prompt: `You are a video director. Plan a ${targetMinutes}-minute narrated video from the brief below.

Structure the video into EXACTLY ${shape.chapters} chapters of EXACTLY ${shape.scenesPerChapter} scenes each (${shape.totalScenes} scenes total). Every scene needs (a) a cinematic imagePrompt and (b) FINAL spoken narration.

${NARRATION_RULES}

${IMAGE_RULES}${brandBlock}${heroBlock}

Return STRICT JSON (no markdown):
{
  "videoTitle": "short descriptive title, max 80 chars",
  "chapters": [
    {
      "chapterTitle": "chapter name",
      "scenes": [
        { "imagePrompt": "...", "narration": "..." }
      ]
    }
  ]
}`,
    input: { brief: input.brief, target_minutes: targetMinutes, chapters: shape.chapters, scenes_per_chapter: shape.scenesPerChapter },
    model: "gemini-2.5-flash",
    thinking: "medium",
    maxTokens: 8192,
    timeoutMs: 60000,
    tenantId: input.tenantId,
  });

  if (!planResult.success || !planResult.json?.chapters) {
    return { success: false, message: `Planning failed: ${planResult.error || "no chapters returned"}`, error: "plan_failed" };
  }

  const plan = planResult.json as VideoPlan;
  if (!Array.isArray(plan.chapters) || plan.chapters.length === 0) {
    return { success: false, message: "Planner returned no chapters", error: "plan_empty" };
  }

  // Normalize + validate. We do NOT trust the planner blindly — every scene
  // must have non-empty imagePrompt + narration, otherwise the produce_video
  // R98.5 validator will fail the render.
  const chaptersForRunner: ChapterSpec[] = [];
  let totalScenes = 0;
  let totalNarrationWords = 0;
  let isFirstScene = true;
  for (const ch of plan.chapters) {
    if (!ch?.chapterTitle || !Array.isArray(ch.scenes) || ch.scenes.length === 0) {
      return { success: false, message: `Planner returned malformed chapter: ${JSON.stringify(ch).slice(0, 120)}`, error: "plan_malformed" };
    }
    const scenes: MpegScene[] = [];
    for (const s of ch.scenes) {
      const narration = (s?.narration || "").trim();
      const imagePrompt = (s?.imagePrompt || "").trim();
      if (!narration) {
        return { success: false, message: `Planner produced empty narration in chapter "${ch.chapterTitle}"`, error: "plan_empty_scene" };
      }
      // R112.2 — first scene gets the user's hero photo if provided. Subsequent
      // scenes still need a non-empty imagePrompt (AI generates the visual).
      if (isFirstScene && validatedUserImage) {
        scenes.push({ narration, imagePath: validatedUserImage } as MpegScene);
      } else {
        if (!imagePrompt) {
          return { success: false, message: `Planner produced empty imagePrompt in chapter "${ch.chapterTitle}"`, error: "plan_empty_scene" };
        }
        scenes.push({ narration, imagePrompt } as MpegScene);
      }
      isFirstScene = false;
      totalScenes++;
      totalNarrationWords += narration.split(/\s+/).filter(Boolean).length;
    }
    chaptersForRunner.push({ chapterTitle: ch.chapterTitle.slice(0, 200), scenes });
  }
  const estimatedDurationSec = Math.round((totalNarrationWords / WORDS_PER_MIN) * 60);

  const title = (input.title || plan.videoTitle || input.brief.slice(0, 60)).slice(0, 200);
  const startInput: StartVideoJobInput = {
    tenantId: input.tenantId,
    title,
    chapters: chaptersForRunner,
    voice: input.voice || "onyx",
    // R112.14: default to Fish TTS. FISH_VOICE_ONYX is now set to Bob's chosen
    // reference id (32-hex Fish model id) so every chapter gets the same
    // narrator. R112.11 had flipped this to "openai" while the env var was
    // unset (random voice per chapter); now resolved.
    voiceProvider: input.voiceProvider || "fish",
    resolution: input.resolution || "1920x1080",
    fps: 30,
    transition: "none",
    crossfadeMs: 0,
    kenBurns: true,
    uploadToDrive: input.uploadToDrive !== false,
    emailTo: input.customerEmail,
    projectId: input.projectId,
    // R112 — auto-finalize + auto-deliver hooks. The runner reads these
    // from state.spec when chapters reach ready_to_concat and runs the
    // remainder of the pipeline (concat → upload → deliver) without a
    // second tool call from Felix. See video-job-runner.ts runChaptersInBackground.
    autoFinalize: true,
    autoDeliver: !!input.customerEmail || !!input.customerName,
    customerName: input.customerName,
  } as StartVideoJobInput;

  let started: { job_id: string; status: string; total_chapters: number; total_scenes: number };
  try {
    started = startVideoJob(startInput);
  } catch (e: any) {
    return { success: false, message: `startVideoJob threw: ${e?.message || String(e)}`, error: "start_failed" };
  }

  console.log(`[build-video-from-brief] Started job ${started.job_id} — ${started.total_chapters} chapters / ${started.total_scenes} scenes; auto-finalize=on, auto-deliver=${startInput.autoDeliver}`);

  const watchUrl = `/jobs/${started.job_id}`;
  return {
    success: true,
    job_id: started.job_id,
    status: started.status,
    total_chapters: started.total_chapters,
    total_scenes: started.total_scenes,
    watch_progress_url: watchUrl,
    plan_summary: `${plan.chapters.length} chapters: ${plan.chapters.map((c) => c.chapterTitle).join(" → ")}`,
    estimated_duration_sec: estimatedDurationSec,
    message: `Started "${title}" as job ${started.job_id} (${started.total_chapters} chapters / ${started.total_scenes} scenes, ~${Math.round(estimatedDurationSec / 60)} min). Background render is running; concat + Drive upload + ${startInput.autoDeliver ? "delivery" : "(no delivery — pass customerEmail to enable)"} will fire automatically when chapters complete. Watch live progress at ${watchUrl} — this surface stays alive independent of the chat turn.`,
    _instruction: "DO NOT poll check_video_job or call finalize_video — the runner does both automatically. Just tell the user the watch_progress_url and the estimated minutes; the system will email them when it's done.",
  };
}
