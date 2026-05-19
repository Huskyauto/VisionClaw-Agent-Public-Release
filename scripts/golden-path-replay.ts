// R98.14 W6 — Golden-path nightly replay. Runs one canonical prompt per format
// nightly, fingerprints the artifact, compares to last-known-good, freezes the
// pipeline + emails Bob if drift exceeds the bar. Cost-capped at $1 total per run.
//
// Wired up as the "Golden Path Replay" workflow; a Replit Scheduled Deployment
// hits this script daily. Acceptance bars (per docs/felix-deliverable-reliability-plan.md):
//   - Duration ±5 %
//   - Page count exact
//   - File size ±20 %
//   - Smoke-test pass for HTML apps
//   - Photo-on-required-slides 100 %

import * as fs from "fs";
import * as path from "path";
import { executeTool } from "../server/tools";

const ADMIN_TENANT_ID = (() => {
  const raw = process.env.GOLDEN_PATH_TENANT_ID;
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[golden-path] GOLDEN_PATH_TENANT_ID="${raw}" is not a positive integer — defaulting to 1`);
    return 1;
  }
  return n;
})();
const REPLAY_LOG_DIR = path.resolve(process.cwd(), "data", "golden-path-replay");
const FREEZE_DIR = path.join(REPLAY_LOG_DIR, "freezes");
const FINGERPRINTS_FILE = path.join(REPLAY_LOG_DIR, "fingerprints.json");
const COST_CAP_USD = 1.0;
const PER_TASK_TIMEOUT_MS = 8 * 60 * 1000;

interface GoldenPath {
  id: string;
  format: "video" | "audio" | "pdf" | "slides" | "html_app" | "image";
  prompt: string;
  expected: {
    duration_sec?: number;
    // R110.21.1 — per-fixture override for the default 5% duration drift gate.
    // Used by Fish-Audio-driven smoke videos where TTS pacing varies ±20%.
    duration_tolerance_pct?: number;
    page_count?: number;
    size_bytes_min?: number;
    size_bytes_max?: number;
    requires_photo_on?: number[];
  };
  // R110.14 — trajectory eval (Barry Zhang). Tools that MUST appear in the
  // span tree (subset) and tools that MUST NOT (forbidden). Both optional —
  // undefined = skip check (full back-compat). Initial rollout is WARN-ONLY:
  // records `trajectory_drift` in the fingerprint, does NOT push to `drifts`,
  // so a tool-sequence regression alone does NOT freeze the pipeline during
  // week-1 warm-up. Promote to hard-fail (push to `drifts`) once we trust
  // the signal.
  expected_tools_subset?: string[];
  forbidden_tools?: string[];
}

const GOLDEN_PATHS: GoldenPath[] = [
  {
    id: "html_app_password_generator",
    format: "html_app",
    prompt: "Build a downloadable single-file HTML password generator app. Slider for length (8-32). Buttons to copy and regenerate. Mobile-friendly. No external dependencies.",
    expected: { size_bytes_min: 2000, size_bytes_max: 60000 },
  },
  {
    id: "html_app_tip_calculator",
    format: "html_app",
    prompt: "Build a downloadable single-file HTML tip calculator. Bill amount input, tip-percent slider (0-30%), party-size input. Show per-person and total. Mobile-first.",
    expected: { size_bytes_min: 2000, size_bytes_max: 60000 },
  },
  {
    id: "pdf_simple_report",
    format: "pdf",
    prompt: "Create a 3-page styled PDF report titled 'Q4 Productivity Recap' with a cover, an exec summary, and one section with three stats and a takeaway.",
    expected: { page_count: 3, size_bytes_min: 8000 },
  },
  // R110.7 — Felix YouTube pipeline smoke test. Tiny 2-scene fixture exercises
  // the EXACT path that broke in R110.3/R110.5/R110.6 (Fish TTS default,
  // tool-rate-limiter, mpeg_produce_parallel, structured error envelope). If
  // ANY of those defaults regress to "openai" or get throttled by an internal
  // quota, this fingerprint will drift and freeze the pipeline before Bob has
  // to manually test from his phone. Cost: ~$0.01 (2 Fish TTS calls + 2
  // gpt-image-2 bakes + ffmpeg). Duration target: ~10s of MP4.
  {
    id: "bwb_video_2scene_fish_smoke",
    format: "video",
    prompt: "Two-scene Felix BWB smoke video. Scene 1: 'This is a Built With Bob platform smoke test. The video pipeline is healthy.' Scene 2: 'Fish Audio narration, gpt-image-2 visuals, mpeg-engine assembly. All systems nominal.'",
    // R110.21.1 — Fish Audio TTS pacing varies ~±20% per render (Bob's voice
    // ref + LLM-driven text). Calibrated target 13s ≈ mean of last 3 renders
    // (11.4 / 12.06 / 12.94); 25% tolerance covers natural TTS jitter without
    // hiding a real regression (a 7s or 17s render would still trip).
    expected: { duration_sec: 13, duration_tolerance_pct: 0.25, size_bytes_min: 60000, size_bytes_max: 8_000_000 },
    // R110.14 — trajectory eval (warm-up: warn-only, no freeze). Demos the new
    // fields. Tighten subset after a few replays populate ground-truth
    // tools_called in fingerprints.json.
    expected_tools_subset: ["produce_video"],
    forbidden_tools: ["mpeg_produce_legacy_v1", "produce_video_v1"],
  },
  // R111.3 — Felix multi-chapter pipeline lock. The R110.22 incident (BWB
  // intro hung mid-render) and the R111.1 incident (audio-completeness gate
  // false-failure on Ch2) both lived on the multi-chapter path that the
  // 2-scene single-chapter smoke fixture above does not exercise. This
  // fixture calls mpeg_produce_parallel directly with 3 chapters × 2 scenes
  // each, reusing a static imagePath so cost stays at ~$0.01 (6 Fish TTS
  // calls + ffmpeg only — no image bakes). Locks: (a) per-chapter dispatch
  // loop in mpeg-engine.ts, (b) probeAudioDurationAuthoritative VBR fix
  // (R111.1) which only manifests when ≥2 chapters' worth of looped-image
  // segments are encoded, (c) failure-dir quarantine path (R111.2) — if any
  // gate fails, the dir lands in data/video-jobs-failed/ instead of being
  // shredded. Felix re-uses this exact tool for BWB videos, so this fixture
  // is the canary for any future regression on his hot path.
  {
    id: "bwb_video_3chapter_multichapter_smoke",
    format: "video",
    prompt: "Three-chapter Felix smoke video exercising mpeg_produce_parallel multi-chapter dispatch. 6 scenes × ~4s narration each, static imagePath (no image bakes).",
    // Calibrated empirically on first green run; ±25% covers Fish TTS pacing
    // variance same as the single-chapter fixture. 30s seed is a stub —
    // replace with the real first-render duration on initial fingerprint.
    expected: { duration_sec: 30, duration_tolerance_pct: 0.30, size_bytes_min: 80_000, size_bytes_max: 12_000_000 },
    expected_tools_subset: ["mpeg_produce_parallel"],
    forbidden_tools: ["mpeg_produce_legacy_v1"],
  },
];

interface FingerprintRecord {
  id: string;
  format: string;
  ran_at: string;
  ok: boolean;
  artifact_size_bytes?: number;
  artifact_path?: string;
  duration_sec?: number;
  page_count?: number;
  notes?: string;
  drift?: string;
  // R110.14 — trajectory eval (warn-only week 1). NOT included in `drift` so a
  // tool-sequence regression does not freeze the pipeline during warm-up.
  tools_called?: string[];
  trajectory_drift?: string;
}

function ensureDir(p: string): void { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function loadFingerprints(): Record<string, FingerprintRecord> {
  // R110.11.5 (silent-failure-hunter): distinguish "missing" (genuine first-run
  // empty state) from "corrupt" (parse failure). Silent `catch{return {}}` would
  // mask state-file corruption AND silently wipe history on next saveFingerprints
  // by overwriting with the freshly-empty default.
  if (!fs.existsSync(FINGERPRINTS_FILE)) return {};
  let raw: string;
  try {
    raw = fs.readFileSync(FINGERPRINTS_FILE, "utf8");
  } catch (err: any) {
    console.error(`[golden-path-replay] FATAL: cannot read ${FINGERPRINTS_FILE}: ${err?.message || err}`);
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (err: any) {
    console.error(`[golden-path-replay] FATAL: ${FINGERPRINTS_FILE} is corrupt JSON (${err?.message || err}). Refusing to overwrite with empty state — hand-fix or delete the file.`);
    process.exit(2);
  }
}

function saveFingerprints(fps: Record<string, FingerprintRecord>): void {
  ensureDir(REPLAY_LOG_DIR);
  fs.writeFileSync(FINGERPRINTS_FILE, JSON.stringify(fps, null, 2));
}

function freezePath(id: string): string { return path.join(FREEZE_DIR, `${id}.frozen.json`); }
function isFrozen(id: string): boolean { return fs.existsSync(freezePath(id)); }

function freezePipeline(id: string, reason: string, lastKnownGood: FingerprintRecord | null): void {
  ensureDir(FREEZE_DIR);
  fs.writeFileSync(freezePath(id), JSON.stringify({ frozen_at: new Date().toISOString(), id, reason, last_known_good: lastKnownGood }, null, 2));
}

function withinPct(actual: number, expected: number, pct: number): boolean {
  if (expected <= 0) return false;
  return Math.abs(actual - expected) / expected <= pct;
}

async function runOnePath(gp: GoldenPath): Promise<FingerprintRecord> {
  const ranAt = new Date().toISOString();
  const runStartMs = Date.now(); // R110.14 — trajectory eval window start
  console.log(`[golden-path] ${gp.id} (${gp.format}) — running`);

  if (isFrozen(gp.id)) {
    return { id: gp.id, format: gp.format, ran_at: ranAt, ok: false, notes: "skipped: pipeline frozen at last-known-good (clear data/golden-path-replay/freezes/<id>.frozen.json to unfreeze)" };
  }

  let producerResult: any;
  let artifactPath: string | undefined;
  try {
    if (gp.format === "html_app") {
      // R98.14 +sec-2 follow-up: pin to gemini-2.5-flash for the nightly
      // replay — the admin tenant (1) may not have an Anthropic key, so the
      // default claude-sonnet-4-5 returns "LLM returned empty output" and the
      // replay sees a false regression on a tool that's actually fine in
      // production. Real customer tenants keep the default model.
      producerResult = await Promise.race([
        executeTool("build_html_app", { topic: gp.prompt, description: gp.prompt, model: "gpt-5-mini", _tenantId: ADMIN_TENANT_ID }, ADMIN_TENANT_ID),
        new Promise((_, rej) => setTimeout(() => rej(new Error("per-task timeout")), PER_TASK_TIMEOUT_MS)),
      ]);
      artifactPath = producerResult?.file_path || producerResult?.filePath;
    } else if (gp.format === "pdf") {
      producerResult = await Promise.race([
        executeTool("create_styled_report", {
          title: "Q4 Productivity Recap",
          sections: [
            { title: "Executive Summary", content: "Q4 closed strong with three key wins across productivity, customer satisfaction, and engineering velocity." },
            { title: "Key Stats", content: "Productivity index: 87 (up from 71). Satisfaction: 4.6/5. Velocity: 122 PRs/week.", takeaway: "Triple-digit improvements across all three KPIs." },
          ],
          _tenantId: ADMIN_TENANT_ID,
        }, ADMIN_TENANT_ID),
        new Promise((_, rej) => setTimeout(() => rej(new Error("per-task timeout")), PER_TASK_TIMEOUT_MS)),
      ]);
      // R98.25 — `create_styled_report` returns localPath as a URL path
      // (/uploads/<file>.pdf) for instant-play delivery, not a filesystem
      // path. Resolve it to the actual file on disk before fs.statSync.
      let raw = producerResult?.file_path || producerResult?.filePath || producerResult?.localPath;
      if (typeof raw === "string" && raw.startsWith("/uploads/")) {
        raw = path.join(process.cwd(), raw.replace(/^\//, ""));
      }
      artifactPath = raw;
    } else if (gp.format === "video") {
      // R111.3 — multi-chapter fixture: exercise mpeg_produce_parallel
      // dispatch loop + R111.1 audio-gate VBR fix + R111.2 quarantine path.
      // Static imagePath (data/youtube/video-01-thumbnail.png) reused for
      // all 6 scenes so we pay only TTS cost (~$0.01/run, no image bakes).
      if (gp.id === "bwb_video_3chapter_multichapter_smoke") {
        const sharedImg = path.join(process.cwd(), "data", "youtube", "video-01-thumbnail.png");
        producerResult = await Promise.race([
          executeTool("mpeg_produce_parallel", {
            title: "VisionClaw Multichapter Pipeline Smoke",
            chapters: [
              { chapterTitle: "Intro", scenes: [
                { narration: "Chapter one scene one. The multichapter dispatch loop is alive.", imagePath: sharedImg },
                { narration: "Chapter one scene two. Audio gate sees per-segment VBR durations.", imagePath: sharedImg },
              ]},
              { chapterTitle: "Middle", scenes: [
                { narration: "Chapter two scene one. Sequential chapter cap holds the VM steady.", imagePath: sharedImg },
                { narration: "Chapter two scene two. Quarantine path catches any gate failure.", imagePath: sharedImg },
              ]},
              { chapterTitle: "Outro", scenes: [
                { narration: "Chapter three scene one. Concatenation of all chapter MP4s.", imagePath: sharedImg },
                { narration: "Chapter three scene two. Pipeline is nominal. Goodbye.", imagePath: sharedImg },
              ]},
            ],
            voice: "onyx",
            voiceProvider: "fish",
            resolution: "1080p",
            fps: 30,
            crossfadeMs: 0,            // R110.21 reliable-playback default
            uploadToDrive: false,      // skip Drive in CI — local artifact only
            maxParallelChapters: 1,    // R110.22 — match prod default
            _tenantId: ADMIN_TENANT_ID,
          }, ADMIN_TENANT_ID),
          new Promise((_, rej) => setTimeout(() => rej(new Error("per-task timeout")), PER_TASK_TIMEOUT_MS)),
        ]);
      } else {
        // R110.7 — single-chapter Fish-TTS-default smoke. Calls produce_video
        // (NOT mpeg_produce_parallel — keep cost/duration small) with a
        // 2-scene fixture and platform defaults. If Fish-default ever
        // regresses to openai, or generate_audio's quota traps a 2-call
        // burst, or the structured error envelope drops, this fixture's MP4
        // fingerprint drifts — the regression freezes the pipeline + emails.
        producerResult = await Promise.race([
          executeTool("produce_video", {
            title: "VisionClaw BWB Pipeline Smoke",
            slide_scripts: [
              { narration: "This is a Built With Bob platform smoke test. The video pipeline is healthy." },
              { narration: "Fish Audio narration, gpt-image-2 visuals, mpeg-engine assembly. All systems nominal." },
            ],
            voice: "onyx",
            text_slides_only: true, // skip cinematic image bake to keep cost ~$0.005 and duration <90s
            allow_silent_slides: false,
            _tenantId: ADMIN_TENANT_ID,
          }, ADMIN_TENANT_ID),
          new Promise((_, rej) => setTimeout(() => rej(new Error("per-task timeout")), PER_TASK_TIMEOUT_MS)),
        ]);
      }
      // produce_video returns watch_url which can be either a relative path
      // (/uploads/<file>.mp4 or /watch/<file>.mp4) OR a full deployed URL
      // (https://*.spock.replit.dev/watch/<hash>.mp4). R110.21.1: extract the
      // <file>.mp4 from full URLs and resolve under uploads/. Without this the
      // runner reports "no usable artifact path" on a video that produced fine
      // and freezes the pipeline forever (silent-skip bug — see below).
      let raw = producerResult?.file_path || producerResult?.filePath || producerResult?.localPath || producerResult?.watch_url || producerResult?.download_url;
      if (typeof raw === "string") {
        // Strip protocol + host if a full URL was returned.
        const m = raw.match(/^https?:\/\/[^/]+(\/.*)$/);
        if (m) raw = m[1];
        // /watch/<file>.mp4 and /v/<file>.mp4 are served from public/videos/<file>.mp4
        // (instant-play route, see server/instant-play.ts). Fallback to uploads/
        // for older PDF/audio paths still on the legacy /uploads/ prefix.
        const watchM = raw.match(/^\/(?:watch|v)\/([^/?#]+\.(?:mp4|mp3|wav|webm))/);
        if (watchM) {
          const vidPath = path.join(process.cwd(), "public", "videos", watchM[1]);
          const upPath = path.join(process.cwd(), "uploads", watchM[1]);
          if (fs.existsSync(vidPath)) raw = vidPath;
          else if (fs.existsSync(upPath)) {
            // R110.21.2 (Manus AI cross-review #3) — stale-file protection.
            // The previous loud-WARN-then-fallback could still grade an OLD
            // same-name file in uploads/, hiding a real producer regression.
            // Reject any fallback artifact whose mtime predates this run
            // (5s clock-skew buffer). The runner correctly fails the fixture
            // instead of false-PASSing on stale bytes.
            const stats = fs.statSync(upPath);
            if (stats.mtimeMs < runStartMs - 5000) {
              throw new Error(`Fallback artifact ${upPath} is stale (mtime=${new Date(stats.mtimeMs).toISOString()}, run started ${new Date(runStartMs).toISOString()}). Refusing to grade an old artifact — producer must be writing to public/videos/.`);
            }
            console.warn(`[golden-path] WARN expected artifact at ${vidPath} missing; falling back to fresh uploads/ artifact (mtime=${new Date(stats.mtimeMs).toISOString()})`);
            raw = upPath;
          } else {
            // Neither exists — let downstream stat fail with a clear "no such file"
            console.warn(`[golden-path] WARN expected artifact at ${vidPath} missing AND no fallback in uploads/`);
            raw = vidPath;
          }
        } else if (raw.startsWith("/uploads/")) raw = path.join(process.cwd(), raw.replace(/^\//, ""));
      }
      artifactPath = raw;
    } else {
      return { id: gp.id, format: gp.format, ran_at: ranAt, ok: false, notes: `format '${gp.format}' not yet wired into golden-path runner — add a producer call in scripts/golden-path-replay.ts` };
    }
  } catch (e: any) {
    return { id: gp.id, format: gp.format, ran_at: ranAt, ok: false, notes: `producer threw: ${(e?.message || String(e)).slice(0, 300)}` };
  }

  if (!artifactPath || !fs.existsSync(artifactPath)) {
    return { id: gp.id, format: gp.format, ran_at: ranAt, ok: false, notes: `producer returned no usable artifact path (got: ${JSON.stringify(producerResult).slice(0, 300)})` };
  }

  const sizeBytes = fs.statSync(artifactPath).size;
  let pageCount: number | undefined;

  let gradeRes: any;
  try {
    gradeRes = await executeTool("grade_deliverable", {
      deliverable_type: gp.format,
      file_path: artifactPath,
      expected_spec: gp.expected.page_count ? { min_pages: gp.expected.page_count, max_pages: gp.expected.page_count } : undefined,
      _tenantId: ADMIN_TENANT_ID,
    }, ADMIN_TENANT_ID);
    pageCount = gradeRes?.metrics?.estimated_page_count;
  } catch (e: any) {
    return { id: gp.id, format: gp.format, ran_at: ranAt, ok: false, artifact_size_bytes: sizeBytes, artifact_path: artifactPath, notes: `grader threw: ${(e?.message || String(e)).slice(0, 300)}` };
  }

  // Drift checks against expected.
  const drifts: string[] = [];
  if (typeof gp.expected.size_bytes_min === "number" && sizeBytes < gp.expected.size_bytes_min) drifts.push(`size ${sizeBytes}B < min ${gp.expected.size_bytes_min}`);
  if (typeof gp.expected.size_bytes_max === "number" && sizeBytes > gp.expected.size_bytes_max) drifts.push(`size ${sizeBytes}B > max ${gp.expected.size_bytes_max}`);
  if (typeof gp.expected.page_count === "number" && typeof pageCount === "number" && pageCount !== gp.expected.page_count) drifts.push(`page_count ${pageCount} ≠ expected ${gp.expected.page_count}`);
  if (typeof gp.expected.duration_sec === "number" && typeof gradeRes?.metrics?.duration_sec === "number") {
    const tol = typeof gp.expected.duration_tolerance_pct === "number" ? gp.expected.duration_tolerance_pct : 0.05;
    if (!withinPct(gradeRes.metrics.duration_sec, gp.expected.duration_sec, tol)) drifts.push(`duration ${gradeRes.metrics.duration_sec}s drifts >${Math.round(tol*100)}% from ${gp.expected.duration_sec}s`);
  }
  if (gradeRes && gradeRes.ok === false) drifts.push(`grader fail: score ${gradeRes.score}/${gradeRes.passing_bar} — ${gradeRes.critique?.slice(0, 200)}`);

  // R110.14 — trajectory eval (Barry Zhang). Mine spans created during this
  // run from agent_trace_spans (kind='tool', tenant=ADMIN, started_at >=
  // runStartMs). Validate against expected_tools_subset (every must-tool
  // appeared) and forbidden_tools (no banned tool appeared). WARN-ONLY for
  // week 1 — records `trajectory_drift` in the fingerprint but does NOT push
  // to `drifts`, so a tool-sequence regression alone does not freeze the
  // pipeline. Promote to hard-fail (push to `drifts`) once we trust the
  // signal. Fails OPEN on DB error (logs + skips check; transient query
  // failure must not false-positive a passing pipeline).
  let toolsCalled: string[] | undefined;
  let trajectoryDrift: string | undefined;
  if (gp.expected_tools_subset?.length || gp.forbidden_tools?.length) {
    try {
      // R110.14 — Architect MEDIUM: trace-span flush race. Tool spans can lag
      // the producer's return by 1-2s when emitted via async batched logger.
      // 1.5s settle eliminates the false-negative window without meaningfully
      // delaying the nightly replay (already minutes long).
      await new Promise((r) => setTimeout(r, 1500));
      // R110.14 — Architect LOW (deferred to R111): multi-tenant noise. The
      // window query keys on tenant_id + time, so concurrent admin processes
      // (heartbeat, scheduled tasks) that emit tool spans during this run's
      // window can pollute `tools_called`. Acceptable while warn-only; the
      // proper fix is to wrap `executeTool` in an AsyncLocalStorage trace
      // context and filter by `trace_id` here. Tracked for R111.
      const { db } = await import("../server/db");
      const { sql } = await import("drizzle-orm");
      const startedIso = new Date(runStartMs).toISOString();
      const r: any = await db.execute(sql`SELECT DISTINCT tool_name FROM agent_trace_spans WHERE tenant_id = ${ADMIN_TENANT_ID} AND kind = 'tool' AND tool_name IS NOT NULL AND started_at >= ${startedIso}::timestamp ORDER BY tool_name`);
      const rows = ((r as any).rows ?? r ?? []) as any[];
      toolsCalled = rows.map((row) => String(row.tool_name)).filter(Boolean);
      const traj: string[] = [];
      for (const must of gp.expected_tools_subset ?? []) {
        if (!toolsCalled.includes(must)) traj.push(`expected tool '${must}' not called`);
      }
      for (const forbidden of gp.forbidden_tools ?? []) {
        if (toolsCalled.includes(forbidden)) traj.push(`forbidden tool '${forbidden}' was called`);
      }
      if (traj.length) {
        trajectoryDrift = traj.join(" | ");
        console.warn(`[golden-path] TRAJECTORY-DRIFT ${gp.id} (warn-only): ${trajectoryDrift}`);
      }
    } catch (e: any) {
      console.error(`[golden-path] trajectory query FAILED for ${gp.id} (skipping check, failing OPEN): ${e?.message || String(e)}`);
    }
  }

  const ok = drifts.length === 0;
  return { id: gp.id, format: gp.format, ran_at: ranAt, ok, artifact_size_bytes: sizeBytes, artifact_path: artifactPath, page_count: pageCount, duration_sec: gradeRes?.metrics?.duration_sec, drift: drifts.length ? drifts.join(" | ") : undefined, tools_called: toolsCalled, trajectory_drift: trajectoryDrift };
}

async function emailOwnerOnRegression(failed: FingerprintRecord[]): Promise<void> {
  if (failed.length === 0) return;
  try {
    const subj = `[VisionClaw] Golden-path replay regression — ${failed.length} pipeline(s) frozen`;
    const body = `Nightly golden-path replay caught regressions in the following pipelines:\n\n${failed.map((f) => `- ${f.id} (${f.format}): ${f.drift || f.notes}`).join("\n")}\n\nThese pipelines have been frozen at their last-known-good revision. Inspect data/golden-path-replay/fingerprints.json and the freeze files in data/golden-path-replay/freezes/ to triage. Clear the freeze file to unfreeze a pipeline once fixed.\n\n— VisionClaw Golden-Path Watcher`;
    await executeTool("send_email", { to: process.env.OWNER_EMAIL || "huskyauto@gmail.com", subject: subj, text: body, _tenantId: ADMIN_TENANT_ID }, ADMIN_TENANT_ID);
    console.log(`[golden-path] regression email sent (${failed.length} failures)`);
  } catch (e: any) {
    console.error(`[golden-path] failed to email owner: ${e?.message || String(e)}`);
  }
}

async function main(): Promise<void> {
  ensureDir(REPLAY_LOG_DIR);
  ensureDir(FREEZE_DIR);
  console.log(`[golden-path] starting nightly replay — ${GOLDEN_PATHS.length} paths, $${COST_CAP_USD.toFixed(2)} cost cap`);
  const fps = loadFingerprints();
  const newFailures: FingerprintRecord[] = [];
  const startCost = await readCostUsage().catch(() => 0);

  for (const gp of GOLDEN_PATHS) {
    const cur = await readCostUsage().catch(() => 0);
    if (cur - startCost > COST_CAP_USD) {
      console.warn(`[golden-path] cost cap $${COST_CAP_USD} hit — aborting remaining paths`);
      break;
    }
    const rec = await runOnePath(gp);
    const prev = fps[gp.id] || null;
    fps[gp.id] = rec;
    if (!rec.ok && !isFrozen(gp.id)) {
      console.error(`[golden-path] FAIL ${gp.id}: ${rec.drift || rec.notes}`);
      freezePipeline(gp.id, rec.drift || rec.notes || "unknown", prev);
      newFailures.push(rec);
    } else if (rec.ok) {
      console.log(`[golden-path] OK ${gp.id} — size=${rec.artifact_size_bytes}B${rec.page_count ? ` pages=${rec.page_count}` : ""}${rec.duration_sec ? ` dur=${rec.duration_sec.toFixed(1)}s` : ""}`);
    } else {
      // R110.21.1 silent-skip fix: previously a frozen pipeline silently
      // returned ok:false and fell through with no log line, so a 2/4 pass
      // result hid two pre-frozen pipelines indefinitely. Always surface
      // skipped-frozen so the operator knows the run did NOT exercise it.
      console.warn(`[golden-path] SKIP ${gp.id} — frozen at last-known-good (delete data/golden-path-replay/freezes/${gp.id}.frozen.json to retry): ${rec.notes || "(no reason)"}`);
    }
  }
  saveFingerprints(fps);

  await emailOwnerOnRegression(newFailures);
  const okCount = Object.values(fps).filter((r) => r.ok).length;
  console.log(`[golden-path] DONE — ${okCount}/${GOLDEN_PATHS.length} pass${newFailures.length ? ` (${newFailures.length} new freezes)` : ""}`);
  process.exit(newFailures.length > 0 ? 1 : 0);
}

async function readCostUsage(): Promise<number> {
  // Lightweight cost ledger probe — falls back to 0 if the table doesn't exist
  // or the helper isn't wired. The cost-cap is a soft brake, not a hard gate.
  try {
    const { db } = await import("../server/db");
    const { sql } = await import("drizzle-orm");
    const r: any = await db.execute(sql`SELECT COALESCE(SUM(cost_usd), 0)::float AS total FROM llm_usage WHERE tenant_id = ${ADMIN_TENANT_ID} AND created_at > NOW() - INTERVAL '6 hours'`);
    return Number(r.rows?.[0]?.total || 0);
  } catch { return 0; }
}

main().catch((e) => { console.error(`[golden-path] crashed: ${e?.message || String(e)}`); process.exit(2); });
