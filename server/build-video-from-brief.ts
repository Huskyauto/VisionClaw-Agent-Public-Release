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
import { FISH_VOICE_BOB_DIRECT } from "./lib/fish-voice-ids";
import { isProductionRuntime } from "./lib/runtime-env";

// The BWB render path stages to Bob's PUBLIC YouTube-channel repo and bypasses
// the daily render cost cap (skipDailyCap). Only the platform owner may take it;
// honoring a caller-supplied bwbBrand for any other tenant would let a customer
// render skip the cap AND stage their media on Bob's public repo. (tenant 1 ==
// platform owner, same convention as server/routes/archive-rescue.ts.)
const PLATFORM_OWNER_TENANT_ID = 1;

export interface BuildVideoFromBriefInput {
  brief: string;
  tenantId: number;
  title?: string;
  targetMinutes?: number;       // default 5
  voice?: string;               // default "onyx"
  voiceProvider?: string;       // default "fish" (R110.6)
  strictVoice?: boolean;        // R125+14+sec3 — brand-voice lock; when true a Fish failure fails the render instead of cascading to a non-brand voice. Auto-forced ON when bwbBrand is true.
  resolution?: string;          // default "1920x1080"
  customerName?: string;        // for deliverDigitalProduct
  customerEmail?: string;       // emailTo
  uploadToDrive?: boolean;      // default true
  projectId?: number;
  bwbBrand?: boolean;           // default false; if true, applies BWB rules in plan prompt
  playlist?: string;            // R125+18 — BWB playlist for the brand render backend (default "The Build"); must be an ALLOWED_PLAYLISTS value (validated before render).
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
- Weight numbers: "236 lbs lost" / "268 lbs current" (as of 2026-05-10).
- 1920x1080 16:9, narrated in Bob's own Fish Audio voice clone (HARD-LOCKED — onyx/any other voice is overridden), no per-video script files.`;

// R125+18 — Built With Bob FIRST-PERSON narration rules for the brief path. The
// default NARRATION_RULES above use SECOND person ("you"); a BWB video must be
// Bob speaking in FIRST person about his own journey ("hey, this is Bob, today
// I…"). Selected in place of NARRATION_RULES whenever bwbBrand is true. Mirrors
// scripts/build-bwb-weekly.ts so both BWB entrypoints read the same way.
const BWB_NARRATION_RULES = `NARRATION RULES (Built With Bob — a validator REJECTS violations):
- FIRST PERSON, AS BOB. Bob speaks directly to camera about HIS OWN week and journey — use "I", "me", "my". NEVER address "you" as the subject, NEVER third-person ("Bob did X"), NEVER "welcome to the Built With Bob video series".
- Warm, candid, reflective, motivational — like talking to a friend over coffee.
- Scene 1 is Bob on camera over his REAL photo: open with a personal hook ("Hey, this is Bob — today I want to walk you through…"). The pipeline may replace scene 1 with Bob's locked opener.
- 1-3 sentences per scene, ~30-45 words, natural spoken cadence, no stage directions, no markdown.
- BANNED: "in this video", "today I'll cover", "we'll explore", "welcome to the Built With Bob video series", any spoken URL/domain/"dot com".
- Every scene MUST have non-empty narration.`;

// R125+18 — Built With Bob brand defaults, mirrored from the canonical weekly
// pipeline (scripts/build-bwb-weekly.ts) so a BWB video produced via the brief
// path (produce_video / build_video_from_brief) gets the SAME guarantees:
// Bob's real hero photo on scene 1, his locked first-person opener, and the
// shared brand-validated render backends (GitHub farm parallel / local).
const BWB_DEFAULT_HERO = "attached_assets/Bob_on_wellness-program_—_Channel_Avatar_1777847875921.png";
const BWB_DEFAULT_INTRO = "Hey, this is Bob — and this is my weekly Built With Bob wellness journey recap.";
const BWB_DEFAULT_PLAYLIST = "The Build";

/**
 * R125+18 — Flatten planned chapters into a flat BWB scenes array. When a hero
 * photo is supplied, scene 1 is FORCED to Bob's locked first-person opener over
 * his real photo (matching scripts/build-bwb-weekly.ts), guaranteeing the "hey,
 * this is Bob" intro + on-camera photo regardless of what the planner emitted.
 * Exported pure so the invariant is unit-testable without a render.
 */
export function buildBwbScenesFromChapters(
  chapters: ChapterSpec[],
  heroImagePath?: string,
  introLine: string = BWB_DEFAULT_INTRO,
): { narration: string; imagePrompt?: string; imagePath?: string }[] {
  const flat: { narration: string; imagePrompt?: string; imagePath?: string }[] = [];
  for (const ch of chapters) {
    for (const s of ((ch?.scenes as any[]) || [])) {
      flat.push({
        narration: String(s?.narration || "").trim(),
        imagePrompt: s?.imagePrompt ? String(s.imagePrompt) : undefined,
        imagePath: s?.imagePath ? String(s.imagePath) : undefined,
      });
    }
  }
  if (heroImagePath && flat.length > 0) {
    flat[0] = { narration: introLine, imagePath: heroImagePath };
  }
  return flat;
}

/**
 * R125+14+sec3 — Built With Bob brand-voice lock, resolved at the single
 * orchestration chokepoint. Every BWB entrypoint (build_video_from_brief tool,
 * produce_video shim, mpeg forwards) routes through buildVideoFromBrief, so
 * resolving here guarantees the voice rule regardless of what the caller passed.
 * When bwbBrand is true we FORCE Bob's Fish clone + fish provider + strictVoice —
 * even if the caller passed voice:"onyx" or another provider (a real footgun seen
 * in saved prompts). Deliberate guest segments must set BWB_VOICE_OVERRIDE_OK=1.
 * Non-BWB callers (bwbBrand falsy) keep prior defaults unchanged.
 * Exported pure helper so the invariant is unit-testable without a render.
 */
export function resolveBriefVoiceLock(
  input: Pick<BuildVideoFromBriefInput, "bwbBrand" | "voice" | "voiceProvider" | "strictVoice">,
  logTitle?: string,
): { voice: string; voiceProvider: string; strictVoice: boolean; locked: boolean } {
  const overrideOk = process.env.BWB_VOICE_OVERRIDE_OK === "1";
  const locked = input.bwbBrand === true && !overrideOk;
  if (input.bwbBrand === true && overrideOk) {
    console.warn(`[build-video-from-brief] BWB_VOICE_OVERRIDE_OK=1 — brand-voice lock BYPASSED; rendering "${logTitle || "(untitled)"}" in voice="${input.voice || "(default)"}" provider="${input.voiceProvider || "(default)"}". Intended only for deliberate guest segments.`);
  }
  if (locked && input.voice && input.voice !== FISH_VOICE_BOB_DIRECT) {
    console.warn(`[build-video-from-brief] bwbBrand render — overriding requested voice="${input.voice}" with Bob's Fish clone (${FISH_VOICE_BOB_DIRECT}). Set BWB_VOICE_OVERRIDE_OK=1 for a deliberate guest voice.`);
  }
  return {
    voice: locked ? FISH_VOICE_BOB_DIRECT : (input.voice || "onyx"),
    voiceProvider: locked ? "fish" : (input.voiceProvider || "fish"),
    strictVoice: locked ? true : (input.strictVoice === true),
    locked,
  };
}

/**
 * R125+19 — pure intent detector for Bob's Built With Bob WEEKLY RECAP.
 * Exported so the routing invariant is unit-testable without a render.
 *
 * Fires only on genuine *weekly recap* intent, NOT "weekly OR recap" (which
 * would wrongly divert "BWB weekly check-in on mindset" or "BWB recap of my
 * first month"). Requires a BWB signal (brand flag OR "built with bob"/"bwb")
 * AND EITHER a strict phrase ("weekly recap"/"week in review") OR the
 * combination of a periodicity cue (weekly/week of/this week/…) AND a recap cue
 * (recap/summary/wrap-up/highlights/round-up/in review). Conservative-by-design;
 * the env escape hatch handles deliberate exceptions.
 */
export function isBwbWeeklyRecapBrief(
  brief?: string,
  title?: string,
  bwbBrand?: boolean,
): boolean {
  const text = `${brief || ""} ${title || ""}`.toLowerCase();
  const bwbSignal = bwbBrand === true || /built with bob|\bbwb\b/.test(text);
  if (!bwbSignal) return false;
  const strictPhrase = /weekly recap|week in review/.test(text);
  const weekCue = /\bweekly\b|week of\b|this week|last week|past week|week\s*\d|wk of/.test(text);
  const recapCue = /\brecap\b|\bsummary\b|wrap-?up|highlights|round-?up|in review/.test(text);
  return strictPhrase || (weekCue && recapCue);
}

export async function buildVideoFromBrief(input: BuildVideoFromBriefInput): Promise<BuildVideoFromBriefResult> {
  if (!input?.brief || !input.brief.trim()) {
    return { success: false, message: "brief is required (a short description of the video you want)", error: "missing_brief" };
  }
  if (typeof input.tenantId !== "number" || input.tenantId <= 0) {
    return { success: false, message: "tenantId required", error: "missing_tenant" };
  }

  // R125+19 — fail-closed weekly-recap redirect. The brief path PLANS chapters
  // from an LLM director given only the brief text — it never discovers or
  // transcribes Bob's actual daily clips, so a "Built With Bob weekly recap"
  // routed here yields the SAME generic evergreen chapters every week (and
  // renders serially on the app box). The dedicated `bwb_weekly_build` pipeline
  // auto-discovers + transcribes THIS week's real Drive clips and renders in
  // parallel on the GitHub farm. Description carve-outs alone are not enough —
  // high-influence tool-pick summaries truncate descriptions before the
  // exception, so we enforce the routing at the single function chokepoint that
  // BOTH produce_video and build_video_from_brief funnel through. Escape hatch:
  // BWB_BRIEF_RECAP_OVERRIDE_OK=1 to deliberately force the generic brief path.
  if (process.env.BWB_BRIEF_RECAP_OVERRIDE_OK !== "1") {
    if (isBwbWeeklyRecapBrief(input.brief, input.title, input.bwbBrand)) {
      return {
        success: false,
        error: "use_bwb_weekly_build",
        message:
          "This looks like Bob's Built With Bob WEEKLY RECAP, which must NOT go through the generic brief path — that only invents evergreen chapters from the brief text and never pulls this week's actual clips (and renders serially). Call `bwb_weekly_build` instead: it auto-discovers + transcribes THIS week's real daily clips from Bob's Drive drop-folder and renders in parallel on the GitHub Actions farm. (Only set BWB_BRIEF_RECAP_OVERRIDE_OK=1 to deliberately force the generic brief path.)",
      };
    }
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
  // R125+18 — Built With Bob videos ALWAYS open on Bob's real photo. If the
  // caller didn't supply one, default scene 1 to Bob's channel-avatar hero so a
  // BWB video made via the brief path never ships a generic AI-generated intro.
  if (input.bwbBrand && !validatedUserImage) {
    const heroCandidate = pathmod.resolve(process.cwd(), BWB_DEFAULT_HERO);
    if (fsmod.existsSync(heroCandidate)) {
      validatedUserImage = heroCandidate;
    } else {
      console.warn(`[build-video-from-brief] bwbBrand render but hero photo missing at ${heroCandidate} — scene 1 will fall back to an AI image. Add the asset or pass userImageDriveFileId.`);
    }
  }
  const heroBlock = validatedUserImage ? `\n\nHERO IMAGE: Scene 1 will use a REAL PHOTO of the narrator (already on disk — do not generate an image prompt for scene 1). Write scene 1's narration to introduce the person on screen by name and hook the viewer (e.g. "This is Bob. Two and a half years ago he weighed 504 pounds…"). All other scenes get AI-generated cinematic images per the IMAGE PROMPT RULES below.\n` : "";

  console.log(`[build-video-from-brief] Planning: brief="${input.brief.slice(0, 80)}..." target=${targetMinutes}min → ${shape.chapters} chapters × ${shape.scenesPerChapter} scenes${validatedUserImage ? ` (hero image: ${validatedUserImage})` : ""}`);

  // R125+18 — BWB videos narrate FIRST-PERSON as Bob; everything else keeps the
  // default second-person rules.
  const narrationRules = input.bwbBrand ? BWB_NARRATION_RULES : NARRATION_RULES;

  const planResult = await runLlmTask({
    prompt: `You are a video director. Plan a ${targetMinutes}-minute narrated video from the brief below.

Structure the video into EXACTLY ${shape.chapters} chapters of EXACTLY ${shape.scenesPerChapter} scenes each (${shape.totalScenes} scenes total). Every scene needs (a) a cinematic imagePrompt and (b) FINAL spoken narration.

${narrationRules}

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

  // R125+18 — Built With Bob brand path. A BWB video MUST render through the
  // shared, brand-validated backends (GitHub Actions farm in PARALLEL by
  // default, local fallback) — NOT the in-process job runner, which renders
  // chapters serially (concurrency 1, by the R110.22 prod-RAM incident) and is
  // a non-compliant 3rd backend for BWB per replit.md. We assemble the SAME flat
  // script the weekly pipeline emits, validate it with the SAME validator, then
  // dispatch the proven backend detached so the chat turn can close. Non-BWB
  // videos fall through unchanged to the in-process job runner below.
  if (input.bwbBrand) {
    // Owner-only privileged dispatch (see PLATFORM_OWNER_TENANT_ID above). Fail
    // closed for any non-owner tenant — the BWB backend skips the cost cap and
    // stages to Bob's public channel repo, neither of which is ever valid for a
    // customer/non-owner render.
    if (input.tenantId !== PLATFORM_OWNER_TENANT_ID) {
      return { success: false, message: "Built With Bob brand rendering (bwbBrand) is restricted to the platform owner.", error: "bwb_owner_only" };
    }
    const introLine = (process.env.BWB_INTRO_LINE || BWB_DEFAULT_INTRO).trim();
    const scenes = buildBwbScenesFromChapters(chaptersForRunner, validatedUserImage, introLine);
    const script = {
      videoId: `brief-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`,
      playlist: input.playlist || BWB_DEFAULT_PLAYLIST,
      title: title.slice(0, 60).trim(),
      scenes,
    };
    // Synchronous brand validation so a violation (spoken URL, forbidden token,
    // bad playlist) fails LOUD in the tool result instead of silently dying in
    // the detached render process.
    try {
      const { validateBwbScript, assertRenderableFormat, assertBobVoice } = await import("../scripts/lib/bwb-validate");
      const failFn = (m: string) => { throw new Error(m); };
      const warnFn = (m: string) => console.warn(m);
      validateBwbScript(script as any, failFn, warnFn);
      // Parity with both render backends: reject unsupported (Shorts) formats and
      // a non-Bob voice BEFORE we detach the render, so they fail loud here.
      assertRenderableFormat(script as any, failFn);
      assertBobVoice(process.env.BWB_VOICE || FISH_VOICE_BOB_DIRECT, failFn, warnFn);
    } catch (e: any) {
      return { success: false, message: `Built With Bob brand validation failed: ${e?.message || String(e)}. Fix the brief/narration and retry.`, error: "bwb_validation_failed" };
    }
    const outPath = pathmod.join("data/youtube/scripts", `${script.videoId}.json`);
    try {
      fsmod.mkdirSync(pathmod.dirname(outPath), { recursive: true });
      fsmod.writeFileSync(outPath, JSON.stringify(script, null, 2));
    } catch (e: any) {
      return { success: false, message: `Failed to write BWB script ${outPath}: ${e?.message || String(e)}`, error: "bwb_script_write_failed" };
    }
    // Backend selector mirrors scripts/build-bwb-weekly.ts: GitHub farm by
    // default (parallel chapters), local fallback if no PAT (renders serially —
    // logged loud so a degraded run is visible, never a silent no-op).
    const backendEnv = (process.env.BWB_RENDER_BACKEND || "github").toLowerCase();
    const haveGithubPat = !!(process.env.GITHUB_PERSONAL_ACCESS_TOKEN_2 || process.env.GITHUB_TOKEN);
    let useGithub = backendEnv === "github";
    if (useGithub && !haveGithubPat) {
      // In the published prod box the LOCAL builder cannot ship (Reserved-VM
      // limits — it dies and strands a zombie job), so a PAT-less farm request
      // must fail CLEANLY here rather than spawn a doomed detached local render.
      if (isProductionRuntime()) {
        return {
          success: false,
          message:
            "BWB render requested the GitHub farm but no GITHUB_PERSONAL_ACCESS_TOKEN_2/GITHUB_TOKEN is set in the deployment. " +
            "The local builder can't render in the published prod box, so refusing to spawn a doomed render. " +
            "Set the GitHub PAT secret in the deployment env, or run on the dev workspace.",
          error: "bwb_no_pat_in_prod",
        };
      }
      console.warn("[build-video-from-brief] bwbBrand wants the GitHub render farm but no GITHUB_PERSONAL_ACCESS_TOKEN_2/GITHUB_TOKEN is set — falling back to the LOCAL builder (dev workspace, renders serially).");
      useGithub = false;
    }
    const renderScript = useGithub ? "scripts/bwb-render-github.ts" : "scripts/build-bwb-video.ts";
    let logPath = "";
    try {
      const { spawn } = await import("child_process");
      const { sanitizeSpawnEnv } = await import("./safety/spawn-env-guard");
      const logDir = "data/youtube/render-logs";
      fsmod.mkdirSync(logDir, { recursive: true });
      logPath = pathmod.join(logDir, `${script.videoId}.log`);
      const logFd = fsmod.openSync(logPath, "a");
      const child = spawn("npx", ["tsx", renderScript], {
        cwd: process.cwd(),
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: {
          ...sanitizeSpawnEnv(process.env),
          SCRIPT: outPath,
          BWB_VOICE: process.env.BWB_VOICE || FISH_VOICE_BOB_DIRECT,
          ...(useGithub ? { DELIVER: "true" } : {}),
        },
      });
      child.unref();
    } catch (e: any) {
      return { success: false, message: `Failed to spawn BWB render backend (${renderScript}): ${e?.message || String(e)}`, error: "bwb_spawn_failed" };
    }
    const heroNote = validatedUserImage
      ? "scene 1 opens on Bob's real photo with his first-person opener"
      : "scene 1 uses an AI image (hero photo unavailable on disk)";
    return {
      success: true,
      status: "rendering",
      total_chapters: Math.max(1, Math.ceil(scenes.length / 3)),
      total_scenes: scenes.length,
      estimated_duration_sec: estimatedDurationSec,
      plan_summary: `Built With Bob brand render — ${scenes.length} scenes via ${useGithub ? "GitHub Actions render farm (parallel chapters)" : "LOCAL builder (serial — no GitHub PAT)"}`,
      message: `Started Built With Bob render "${script.title}" via ${useGithub ? "the GitHub Actions render farm — chapters render IN PARALLEL across separate containers" : "the LOCAL builder (no GitHub PAT configured, so it renders serially)"}. Narrated first-person in Bob's Fish voice clone; ${heroNote}. Script: ${outPath}; render logs: ${logPath}. Delivery + email fire automatically on completion.`,
      _instruction: "This Built With Bob video routes through the brand-validated render backend (NOT the in-process job runner), so it will NOT appear on /jobs. Tell Bob it's rendering on the GitHub farm in parallel and will be delivered + emailed automatically; render progress is in data/youtube/render-logs/.",
    } as BuildVideoFromBriefResult;
  }

  // R125+14+sec3 — resolve the Built With Bob brand-voice lock at this single
  // orchestration chokepoint (see resolveBriefVoiceLock above for the rationale).
  const { voice: resolvedVoice, voiceProvider: resolvedVoiceProvider, strictVoice: resolvedStrictVoice } = resolveBriefVoiceLock(input, title);

  // Bob 2026-06-02 (GLOBAL): ALL video production should render on the free
  // GitHub Actions farm in PARALLEL (chapters fan out across separate
  // containers) instead of serially in-process on the app box (concurrency 1
  // since the R110.22 prod-RAM OOM incident). Generic/customer videos go through
  // the SAME shared farm core as Built With Bob (scripts/lib/github-render-farm),
  // minus the brand validation + Fish-voice lock — the caller's resolved voice is
  // used. We assemble a flat generic script, spawn the generic renderer detached
  // so the chat turn closes, and ALWAYS deliver via the pipeline (Drive + email +
  // Play link). Falls through to the in-process runner only when no GitHub PAT is
  // configured, or when VIDEO_RENDER_BACKEND is explicitly set to local.
  const genericBackend = (process.env.VIDEO_RENDER_BACKEND || "github").toLowerCase();
  const haveGenericGithubPat = !!(process.env.GITHUB_PERSONAL_ACCESS_TOKEN_2 || process.env.GITHUB_TOKEN);
  const useGenericGithub = genericBackend === "github" && haveGenericGithubPat;
  if (useGenericGithub) {
    const ghVideoId = `brief-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;
    const ghScenes = chaptersForRunner
      .flatMap((c) => c.scenes.map((s) => ({
        narration: String((s as any).narration || "").trim(),
        imagePrompt: (s as any).imagePrompt ? String((s as any).imagePrompt) : undefined,
        imagePath: (s as any).imagePath ? String((s as any).imagePath) : undefined,
      })))
      .filter((s) => s.narration || s.imagePath || s.imagePrompt);
    if (ghScenes.length === 0) {
      console.warn("[build-video-from-brief] generic GitHub-farm path produced 0 usable scenes — falling back to the in-process runner.");
    } else {
      const ghScript = {
        videoId: ghVideoId,
        title: title.slice(0, 200),
        scenes: ghScenes,
        voice: resolvedVoice,
        voiceProvider: resolvedVoiceProvider,
        strictVoice: resolvedStrictVoice,
        resolution: input.resolution || "1920x1080",
      };
      const ghOutPath = pathmod.join("data/youtube/scripts", `${ghVideoId}.json`);
      // Always deliver through the pipeline (HARD RULE). Recipient is the caller's
      // customer if provided, else the owner so the render never orphans on disk.
      const ownerEmail = process.env.OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL || process.env.SITE_OWNER_EMAIL || process.env.SITE_CONTACT_EMAIL || "";
      const deliverEmail = input.customerEmail || ownerEmail;
      try {
        fsmod.mkdirSync(pathmod.dirname(ghOutPath), { recursive: true });
        fsmod.writeFileSync(ghOutPath, JSON.stringify(ghScript, null, 2));
        const { spawn } = await import("child_process");
        const { sanitizeSpawnEnv } = await import("./safety/spawn-env-guard");
        const logDir = "data/youtube/render-logs";
        fsmod.mkdirSync(logDir, { recursive: true });
        const ghLogPath = pathmod.join(logDir, `${ghVideoId}.log`);
        const logFd = fsmod.openSync(ghLogPath, "a");
        const child = spawn("npx", ["tsx", "scripts/render-github-generic.ts"], {
          cwd: process.cwd(),
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: {
            ...sanitizeSpawnEnv(process.env),
            SCRIPT: ghOutPath,
            ...(deliverEmail ? { DELIVER: "true", CUSTOMER_EMAIL: deliverEmail } : {}),
            ...(input.customerName ? { CUSTOMER_NAME: input.customerName } : {}),
            PRODUCT_NAME: title.slice(0, 200),
            ...(input.projectId ? { PROJECT_ID: String(input.projectId) } : {}),
          },
        });
        child.unref();
        const totalChapters = Math.max(1, Math.ceil(ghScenes.length / 3));
        return {
          success: true,
          status: "rendering",
          total_chapters: totalChapters,
          total_scenes: ghScenes.length,
          estimated_duration_sec: estimatedDurationSec,
          plan_summary: `${plan.chapters.length} chapters via GitHub Actions render farm (parallel containers): ${plan.chapters.map((c) => c.chapterTitle).join(" → ")}`,
          message: `Started "${title}" on the GitHub Actions render farm — ${totalChapters} chapters render IN PARALLEL across separate containers (free infra; the app box stays free). Script: ${ghOutPath}; render logs: ${ghLogPath}. ${deliverEmail ? `Delivery + email to ${deliverEmail} fire automatically on completion.` : "No recipient resolved — the MP4 will be left on disk; pass customerEmail to auto-deliver."}`,
          _instruction: "This video renders on the GitHub Actions farm (NOT the in-process job runner), so it will NOT appear on /jobs. Tell the user it's rendering in parallel and will be delivered + emailed automatically; render progress is in data/youtube/render-logs/.",
        } as BuildVideoFromBriefResult;
      } catch (e: any) {
        console.warn(`[build-video-from-brief] failed to dispatch generic GitHub-farm render (${e?.message || String(e)}) — falling back to the in-process runner.`);
      }
    }
  } else if (genericBackend === "github" && !haveGenericGithubPat) {
    console.warn("[build-video-from-brief] VIDEO_RENDER_BACKEND=github (default) but no GITHUB_PERSONAL_ACCESS_TOKEN_2/GITHUB_TOKEN is set — falling back to the in-process runner (renders chapters serially).");
  }

  const startInput: StartVideoJobInput = {
    tenantId: input.tenantId,
    title,
    chapters: chaptersForRunner,
    voice: resolvedVoice,
    // R112.14: default to Fish TTS. FISH_VOICE_ONYX is now set to Bob's chosen
    // reference id (32-hex Fish model id) so every chapter gets the same
    // narrator. R112.11 had flipped this to "openai" while the env var was
    // unset (random voice per chapter); now resolved.
    // R125+14+sec3: when bwbBrand, voice/provider are hard-locked to Bob's Fish
    // clone above (resolvedVoice/resolvedVoiceProvider) and strictVoice is forced.
    voiceProvider: resolvedVoiceProvider,
    strictVoice: resolvedStrictVoice,
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
