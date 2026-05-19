/**
 * Built With Bob — reusable end-to-end video builder.
 *
 * Usage:
 *   SCRIPT=data/youtube/scripts/video-NN.json npx tsx scripts/build-bwb-video.ts
 *
 * Pipeline:
 *   1. Validate script JSON against brand rules (no spoken URLs, valid playlist, etc.)
 *   2. Pre-bake scene images via internal generate_image (gpt-image-2 routing)
 *   3. Render MP4 via produceVideoParallel (1080p/30fps/onyx, faststart, hard cuts)
 *   4. Generate thumbnail (if thumbnailPrompt provided)
 *   5. Register final MP4 + thumbnail in project_files (project 16)
 *   6. Deliver via deliverDigitalProduct (signed self-hosted link + Drive backup)
 *   7. Print everything Felix needs to upload to YouTube
 *
 * This script honors every HARD RULE in replit.md and the
 * built-with-bob-video-production skill. Do NOT roll your own pipeline.
 */
import fs from "node:fs";
import path from "node:path";
import { generateImage } from "../server/replit_integrations/image/client";
import { produceVideoParallel, type ChapterSpec } from "../server/mpeg-engine";
import { deliverDigitalProduct } from "../server/delivery-pipeline";
import { pool } from "../server/db";

// generateImage always returns "data:<mime>;base64,<b64>" — never a file path.
// Decode and write to disk so we can pass imagePath into produceVideoParallel.
function writeDataUriToFile(dataUri: string, dest: string): void {
  const m = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error(`generateImage returned non-data-URI string (first 80 chars): ${dataUri.slice(0, 80)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(m[2], "base64"));
}

const ALLOWED_PLAYLISTS = [
  "The Protocol",
  "The Build",
  "The Day",
  "The Protocol Shorts",
  "The Build Shorts",
  "The Day Shorts",
];
const PROJECT_ID = 16;
const VOICE = "onyx";
const TITLE_MAX = 60;
const FORBIDDEN_NARRATION_TOKENS = [
  /Manjaro/i,
  /Monjaro/i,
  /\bGLP\b(?!-1)/, // "GLP" without "-1"
];

interface SceneSpec {
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
  scenes: SceneSpec[];
}

function fail(msg: string): never {
  console.error(`\n[build-bwb-video] FAIL: ${msg}\n`);
  process.exit(1);
}

function validate(script: VideoScript): void {
  if (!script.videoId) fail("script.videoId is required");
  if (!ALLOWED_PLAYLISTS.includes(script.playlist))
    fail(`script.playlist must be one of: ${ALLOWED_PLAYLISTS.join(", ")} — got "${script.playlist}"`);
  if (!script.title) fail("script.title is required");
  if (script.title.length > TITLE_MAX)
    fail(`script.title is ${script.title.length} chars; max ${TITLE_MAX}`);
  if (!script.scenes || script.scenes.length === 0) fail("script.scenes must have at least one entry");

  const isShort = script.playlist.endsWith("Shorts");
  script.scenes.forEach((s, i) => {
    if (!s.narration) fail(`scene ${i + 1}: narration is required`);
    if (!s.imagePrompt && !s.imagePath)
      fail(`scene ${i + 1}: must provide either imagePrompt or imagePath`);
    // No spoken URLs / domains. Allow only the brand name "[Your Product]".
    const sanitized = s.narration.replace(/[Your Product]/gi, "");
    const domainHits = sanitized.match(/\b[a-z0-9-]+\.[a-z]{2,}\b/gi);
    if (domainHits)
      fail(`scene ${i + 1}: narration contains spoken URL/domain (${domainHits.join(", ")}). Say "click the link below this video" instead.`);
    for (const re of FORBIDDEN_NARRATION_TOKENS) {
      if (re.test(s.narration))
        fail(`scene ${i + 1}: narration contains forbidden token (${re}). Use "wellness-program" or "wellness".`);
    }
  });

  // Approx duration: 16 chars per second of speech (~150 wpm).
  const totalChars = script.scenes.reduce((n, s) => n + s.narration.length, 0);
  const approxSec = totalChars / 16;
  if (isShort && approxSec > 60)
    fail(`Script estimated ${approxSec.toFixed(0)}s of narration; Shorts cap is 60s.`);
  if (!isShort && approxSec < 60)
    console.warn(`[build-bwb-video] WARNING: estimated ${approxSec.toFixed(0)}s — short for long-form (target 90s-6min).`);
  if (!isShort && approxSec > 360)
    console.warn(`[build-bwb-video] WARNING: estimated ${approxSec.toFixed(0)}s — over 6min target.`);
}

async function bakeImage(prompt: string, dest: string): Promise<void> {
  const result = await generateImage(prompt, {
    purpose: "customer_video_scene",
    isCustomerFacing: true,
    callerLabel: "build-bwb-video",
  });
  // generateImage returns a base64 data URI from every provider in the cascade
  // (gpt-image-2, Gemini, DALL-E 3) — decode to PNG on disk.
  writeDataUriToFile(result, dest);
}

async function main() {
  const scriptPath = process.env.SCRIPT;
  if (!scriptPath) fail("SCRIPT env var required (path to script JSON)");
  if (!fs.existsSync(scriptPath!)) fail(`script not found: ${scriptPath}`);

  const script: VideoScript = JSON.parse(fs.readFileSync(scriptPath!, "utf8"));
  console.log(`[build-bwb-video] Loaded ${scriptPath} — ${script.videoId} / ${script.playlist}`);
  validate(script);
  console.log(`[build-bwb-video] Validation OK — ${script.scenes.length} scenes`);

  const isShort = script.playlist.endsWith("Shorts");
  if (isShort) {
    fail(
      "Shorts (9:16 / 1080x1920) are not yet supported by the underlying mpeg engine — " +
      "MpegJobOptions.resolution accepts only \"720p\"|\"1080p\"|\"4k\" and produces 16:9 output. " +
      "Add vertical support to server/mpeg-engine.ts before producing Shorts. " +
      "For now, use a non-Shorts playlist."
    );
  }
  const sceneDir = `data/youtube/scenes/${script.videoId}`;
  fs.mkdirSync(sceneDir, { recursive: true });

  // 1. Pre-bake scene images
  console.log(`[build-bwb-video] Pre-baking ${script.scenes.length} scene images via gpt-image-2 cascade...`);
  for (let i = 0; i < script.scenes.length; i++) {
    const s = script.scenes[i];
    if (s.imagePath) {
      console.log(`  scene ${i + 1}: using existing imagePath ${s.imagePath}`);
      continue;
    }
    const dest = `${sceneDir}/scene-${i + 1}.png`;
    if (fs.existsSync(dest)) {
      console.log(`  scene ${i + 1}: ${dest} already on disk, skipping`);
      s.imagePath = dest;
      continue;
    }
    process.stdout.write(`  scene ${i + 1}: baking... `);
    await bakeImage(s.imagePrompt!, dest);
    s.imagePath = dest;
    console.log(`OK (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
  }

  // 2. Optional thumbnail
  let thumbnailPath: string | null = null;
  if (script.thumbnailPrompt) {
    thumbnailPath = `data/youtube/${script.videoId}-thumbnail.png`;
    if (!fs.existsSync(thumbnailPath)) {
      console.log(`[build-bwb-video] Baking thumbnail via gpt-image-2 cascade...`);
      await bakeImage(script.thumbnailPrompt, thumbnailPath);
    } else {
      console.log(`[build-bwb-video] Thumbnail already on disk: ${thumbnailPath}`);
    }
  }

  // 3. Render via produceVideoParallel — split scenes into chapters of 3 each
  // for parallel rendering (up to 6 chapters concurrently).
  console.log(`[build-bwb-video] Rendering ${script.scenes.length} scenes via produceVideoParallel...`);
  const chapterSize = 3;
  const chapters: ChapterSpec[] = [];
  for (let i = 0; i < script.scenes.length; i += chapterSize) {
    const slice = script.scenes.slice(i, i + chapterSize);
    chapters.push({
      chapterTitle: `chapter${chapters.length + 1}`,
      scenes: slice.map((s) => ({ narration: s.narration, imagePath: s.imagePath! })),
    });
  }
  const t0 = Date.now();
  const result = await produceVideoParallel({
    title: script.videoId,
    chapters,
    voice: VOICE,
    voiceProvider: "fish",
    resolution: "1080p", // mpeg-engine "1080p" === 1920x1080 16:9 (locked format)
    fps: 30,
    crossfadeMs: 0,
    kenBurns: false,
    tenantId: 1,
    maxParallelChapters: 6,
  });
  console.log(`[build-bwb-video] Render ${result.success ? "OK" : "FAILED"} in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.scenesProcessed} scenes`);
  if (!result.success || !result.filePath) fail(`render failed: ${result.error}`);

  // Move/rename to canonical path
  const finalMp4 = `data/youtube/${script.videoId}-${script.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.mp4`;
  if (path.resolve(result.filePath!) !== path.resolve(finalMp4)) {
    fs.copyFileSync(result.filePath!, finalMp4);
  }
  const sizeMB = (fs.statSync(finalMp4).size / 1024 / 1024).toFixed(2);
  console.log(`[build-bwb-video] Final MP4: ${finalMp4} (${sizeMB} MB)`);

  // 4. Register in project_files
  const reg = await pool.query(
    `INSERT INTO project_files (project_id, file_name, file_path, file_type, file_size, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [PROJECT_ID, path.basename(finalMp4), finalMp4, "video/mp4", fs.statSync(finalMp4).size, "build-bwb-video"]
  );
  console.log(`[build-bwb-video] Registered as project_files row ${reg.rows[0].id}`);

  // 5. Deliver via the proper pipeline (signed URL, mobile-friendly streaming)
  console.log(`[build-bwb-video] Delivering...`);
  const delivery = await deliverDigitalProduct({
    customerName: "Bob Washburn",
    customerEmail: "huskyauto@gmail.com",
    productName: `Built With Bob — ${script.title}`,
    filePath: finalMp4,
    fileName: path.basename(finalMp4),
    mimeType: "video/mp4",
    sendEmail: true,
    emailSubject: `${script.videoId} ready — ${script.title}`,
    emailBody: `Video ready for review and YouTube upload.\n\nPlaylist: ${script.playlist}\nLength: ~${(result.durationSeconds || 0).toFixed(0)} seconds\nFile: ${path.basename(finalMp4)}\n\nUse Play to stream on phone, Download to save the MP4 for upload.\n\nYouTube package below — copy/paste into YouTube Studio (or auto-upload via the youtube_upload tool).\n\n— TITLE —\n${script.title}\n\n— DESCRIPTION —\n${script.youtubeDescription}\n\n— TAGS —\n${script.youtubeTags.join(", ")}\n\n— THUMBNAIL —\n${thumbnailPath ? thumbnailPath : "(none — generate manually or rerun with thumbnailPrompt set)"}\n`,
  });

  console.log(`\n========== BUILD COMPLETE ==========`);
  console.log(`Video ID:        ${script.videoId}`);
  console.log(`Playlist:        ${script.playlist}`);
  console.log(`Title:           ${script.title}`);
  console.log(`MP4 path:        ${finalMp4}`);
  console.log(`Size:            ${sizeMB} MB`);
  console.log(`Duration (est):  ${(result.durationSeconds || 0).toFixed(1)}s`);
  console.log(`Thumbnail:       ${thumbnailPath || "(none)"}`);
  console.log(`Delivery ID:     ${delivery.deliveryId}`);
  console.log(`\n--- LINKS ---`);
  console.log(`Play (mobile):   ${delivery.publicPlayLink || "(check email)"}`);
  console.log(`Drive view:      ${delivery.shareableLink}`);
  console.log(`Drive folder:    ${delivery.folderLink}`);
  console.log(`Email sent:      ${delivery.emailSent}`);
  console.log(`====================================\n`);

  if (!process.env.YOUTUBE_REFRESH_TOKEN) {
    console.log(`[build-bwb-video] NOTE: YOUTUBE_REFRESH_TOKEN not set. Run scripts/youtube-oauth-bootstrap.mjs to enable programmatic YouTube upload. For now, upload from the Drive link or the Play link above.`);
  } else {
    console.log(`[build-bwb-video] YOUTUBE_REFRESH_TOKEN present — call the youtube_upload tool with the package above to publish.`);
  }

  return delivery.success ? 0 : 1;
}

main()
  .then(async (code) => {
    try { await pool.end(); } catch { /* already closed */ }
    process.exit(code);
  })
  .catch(async (e) => {
    console.error("[build-bwb-video] UNCAUGHT:", e);
    try { await pool.end(); } catch { /* already closed */ }
    process.exit(2);
  });
