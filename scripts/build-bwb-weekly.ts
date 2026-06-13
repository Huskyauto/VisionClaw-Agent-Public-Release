/**
 * Built With Bob — WEEKLY RECAP builder.
 *
 * Bob films a short selfie clip most mornings and uploads each to YouTube
 * (also Facebook). Once a week he pastes that week's 5-7 Short URLs here; this
 * script:
 *   1. Extracts every transcript (yt-dlp audio → ElevenLabs Scribe).
 *   2. Synthesizes them into ONE weekly "story" via the LLM, written as a
 *      full Built With Bob narrated video script (chapters of scenes).
 *   3. Opens on Bob's photo (hero image, scene 1), narrated in Bob's Fish
 *      Audio voice clone.
 *   4. Hands the script JSON to the CANONICAL builder (scripts/build-bwb-video.ts)
 *      which validates brand rules, pre-bakes images, renders 1080p/30fps,
 *      makes a thumbnail, and delivers via deliverDigitalProduct.
 *
 * Usage:
 *   URLS="https://youtube.com/shorts/AAA, https://youtube.com/shorts/BBB" \
 *   WEEK_LABEL="Week of May 26" \
 *   npx tsx scripts/build-bwb-weekly.ts
 *
 * Or point at a JSON file: { "weekLabel": "...", "urls": [...], "playlist": "The Build", "heroImagePath": "..." }
 *   WEEKLY=data/youtube/weekly/2026-05-30.json npx tsx scripts/build-bwb-weekly.ts
 *
 * Flags:
 *   DRY_RUN=1   stop after writing the script JSON (skip render/deliver) — used to validate the chain.
 *   PLAYLIST    override playlist (default "The Build").
 *   HERO_IMAGE  override opening photo.
 *   TARGET_MIN  target video minutes (default 4.5).
 *
 * Do NOT roll your own render/delivery here — this feeds build-bwb-video.ts on purpose.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { extractWeeklyTranscripts } from "./lib/youtube-transcript";
import { discoverWeeklyShorts } from "./lib/youtube-discover";
import { discoverWeeklyDriveClips, extractWeeklyDriveTranscripts, type DiscoveredDriveClip } from "./lib/drive-discover";
import { findWeightViolations } from "./lib/bwb-weight-guard";
import { auditFirstPerson } from "./lib/bwb-first-person-guard";
import { FISH_VOICE_BOB_DIRECT } from "../server/lib/fish-voice-ids";
import { runLlmTask } from "../server/llm-task";
import { sanitizeSpawnEnv } from "../server/safety/spawn-env-guard";
import { isProductionRuntime } from "../server/lib/runtime-env";
import { openCheckpoints } from "../server/agentic/pipeline-checkpoint";
import { setBwbPhase, updateBwbChapters, completeBwbJob, bumpBwbHeartbeat } from "../server/lib/bwb-job-progress";

// Scenes-per-chapter on the GitHub render farm (mirror DEFAULT_CHAPTER_SIZE in
// scripts/lib/github-render-farm.ts) so the live progress card shows the same
// chapter count the farm will fan out to.
const FARM_CHAPTER_SIZE = 3;

const DEFAULT_HERO = "attached_assets/Bob_on_wellness-program_—_Channel_Avatar_1777847875921.png";
// LOCKED scene-1 intro (Bob, 2026-05-31): scene 1 shows Bob's real photo and
// must open with this exact on-camera line, spoken in his own voice the moment
// the photo loads. This is NOT LLM-generated — the recap then proceeds with the
// agents' review of the week (walks, bike rides, daily clips) across scenes 2+.
// Override with BWB_INTRO_LINE if a one-off needs a different opener.
const DEFAULT_INTRO_NARRATION =
  "Hey, this is Bob — and this is my weekly Built With Bob wellness journey recap.";
const DEFAULT_PLAYLIST = "The Build";
const TITLE_MAX = 60;
const TENANT_ID = Number(process.env.ADMIN_TENANT_ID) || 1;

interface WeeklyConfig {
  weekLabel: string;
  source: "drive" | "youtube";
  urls: string[];
  driveClips?: DiscoveredDriveClip[];
  playlist: string;
  heroImagePath: string;
  targetMinutes: number;
  // Weight FACTS for the week — pinned inputs, never inferred by the model. If a
  // value is absent the synthesizer is instructed to omit any weight number
  // rather than invent one (the "stated 265 when Bob gained 7 lb" bug).
  currentWeight?: number;
  totalLost?: number;
  startWeight?: number;
}

function fail(msg: string): never {
  console.error(`\n[build-bwb-weekly] FAIL: ${msg}\n`);
  process.exit(1);
}

function parseUrls(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

async function loadConfig(): Promise<WeeklyConfig> {
  let weekLabel = process.env.WEEK_LABEL || "";
  let urls: string[] = [];
  let playlist = process.env.PLAYLIST || DEFAULT_PLAYLIST;
  let heroImagePath = process.env.HERO_IMAGE || DEFAULT_HERO;

  // Weight FACTS — pinned inputs (env wins over WEEKLY json). Absent ⇒ omit, never invent.
  let currentWeight = Number(process.env.BWB_CURRENT_WEIGHT) || undefined;
  let totalLost = Number(process.env.BWB_TOTAL_LOST) || undefined;
  let startWeight = Number(process.env.BWB_START_WEIGHT) || undefined;

  if (process.env.WEEKLY) {
    const cfg = JSON.parse(fs.readFileSync(process.env.WEEKLY, "utf8"));
    weekLabel = weekLabel || cfg.weekLabel || "";
    urls = Array.isArray(cfg.urls) ? cfg.urls : [];
    if (cfg.playlist && !process.env.PLAYLIST) playlist = cfg.playlist;
    if (cfg.heroImagePath && !process.env.HERO_IMAGE) heroImagePath = cfg.heroImagePath;
    if (currentWeight === undefined && cfg.currentWeight !== undefined) currentWeight = Number(cfg.currentWeight) || undefined;
    if (totalLost === undefined && cfg.totalLost !== undefined) totalLost = Number(cfg.totalLost) || undefined;
    if (startWeight === undefined && cfg.startWeight !== undefined) startWeight = Number(cfg.startWeight) || undefined;
  }
  if (process.env.URLS) urls = parseUrls(process.env.URLS);

  // SOURCE SELECTOR (Bob 2026-05-30): the autonomous weekly run now sources
  // Bob's daily Shorts from his Google Drive drop-folder by default — that's
  // where he uploads a clip every day. BWB_SOURCE=youtube falls back to the
  // connected-channel discovery. Explicit URLS/WEEKLY always force the URL path.
  let source: "drive" | "youtube" =
    process.env.BWB_SOURCE === "youtube" ? "youtube" : process.env.BWB_SOURCE === "drive" ? "drive" : "drive";
  let driveClips: DiscoveredDriveClip[] | undefined;

  // AUTONOMOUS DISCOVERY: when no URLs were supplied (the autonomous weekly run),
  // auto-enumerate this week's short-form dailies. The ~5-min weekly recap /
  // long-form productions are excluded (duration ceiling + title guard) so
  // there's no feedback loop. Set NO_AUTO_DISCOVER=1 to force manual-URL-only.
  if (urls.length > 0) {
    source = "youtube"; // manual URLs imply the YouTube/URL transcript path
  } else if (!process.env.NO_AUTO_DISCOVER) {
    if (source === "drive") {
      console.log(`[build-bwb-weekly] No URLs supplied — auto-discovering this week's clips from Bob's Drive folder…`);
      // allowUndated:false is HARD on the weekly path — the modifiedTime fallback
      // is the exact channel that leaked re-touched old clips into the recap, so
      // it stays off here regardless of the BWB_ALLOW_UNDATED env.
      if (process.env.BWB_ALLOW_UNDATED === "1") {
        console.warn(
          "[build-bwb-weekly] ⚠ BWB_ALLOW_UNDATED=1 is IGNORED on the weekly path — undated clips are dropped to prevent stale-footage leaks.",
        );
      }
      driveClips = await discoverWeeklyDriveClips({ allowUndated: false });
      if (driveClips.length === 0) {
        fail(
          "Drive auto-discovery found no DATED short-form dailies in the window. " +
            "Either this week's clips weren't uploaded, or they're missing a date in the filename " +
            '("YYYY-MM-DD morning.mp4" / "YYYY-MM-DD evening.mp4"). ' +
            "Check BWB_DRIVE_FOLDER_ID / the folder contents, pin the week with BWB_WEEK_START + BWB_WEEK_END, " +
            "or set BWB_SOURCE=youtube to use the connected channel.",
        );
      }
      // PARTIAL WEEKS ARE OK (Bob 2026-05-31): a missing day — "I was sick and
      // couldn't walk" — must NOT stop the recap. As long as the week range had
      // at least one DATED clip (checked above), build with whatever's available
      // and target ~5 min. We only warn on thin coverage for the run log; we do
      // NOT fail. Stale-footage protection still comes from allowUndated:false +
      // the Sun–Sat range, not from a day-count gate.
      const distinctDays = new Set(driveClips.map((c) => c.clipDate).filter(Boolean));
      if (distinctDays.size < 3) {
        console.warn(
          `[build-bwb-weekly] ⚠ Thin week — only ${distinctDays.size} dated day(s) [${[...distinctDays].sort().join(", ")}] in range. ` +
            `Building the recap from what's available (partial weeks are allowed).`,
        );
      }
      console.log(`[build-bwb-weekly] Discovered ${driveClips.length} Drive clip(s) across ${distinctDays.size} day(s):`);
      driveClips.forEach((c) =>
        console.log(
          `  - "${c.name}" (${c.durationSeconds || "?"}s) date=${c.clipDate || c.modifiedTime.slice(0, 10)} slot=${c.slot || "—"}`,
        ),
      );
    } else {
      console.log(`[build-bwb-weekly] No URLs supplied — auto-discovering this week's Shorts from the connected channel…`);
      const discovered = await discoverWeeklyShorts();
      if (discovered.length === 0) {
        fail(
          "Auto-discovery found no short-form dailies in the trailing window. " +
            "Bob may not have uploaded any Shorts this week, or YouTube isn't connected. " +
            'Provide URLS="url1, url2, …" manually, or check YOUTUBE_REFRESH_TOKEN.',
        );
      }
      urls = discovered.map((d) => d.url);
      console.log(`[build-bwb-weekly] Discovered ${urls.length} Short(s):`);
      discovered.forEach((d) => console.log(`  - ${d.url} (${d.durationSeconds}s) "${d.title}" @ ${d.publishedAt}`));
    }
  }

  const sourceCount = source === "drive" ? driveClips?.length ?? 0 : urls.length;
  if (sourceCount === 0) fail('No clips found. Set URLS="url1, url2, …", WEEKLY=path/to.json, or check the Drive folder.');
  if (!fs.existsSync(heroImagePath)) fail(`Hero image not found: ${heroImagePath}`);
  if (!weekLabel) {
    weekLabel = `Week of ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;
  }

  return {
    weekLabel,
    source,
    urls,
    driveClips,
    playlist,
    heroImagePath,
    targetMinutes: Number(process.env.TARGET_MIN) || 4.5,
    currentWeight,
    totalLost,
    startWeight,
  };
}

interface PlannedScene {
  narration: string;
  imagePrompt?: string;
  imagePath?: string;
}
interface VideoScript {
  videoId: string;
  playlist: string;
  title: string;
  youtubeDescription: string;
  youtubeTags: string[];
  thumbnailPrompt?: string;
  scenes: PlannedScene[];
}

const NARRATION_RULES = `NARRATION RULES (hard brand rules — a validator will REJECT violations):
- First person, AS BOB. Warm, candid, reflective, motivational — like talking to a friend over coffee.
- NEVER speak any URL, domain, or "dot com" out loud. For a call-to-action say "link's in the description below".
- NEVER write the misspellings "Manjaro" or "Monjaro", and never write "GLP" without "-1" (always "wellness").
- Each scene's narration is the FINAL spoken words — 30-55 words per scene, natural spoken cadence, no stage directions, no markdown.
- Scene 1 introduces Bob on camera (his real photo is shown) and hooks the viewer with the week's throughline.`;

const IMAGE_RULES = `IMAGE PROMPT RULES (for scenes 2+; scene 1 uses Bob's real photo, no prompt needed):
- Cinematic, photoreal, evocative still images that match the narration's mood.
- No on-screen text, no logos, no watermarks, no real-person likeness.
- Vary settings/lighting scene to scene so the video doesn't feel repetitive.`;

async function planScript(
  cfg: WeeklyConfig,
  transcripts: { title: string; transcript: string; clipDate?: string | null; slot?: string | null }[],
): Promise<VideoScript> {
  const targetScenes = Math.max(12, Math.min(22, Math.round(cfg.targetMinutes * 4)));
  // Label each clip with its date + time-of-day slot (the transcripts arrive
  // already sorted oldest→newest, morning before evening) so the model narrates
  // the week chronologically and clearly hears BOTH daily talks per day.
  const sourceBlock = transcripts
    .map((t, i) => {
      const label = t.clipDate ? `${t.clipDate}${t.slot ? ` ${t.slot}` : ""}` : t.title;
      return `--- Clip ${i + 1} [${label}] ---\n${t.transcript}`;
    })
    .join("\n\n");

  // Weight FACTS — the model may state ONLY these numbers. If none were supplied,
  // it must omit every weight figure rather than invent one (the wrong-265 bug).
  const facts: string[] = [];
  if (cfg.startWeight) facts.push(`Bob's STARTING weight was ${cfg.startWeight} lbs.`);
  if (cfg.currentWeight) facts.push(`Bob's CURRENT weight this week is exactly ${cfg.currentWeight} lbs.`);
  if (cfg.totalLost) facts.push(`Bob's TOTAL weight lost to date is exactly ${cfg.totalLost} lbs.`);
  const factsBlock = facts.length
    ? `FACTUAL ANCHORS — the ONLY weight numbers you may state. Use them verbatim where relevant; ` +
      `do NOT round, change, recompute, or infer ANY other weight number:\n- ${facts.join("\n- ")}`
    : `WEIGHT NUMBERS: none were supplied for this week. You MUST NOT state any specific weight or ` +
      `total-lost number (no "down to NNN", no "lost NNN pounds", no scale figure). Speak about the ` +
      `journey qualitatively instead. Inventing or guessing a number is a HARD FAILURE — the recap ` +
      `previously shipped a wrong weight this exact way.`;

  const prompt = `You are the director/editor for the YouTube channel "Built With Bob".
Below are transcripts of Bob's daily morning selfie clips from one week (${cfg.weekLabel}).
Synthesize them into ONE cohesive weekly recap video — find the throughline / the story of
Bob's week, the lessons, the wins and struggles, and what it means for the viewer.

Produce a SINGLE narrated video script of about ${cfg.targetMinutes} minutes, structured as
EXACTLY ${targetScenes} scenes total (treat them as ~4-5 chapters of ~4-5 scenes each, but
output ONE flat scenes array).

Scene 1 is Bob's on-camera intro over his real photo and its narration is FIXED — the
pipeline overrides it with Bob's locked opener, so just emit a short placeholder for scene 1
(no imagePrompt). Scenes 2 through ${targetScenes} are the ACTUAL weekly recap: review Bob's
week from the clip transcripts above — the daily walks, the bike rides, the wins, the
struggles, and the lessons — and build the story from THAT. Every scene 2+ needs FINAL spoken
narration AND a cinematic imagePrompt.

${factsBlock}

${NARRATION_RULES}

${IMAGE_RULES}

Return STRICT JSON only (no markdown):
{
  "title": "punchy title, MAX ${TITLE_MAX} characters, no URL",
  "youtubeDescription": "2-4 sentence description; a CTA line and 3-5 hashtags are fine here",
  "youtubeTags": ["6-12 lowercase tags"],
  "thumbnailPrompt": "cinematic thumbnail image prompt, no text/logos",
  "scenes": [
    { "narration": "scene 1 — Bob intro, on camera" },
    { "narration": "...", "imagePrompt": "..." }
  ]
}`;

  // Weight allow-set for the fail-closed weight-honesty guard (the ONLY weight
  // numbers the narration may state). See findWeightViolations.
  const allowed = new Set<string>();
  if (cfg.currentWeight) allowed.add(String(cfg.currentWeight));
  if (cfg.totalLost) allowed.add(String(cfg.totalLost));
  if (cfg.startWeight) allowed.add(String(cfg.startWeight));
  const introLine = (process.env.BWB_INTRO_LINE || DEFAULT_INTRO_NARRATION).trim();

  // Synthesize, then run the two fail-closed guards (weight-honesty + first
  // person). The GUARDS NEVER WEAKEN — but each draft depends on what the model
  // happens to write, so a single stray in-range number ("the 300s", a goal
  // weight) or one third-person sentence would otherwise kill the whole expensive
  // build (transcription already done) and force a manual re-run. So on a guard
  // hit we give the model UP TO TWO bounded corrective retries (the platform's
  // bounded-auto-revise pattern) naming the exact violation; a still-violating
  // draft after the final attempt hard-fails closed. A clean first draft costs
  // nothing extra.
  //
  // WHY TWO (2026-06-07): on the AUTONOMOUS path no weight is supplied, so the
  // guard requires the narration to contain NO weight figure at all — yet this is
  // a wellness channel, so the synthesizer habitually volunteers a number
  // ("down to 435", "the 300s"). With a single corrective retry that path was a
  // coin-flip: it failed whenever the model reached for a number twice in a row,
  // which is exactly why the autonomous weekly recap kept dying in planning
  // (BEFORE ever reaching the render farm) and burning a full transcription +
  // two Opus calls per run. A second corrective retry armed with explicit
  // qualitative vocabulary makes the no-weight path reliably ship instead of
  // randomly fail-closing.
  const MAX_PLAN_ATTEMPTS = 3;
  let j: any = null;
  let title = "";
  let scenes: PlannedScene[] = [];
  let weightViolations: string[] = [];
  let fpReason = "";
  let corrective = "";

  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt++) {
    const res = await runLlmTask({
      prompt: corrective
        ? `${prompt}\n\nCORRECTION — your previous draft was REJECTED by a fail-closed guard. Fix ONLY the issue(s) below and resend the COMPLETE JSON (all scenes):\n${corrective}`
        : prompt,
      input: { weekLabel: cfg.weekLabel, target_minutes: cfg.targetMinutes, target_scenes: targetScenes, clips: sourceBlock },
      // Opus 4.8 is the LOCKED model for the weekly recap (Bob 2026-06-12): the
      // flagship once-weekly story needs faithful multi-transcript synthesis +
      // strict factual-number discipline over speed. WEEKLY_MODEL stays as a
      // deliberate override hatch, but the default is pinned to claude-opus-4-8.
      model: process.env.WEEKLY_MODEL || "claude-opus-4-8",
      // PREFER the flat-rate Claude Runner (~$0): this is a pure structured-JSON
      // task (runLlmTask forces response_format:json_object), so it does NOT need
      // tool-calling. requiresTools:false lets Opus route through the OAuth runner
      // bridge instead of a metered key. If the runner is unavailable it fails
      // over to a metered Anthropic key — and ONLY then does the exemption below
      // matter.
      requiresTools: false,
      // Cost-exempt FLAGSHIP lane: Opus is otherwise jury-only + capped by the
      // metered-Anthropic daily breaker (Bob 2026-06-12). This recap is the one
      // other owner-blessed Opus use — bounded to ≤3 attempts/run — so on a
      // metered fallback it gets the same breaker exemption as the jury and can
      // never be killed mid-build by an unrelated runaway elsewhere.
      costExempt: true,
      thinking: "medium",
      maxTokens: 12_000,
      timeoutMs: 120_000,
      tenantId: TENANT_ID,
    });

    if (!res.success || !res.json) {
      if (attempt < MAX_PLAN_ATTEMPTS) {
        corrective = `Your previous attempt did not return valid JSON (${res.error || "no json"}). Return STRICT JSON only, matching the schema.`;
        continue;
      }
      fail(`LLM script planning failed: ${res.error || "no json"}`);
    }
    j = res.json as any;
    if (!Array.isArray(j.scenes) || j.scenes.length === 0) {
      if (attempt < MAX_PLAN_ATTEMPTS) {
        corrective = `Your previous attempt returned no scenes. Return the full ${targetScenes}-scene array.`;
        continue;
      }
      fail("LLM returned no scenes");
    }

    title = String(j.title || `Built With Bob — ${cfg.weekLabel}`).trim();
    if (title.length > TITLE_MAX) title = title.slice(0, TITLE_MAX).trim();

    scenes = j.scenes.map((s: any, i: number) => {
      const narration = String(s.narration || "").trim();
      if (i === 0) {
        // Scene 1 = Bob's real photo with a LOCKED on-camera intro line, spoken
        // the moment the photo loads. NOT LLM-generated — we override whatever the
        // model returned. No imagePrompt; the builder uses imagePath.
        return { narration: introLine, imagePath: cfg.heroImagePath };
      }
      return { narration, imagePrompt: String(s.imagePrompt || "").trim() || "cinematic reflective still matching the narration mood" };
    });

    if (!scenes[0].narration) fail("Scene 1 narration is empty");

    // WEIGHT-HONESTY GUARD: reject any weight figure in the narration that isn't a
    // supplied factual anchor — the safety net for the "stated 265 lbs when Bob
    // actually gained ~7 lb" failure. Catches digit+unit, unit-less contextual
    // digits ("down to 265"), and spelled-out hundreds. See findWeightViolations.
    weightViolations = findWeightViolations(scenes.map((s) => s.narration).join("  "), allowed);

    // FIRST-PERSON GUARD: the recap must be Bob speaking AS HIMSELF to the viewer
    // ("I woke up", "my morning walk"), never a narrator describing him in the
    // third person ("Bob woke up", "his journey"). Scene 1 is the locked
    // first-person intro and is exempt. See scripts/lib/bwb-first-person-guard.ts.
    const fpAudit = auditFirstPerson(scenes.slice(1).map((s) => s.narration));
    fpReason = fpAudit.passes
      ? ""
      : fpAudit.drift
        ? `${fpAudit.drift} scene(s) describe Bob in the THIRD person (e.g. ${fpAudit.driftExamples.map((s) => `"${s}"`).join("; ")})`
        : `only ${fpAudit.firstPerson}/${fpAudit.total} synthesized scenes carry first-person framing`;

    if (!weightViolations.length && !fpReason) break; // clean → ship it

    if (attempt < MAX_PLAN_ATTEMPTS) {
      const parts: string[] = [];
      if (weightViolations.length) {
        parts.push(
          allowed.size
            ? `WEIGHT: your draft stated weight figure(s) NOT in the supplied facts: ${weightViolations.join(", ")}. ` +
                `You may state ONLY these exact numbers: ${[...allowed].join(", ")} lbs. ` +
                `Remove or replace EVERY other body-weight-range number (goal weights, milestones like "the 300s", any recomputed figure).`
            : // NO weight was supplied — the narration must contain ZERO body-weight
              // numbers. Be maximally explicit AND hand the model the qualitative
              // vocabulary so it stops reaching for a figure (the autonomous-path
              // coin-flip): name the exact offenders to delete, forbid the whole
              // 120–700 numeric range, and show approved number-free phrasings.
              `WEIGHT — CRITICAL: NO weight number was supplied for this week, so your narration must contain ` +
                `ZERO body-weight figures. DELETE these exact offending numbers and do NOT replace them with any ` +
                `other figure: ${weightViolations.join(", ")}. Do NOT state ANY number between 120 and 700 as a ` +
                `body weight — not a current weight, not a total lost, not a goal, not a milestone ("the 300s"), ` +
                `not "down to NNN", not "lost NNN pounds", not spelled-out ("two thirty-five"). Speak about progress ` +
                `ONLY qualitatively, e.g. "the scale kept moving", "lighter than last week", "down another notch", ` +
                `"my clothes fit looser", "real progress this week" — feelings and momentum, never a number.`,
        );
      }
      if (fpReason) {
        parts.push(
          `FIRST PERSON: ${fpReason}. Rewrite every scene 2+ as Bob talking AS HIMSELF to the viewer (I / my / me) — never a narrator describing him ("Bob woke up", "his journey").`,
        );
      }
      corrective = parts.join("\n");
      console.warn(
        `[build-bwb-weekly] guard violation on attempt ${attempt}/${MAX_PLAN_ATTEMPTS} — one bounded corrective retry:\n  - ${parts.join("\n  - ")}`,
      );
    }
  }

  // Fail-closed AFTER the bounded retry: a guard still flagging means the model
  // could not comply twice → refuse to ship (the guards never weaken).
  if (weightViolations.length) {
    fail(
      `Synthesized narration states weight figure(s) not in the supplied facts: ${weightViolations.join(", ")} ` +
        `(allowed: ${allowed.size ? [...allowed].join(", ") + " lbs" : "NONE — no weight was supplied, so no figure may be spoken"}). ` +
        `Refusing to ship a wrong/invented weight even after a corrective retry. Supply BWB_CURRENT_WEIGHT / BWB_TOTAL_LOST ` +
        `(or WEEKLY json currentWeight/totalLost), or re-run — the model stated a weight it was told not to.`,
    );
  }
  if (fpReason) {
    fail(
      `First-person guard: ${fpReason}. The recap must be Bob talking AS HIMSELF to the viewer ` +
        `(I / my / me) — never a narrator describing him ("Bob woke up", "his journey"). The model drifted ` +
        `out of first person even after a corrective retry. Refusing to ship a third-person Built With Bob recap.`,
    );
  }

  return {
    videoId: `weekly-${new Date().toISOString().slice(0, 10)}`,
    playlist: cfg.playlist,
    title,
    youtubeDescription: String(j.youtubeDescription || `Built With Bob — ${cfg.weekLabel}.`).trim(),
    youtubeTags: Array.isArray(j.youtubeTags) ? j.youtubeTags.map((t: any) => String(t)).slice(0, 12) : ["built with bob", "weekly recap"],
    thumbnailPrompt: j.thumbnailPrompt ? String(j.thumbnailPrompt) : undefined,
    scenes,
  };
}

async function main() {
  // Keep the live row warm against the 20-min stale-job reaper during long phases
  // that have no other DB write (multi-clip transcription, LLM script-writing).
  // unref() so it never keeps the process alive; cleared before exit.
  const heartbeat = setInterval(() => { void bumpBwbHeartbeat(); }, 3 * 60 * 1000);
  heartbeat.unref?.();
  await setBwbPhase("Discovering this week's clips");
  const cfg = await loadConfig();
  const sourceCount = cfg.source === "drive" ? cfg.driveClips?.length ?? 0 : cfg.urls.length;
  console.log(`[build-bwb-weekly] ${cfg.weekLabel} — ${sourceCount} clip(s) from ${cfg.source}, playlist "${cfg.playlist}", target ${cfg.targetMinutes}min`);

  // Resume & reconstitution (Task #53): a deterministic per-week job key lets a
  // retry REUSE the expensive transcription + planning stages instead of
  // re-running yt-dlp / ElevenLabs / Opus from scratch. The same key is handed
  // to the spawned render backend via BWB_JOB_KEY so the per-scene image-bake
  // checkpoints land in the SAME manifest — one resumable job end to end.
  const jobKey = process.env.BWB_JOB_KEY || `bwb-weekly-${new Date().toISOString().slice(0, 10)}`;
  const ck = await openCheckpoints({
    tenantId: TENANT_ID,
    jobKey,
    log: (m) => console.log(`[build-bwb-weekly] checkpoint ${m}`),
  });

  await setBwbPhase(`Transcribing ${sourceCount} clip(s)`);
  // STAGE: transcription — checkpointed as a whole. On a clean retry every clip
  // is reused; only a run that never reached a successful transcription set
  // re-downloads + re-transcribes.
  const { transcripts } = await ck.stage<{ transcripts: any[] }>(
    { stage: "transcription" },
    async () => {
      const { transcripts, failures } =
        cfg.source === "drive"
          ? await extractWeeklyDriveTranscripts(cfg.driveClips ?? [])
          : await extractWeeklyTranscripts(cfg.urls);
      if (transcripts.length === 0) {
        fail(`No transcripts extracted. Failures:\n${failures.map((f) => `  - ${f.url}: ${f.error}`).join("\n")}`);
      }
      // Minimum-success guard: a heavily-degraded run shouldn't silently make a weak
      // weekly video. Default floor is min(2, #clips); override with MIN_CLIPS or ALLOW_PARTIAL=1.
      const minClips = Number(process.env.MIN_CLIPS) || Math.min(2, sourceCount);
      if (transcripts.length < minClips && !process.env.ALLOW_PARTIAL) {
        fail(
          `Only ${transcripts.length}/${sourceCount} clip(s) transcribed (need >= ${minClips}). ` +
            `Failures:\n${failures.map((f) => `  - ${f.url}: ${f.error}`).join("\n")}\n` +
            `Set ALLOW_PARTIAL=1 to proceed anyway, or MIN_CLIPS=N to change the floor.`,
        );
      }
      if (failures.length) {
        console.warn(`[build-bwb-weekly] ${failures.length} clip(s) failed and were skipped:`);
        failures.forEach((f) => console.warn(`  - ${f.url}: ${f.error}`));
      }
      console.log(`[build-bwb-weekly] ${transcripts.length} transcript(s) ready → planning weekly story…`);
      return { transcripts };
    },
  ).then((r) => r.result);

  // Attach each transcript's clip date + time-of-day slot (for drive clips,
  // transcript.videoId === clip.fileId) and order them chronologically
  // (oldest→newest, morning before evening) so the recap narrates the week in
  // sequence and BOTH daily talks are clearly distinguished to the synthesizer.
  let planTranscripts: { title: string; transcript: string; clipDate?: string | null; slot?: string | null }[] =
    transcripts.map((t) => ({ title: t.title, transcript: t.transcript }));
  if (cfg.source === "drive" && cfg.driveClips?.length) {
    const meta = new Map(cfg.driveClips.map((c) => [c.fileId, c]));
    planTranscripts = transcripts.map((t) => {
      const m = meta.get(t.videoId);
      return { title: t.title, transcript: t.transcript, clipDate: m?.clipDate ?? null, slot: m?.slot ?? null };
    });
    const slotOrder = (s?: string | null) => (s === "morning" ? 0 : s === "evening" ? 1 : 2);
    planTranscripts.sort((a, b) => {
      const da = a.clipDate || "";
      const db = b.clipDate || "";
      if (da !== db) return da < db ? -1 : 1;
      return slotOrder(a.slot) - slotOrder(b.slot);
    });
  }

  await setBwbPhase("Writing the weekly story (AI)");
  // STAGE: planning — checkpointed with the script JSON path. On a retry the
  // synthesized script is reused (skips the Opus planning call) AS LONG AS the
  // JSON file the render backend reads is still on disk; if it was deleted the
  // checkpoint is treated as stale and planning re-runs (ghost-safe reuse).
  const script = await ck.stage<VideoScript>(
    {
      stage: "planning",
      artifactPathOf: (s) => path.join("data/youtube/scripts", `${s.videoId}.json`),
      verify: (_s, p) => !!p && fs.existsSync(p),
    },
    async () => {
      const s = await planScript(cfg, planTranscripts);
      console.log(`[build-bwb-weekly] script: "${s.title}" — ${s.scenes.length} scenes`);
      const out = path.join("data/youtube/scripts", `${s.videoId}.json`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(s, null, 2));
      console.log(`[build-bwb-weekly] wrote ${out}`);
      return s;
    },
  ).then((r) => r.result);

  // Now that the script exists we know the real title + scene count → seed the
  // live progress card with the chapter glyph row the farm will fan out to.
  {
    const total = Math.max(1, Math.ceil(script.scenes.length / FARM_CHAPTER_SIZE));
    const chapterRows = Array.from({ length: total }, (_, i) => ({
      idx: i,
      title: `Chapter ${i + 1}`,
      scene_count: script.scenes.slice(i * FARM_CHAPTER_SIZE, (i + 1) * FARM_CHAPTER_SIZE).length,
      status: "queued" as const,
    }));
    await setBwbPhase("Preparing render", { title: script.title, totalChapters: total });
    await updateBwbChapters(chapterRows, { totalChapters: total });
  }

  const outPath = path.join("data/youtube/scripts", `${script.videoId}.json`);
  // A reused script lives in the checkpoint manifest but its JSON file must exist
  // for the render backend; the `verify` above guarantees it, but re-materialize
  // defensively in case of an external delete between verify and handoff.
  if (!fs.existsSync(outPath)) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(script, null, 2));
  }

  if (process.env.DRY_RUN) {
    console.log(`[build-bwb-weekly] DRY_RUN=1 — stopping before render. Inspect ${outPath}.`);
    return;
  }

  // RENDER BACKEND (Bob 2026-05-31): the weekly recap is a heavy multi-chapter
  // job, so it DEFAULTS to the free GitHub Actions render farm — each chapter
  // renders in its own container IN PARALLEL, instead of the local engine which
  // serializes scenes under the app box's RAM pressure (the "rendered
  // sequentially" complaint). Override with BWB_RENDER_BACKEND=local to force the
  // in-process builder; if the farm is selected but no GitHub PAT is configured
  // we auto-fall back to local so a scheduled run never silently no-ops. Both
  // backends share the SAME validator AND write the SAME .result.json sidecar the
  // orchestrator picks up for the approval/publish email.
  const backend = (process.env.BWB_RENDER_BACKEND || "github").toLowerCase();
  if (backend !== "github" && backend !== "local") {
    console.warn(
      `[build-bwb-weekly] unrecognized BWB_RENDER_BACKEND="${backend}" — expected "github" or "local"; using the local builder.`,
    );
  }
  const haveGithubPat = !!(process.env.GITHUB_PERSONAL_ACCESS_TOKEN_2 || process.env.GITHUB_TOKEN);
  let useGithub = backend === "github";
  if (useGithub && !haveGithubPat) {
    if (isProductionRuntime()) {
      // In the published prod box the LOCAL in-process builder cannot actually
      // ship (Reserved-VM RAM/overlayFS/detached-proc limits — it dies and
      // strands a "rendering 0/N — local fallback" zombie card). So a PAT-less
      // farm request must fail LOUD here rather than start a doomed local render.
      // The orchestrator turns this FAIL into a clean alert email + failed card.
      fail(
        "BWB_RENDER_BACKEND=github but no GITHUB_PERSONAL_ACCESS_TOKEN_2/GITHUB_TOKEN is set in the deployment. " +
          "The local in-process builder cannot render in the published prod box, so refusing to start a doomed render " +
          "(it would die and leave a zombie /jobs card). Set the GitHub PAT secret in the deployment env, " +
          "or run the recap on the dev workspace.",
      );
    }
    console.warn(
      "[build-bwb-weekly] BWB_RENDER_BACKEND=github but no GITHUB_PERSONAL_ACCESS_TOKEN_2/GITHUB_TOKEN — falling back to the LOCAL builder (dev workspace).",
    );
    useGithub = false;
  }
  let renderScript = useGithub ? "scripts/bwb-render-github.ts" : "scripts/build-bwb-video.ts";

  // Run a render backend as a child process, CAPTURING its output (instead of a
  // bare `stdio:"inherit"`) so that (a) a silent/early crash leaves a quotable
  // reason on the /jobs card + the alert email, and (b) we can decide whether to
  // auto-fall back. We still forward the full transcript to our own stdout/stderr
  // so the orchestrator's capture + the prod logs keep everything. spawnSync
  // blocks exactly like the old inherit path did; live status is carried by the
  // DB progress card (setBwbPhase / the heartbeat), not stdout, so nothing
  // user-facing regresses. The weekly recap is narrated in Bob's OWN Fish voice
  // clone (not the default "onyx" mapping) unless BWB_VOICE is pinned.
  const runRender = (script: string): { code: number; out: string } => {
    const res = spawnSync("npx", ["tsx", script], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...sanitizeSpawnEnv(process.env),
        SCRIPT: outPath,
        // Share the resume manifest with the render backend (per-scene image-bake,
        // render + deliver checkpoints land under the SAME job key).
        BWB_JOB_KEY: jobKey,
        BWB_VOICE: process.env.BWB_VOICE || FISH_VOICE_BOB_DIRECT,
        // Only the GitHub backend gates delivery on DELIVER=true; the local
        // in-process builder always delivers + writes the same result sidecar.
        ...(script.includes("bwb-render-github") ? { DELIVER: "true" } : {}),
      },
    });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    const out = [
      res.error ? `spawn error: ${res.error.message}` : "",
      res.stderr || "",
      res.stdout || "",
    ]
      .join("\n")
      .trim();
    return { code: res.status ?? 1, out };
  };

  // Pull a human reason out of a render child's captured output: prefer an
  // explicit "[gh-render] FAIL:" / "FAIL:" line, else the last non-empty line.
  const renderFailReason = (out: string): string => {
    // Explicit, intentional failure markers win.
    const m = out.match(/(?:\[gh-render\] )?FAIL:\s*([^\n]+)/);
    if (m) return m[1].trim();
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
    // A crashed Node child ends with the version banner ("Node.js v20.20.0"),
    // a bare "^" caret, and `at …` stack frames — NONE of which name the cause.
    // Stripping that noise is what turns the useless "Node.js vX" reason Bob kept
    // seeing into the actual Error line.
    const isNoise = (l: string) =>
      /^Node\.js v\d/.test(l) ||
      /^\s*at\s/.test(l) ||
      /^node:internal\//.test(l) ||
      l === "^" ||
      /^\d+$/.test(l);
    const meaningful = lines.filter((l) => !isNoise(l));
    // Prefer the first explicit error/exception line if present.
    const errLine = meaningful.find((l) =>
      /\b(Error|Exception|ENOENT|EACCES|EIO|ENOMEM|ETIMEDOUT|Cannot find|not found|refus|denied|killed|fatal)\b/i.test(l),
    );
    if (errLine) return errLine.slice(0, 300);
    return (meaningful[meaningful.length - 1] || lines[lines.length - 1] || "").slice(0, 300);
  };

  console.log(
    `[build-bwb-weekly] handing off to ${renderScript} ` +
      `(${useGithub ? "GitHub Actions render farm — parallel chapters" : "local in-process builder"}) …\n`,
  );
  await setBwbPhase(
    useGithub ? "Rendering chapters on the GitHub farm" : "Rendering locally (in-process)",
  );
  let { code, out } = runRender(renderScript);
  let farmReason = "";
  const inProd = isProductionRuntime();

  // RESILIENCE (Bob 2026-06-07, revised): how we recover from a failed GitHub
  // render-farm handoff depends on WHERE we run — because the local in-process
  // builder behaves completely differently in the two environments:
  //   • DEV workspace: the local builder CAN actually render (the box has the
  //     RAM/CPU and the process survives), so a one-hop local fallback ships a
  //     slower-but-real recap. Keep it.
  //   • PUBLISHED PROD: the local builder does NOT ship — it dies under the
  //     Reserved-VM RAM/overlayFS/detached-proc limits, which is the EXACT
  //     "rendering 0/N — local fallback" ZOMBIE card Bob hit. So in prod we do
  //     NOT fall to local. Instead we RETRY the farm once (transient dispatch /
  //     5xx handoff failures are the common prod cause), and if it still fails we
  //     fail LOUD — the orchestrator turns that into a clean alert email + a
  //     failed /jobs card (real recovery the system surfaces, not a zombie).
  // Opt out of the local hop entirely (even in dev) with BWB_NO_LOCAL_FALLBACK=1.
  if (code !== 0 && useGithub) {
    // Preserve the FARM's real reason — it is the primary failure. Losing it is
    // why every alert used to read "render failed — Node.js vX" with no cause.
    farmReason = renderFailReason(out) || `farm backend exited ${code}`;
    if (inProd) {
      console.error(
        `[build-bwb-weekly] GitHub render farm failed (exit ${code}) — ${farmReason}; ` +
          `retrying the farm once (prod: the local fallback is disabled — it would die on the Reserved VM and strand a zombie card).`,
      );
      await setBwbPhase("Render farm failed — retrying the farm");
      ({ code, out } = runRender(renderScript));
      if (code !== 0) farmReason = renderFailReason(out) || farmReason;
    } else if (process.env.BWB_NO_LOCAL_FALLBACK !== "1") {
      console.error(
        `[build-bwb-weekly] GitHub render farm failed (exit ${code}) — ${farmReason}; ` +
          `falling back to the LOCAL in-process builder (dev workspace).`,
      );
      await setBwbPhase("Render farm failed — rendering locally (fallback)");
      renderScript = "scripts/build-bwb-video.ts";
      ({ code, out } = runRender(renderScript));
    }
  }

  clearInterval(heartbeat);

  // Surface a clean, quotable reason on a render failure so the orchestrator's
  // "[build-bwb-weekly] FAIL:" extractor lights up the /jobs card + alert email
  // with the REAL cause instead of an unrelated stdout tail (the bug Bob hit).
  if (code !== 0) {
    const localWhy = renderFailReason(out) || `render backend exited ${code}`;
    let reason: string;
    if (farmReason && renderScript.includes("bwb-render-github")) {
      // We stayed on the farm (prod retried it once; or BWB_NO_LOCAL_FALLBACK).
      // The farm reason IS the cause — do NOT mislabel it as a "local fallback".
      reason = `GitHub render farm failed${inProd ? " twice (after one retry)" : ""}: ${farmReason}`;
    } else if (farmReason) {
      // Dev path: the farm failed, then the local fallback builder failed too.
      reason = `GitHub render farm: ${farmReason}  ||  local fallback (${renderScript}): ${localWhy}`;
    } else {
      reason = `render failed (${renderScript}) — ${localWhy}`;
    }
    console.error(`[build-bwb-weekly] FAIL: ${reason}`);
    process.exit(code);
  }
  // Mark the live progress card DONE from the render backend's result sidecar
  // (both backends write data/youtube/scripts/<videoId>.result.json). A non-zero
  // exit leaves the row "rendering" — the orchestrator's fail-closed handler
  // marks it failed, and the 20-min reaper is the final backstop. completeBwbJob
  // is a no-op when BWB_JOB_ID is unset (manual CLI runs).
  if (code === 0) {
    const resultPath = path.join("data/youtube/scripts", `${script.videoId}.result.json`);
    // A zero exit with NO result sidecar means the render backend reported success
    // but produced nothing deliverable. Do NOT mark the row done (that would be a
    // false "ready to watch"); exit non-zero so the orchestrator's failBwbJob fires
    // and the row reflects the real failure.
    if (!fs.existsSync(resultPath)) {
      console.error(`[build-bwb-weekly] render exited 0 but no result sidecar at ${resultPath} — treating as failure.`);
      process.exit(2);
    }
    try {
      const sidecar = JSON.parse(fs.readFileSync(resultPath, "utf8"));
      const filePath: string | null = sidecar.filePath || null;
      const finalDriveUrl: string | null = sidecar.driveViewUrl || sidecar.publicPlayLink || null;
      await completeBwbJob({ filePath, finalDriveUrl, title: script.title });
    } catch (e: any) {
      console.warn(`[build-bwb-weekly] could not finalize progress row: ${e?.message || e}`);
    }
  }
  process.exit(code);
}

// Only run when invoked directly (so importing findWeightViolations for tests
// doesn't kick off the whole build).
const isMain = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (isMain) main().catch((e) => fail(e?.message || String(e)));
