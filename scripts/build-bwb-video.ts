/**
 * Built With Bob — reusable end-to-end video builder.
 *
 * Usage:
 *   SCRIPT=data/youtube/scripts/video-NN.json npx tsx scripts/build-bwb-video.ts
 *
 * Pipeline:
 *   1. Validate script JSON against brand rules (no spoken URLs, valid playlist, etc.)
 *   2. Pre-bake scene images via internal generate_image (gpt-image-2 routing)
 *   3. Render MP4 via produceVideoParallel (1080p/30fps/Bob's Fish voice, faststart, hard cuts)
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
import { validateBwbScript, assertRenderableFormat, assertBobVoice, resolveBwbVoice } from "./lib/bwb-validate";
import { openCheckpoints } from "../server/agentic/pipeline-checkpoint";

// generateImage always returns "data:<mime>;base64,<b64>" — never a file path.
// Decode and write to disk so we can pass imagePath into produceVideoParallel.
function writeDataUriToFile(dataUri: string, dest: string): void {
  const m = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error(`generateImage returned non-data-URI string (first 80 chars): ${dataUri.slice(0, 80)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(m[2], "base64"));
}

const PROJECT_ID = 16;
// Every BWB render is narrated in Bob's own Fish Audio voice clone. BWB_VOICE
// defaults to (and is asserted against) Bob's id via the shared validator, so an
// ad-hoc render can never silently fall back to the generic "onyx" narrator.
// resolveFishReferenceId passes the 32-hex id straight through to Fish Audio.
const VOICE = resolveBwbVoice(process.env.BWB_VOICE);

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
  validateBwbScript(script, fail);
  assertRenderableFormat(script, fail);
  assertBobVoice(VOICE, fail);
  console.log(`[build-bwb-video] Validation OK — ${script.scenes.length} scenes, voice=${VOICE}`);
  const sceneDir = `data/youtube/scenes/${script.videoId}`;
  fs.mkdirSync(sceneDir, { recursive: true });

  // Resume & reconstitution (Task #53): open the checkpoint manifest for this
  // render job. Every scene image is a repairable UNIT, render + deliver are
  // stages — so a job that died after baking 15 of 18 scenes resumes by reusing
  // those 15 and re-baking ONLY the 3 that never landed, then renders + delivers
  // ONCE (no duplicate email). Shares the weekly orchestrator's BWB_JOB_KEY when
  // spawned from it, so the whole pipeline is one resumable manifest end to end.
  const TENANT_ID = Number(process.env.ADMIN_TENANT_ID) || 1;
  const jobKey = process.env.BWB_JOB_KEY || `bwb-${script.videoId}`;
  const ck = await openCheckpoints({
    tenantId: TENANT_ID,
    jobKey,
    log: (m) => console.log(`[build-bwb-video] checkpoint ${m}`),
  });

  // 1. Pre-bake scene images — one durable, verified, per-scene checkpoint.
  console.log(`[build-bwb-video] Pre-baking ${script.scenes.length} scene images via gpt-image-2 cascade...`);
  for (let i = 0; i < script.scenes.length; i++) {
    const s = script.scenes[i];
    if (s.imagePath) {
      // Pre-supplied (e.g. scene 1 hero photo) — not a generated unit.
      console.log(`  scene ${i + 1}: using existing imagePath ${s.imagePath}`);
      continue;
    }
    const dest = `${sceneDir}/scene-${i + 1}.png`;
    const { result, reused } = await ck.stage<{ imagePath: string }>(
      {
        stage: "image_bake",
        unitKey: `scene-${i + 1}`,
        artifactPathOf: (r) => r.imagePath,
        // Ghost-safe: only reuse a baked scene if its PNG is still on disk.
        verify: (_r, p) => !!p && fs.existsSync(p),
      },
      async () => {
        process.stdout.write(`  scene ${i + 1}: baking... `);
        await bakeImage(s.imagePrompt!, dest);
        console.log(`OK (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
        return { imagePath: dest };
      },
    );
    s.imagePath = result.imagePath;
    if (reused) console.log(`  scene ${i + 1}: reused ${result.imagePath} (checkpoint)`);
  }
  // Stage-level marker so firstIncompleteStage()/run reporting sees image_bake
  // as complete once every unit landed (idempotent; reused on the next pass).
  await ck.stage<{ scenes: number }>({ stage: "image_bake" }, async () => ({ scenes: script.scenes.length }));

  // 2. Optional thumbnail — a checkpointed, verified unit.
  let thumbnailPath: string | null = null;
  if (script.thumbnailPrompt) {
    thumbnailPath = `data/youtube/${script.videoId}-thumbnail.png`;
    const tp = thumbnailPath;
    await ck.stage<{ thumbnailPath: string }>(
      {
        stage: "thumbnail",
        artifactPathOf: (r) => r.thumbnailPath,
        verify: (_r, p) => !!p && fs.existsSync(p),
      },
      async () => {
        console.log(`[build-bwb-video] Baking thumbnail via gpt-image-2 cascade...`);
        await bakeImage(script.thumbnailPrompt!, tp);
        return { thumbnailPath: tp };
      },
    );
  }

  // 3. Render via produceVideoParallel — split scenes into chapters of 3 each,
  // rendered in parallel then stream-copy concatenated at the end.
  // Concurrency is sized ADAPTIVELY by the engine to available RAM (os.freemem):
  // 6 simultaneous 1080p ffmpeg encodes OOM-recycle the whole VM, so the engine
  // runs as many parallel chapters as free memory safely allows and no more —
  // auto-scaling up when more RAM is free / on a bigger box, never OOMing.
  // Set VIDEO_MAX_PARALLEL_CHAPTERS to pin an explicit value (overrides auto).
  // 3. RENDER STAGE — checkpointed: a finished MP4 (still on disk) is reused, so
  // a retry that already rendered skips the whole produceVideoParallel + project
  // _files registration (no duplicate row). Artifact carries everything the
  // deliver stage + result sidecar need.
  const { result: renderInfo, reused: renderReused } = await ck.stage<{
    finalMp4: string;
    sizeMB: string;
    durationSeconds: number;
    projectFileId: number;
  }>(
    {
      stage: "render",
      artifactPathOf: (r) => r.finalMp4,
      verify: (_r, p) => !!p && fs.existsSync(p),
    },
    async () => {
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
        strictVoice: true, // brand-voice lock: fail the render rather than silently substitute a non-Bob voice on Fish failure
        resolution: "1080p", // mpeg-engine "1080p" === 1920x1080 16:9 (locked format)
        fps: 30,
        crossfadeMs: 0,
        kenBurns: false,
        tenantId: TENANT_ID,
        // Omit to let the engine size concurrency to free RAM; env pins an explicit value.
        maxParallelChapters: process.env.VIDEO_MAX_PARALLEL_CHAPTERS
          ? Math.max(1, parseInt(process.env.VIDEO_MAX_PARALLEL_CHAPTERS, 10) || 1)
          : undefined,
      });
      console.log(`[build-bwb-video] Render ${result.success ? "OK" : "FAILED"} in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.scenesProcessed} scenes`);
      if (!result.success || !result.filePath) throw new Error(`render failed: ${result.error}`);

      // Move/rename to canonical path
      const finalMp4 = `data/youtube/${script.videoId}-${script.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.mp4`;
      if (path.resolve(result.filePath!) !== path.resolve(finalMp4)) {
        fs.copyFileSync(result.filePath!, finalMp4);
      }
      const sizeMB = (fs.statSync(finalMp4).size / 1024 / 1024).toFixed(2);
      console.log(`[build-bwb-video] Final MP4: ${finalMp4} (${sizeMB} MB)`);

      // Register in project_files
      const reg = await pool.query(
        `INSERT INTO project_files (project_id, file_name, file_path, file_type, file_size, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [PROJECT_ID, path.basename(finalMp4), finalMp4, "video/mp4", fs.statSync(finalMp4).size, "build-bwb-video"]
      );
      console.log(`[build-bwb-video] Registered as project_files row ${reg.rows[0].id}`);
      return { finalMp4, sizeMB, durationSeconds: result.durationSeconds || 0, projectFileId: reg.rows[0].id };
    },
  );
  const finalMp4 = renderInfo.finalMp4;
  const sizeMB = renderInfo.sizeMB;
  if (renderReused) console.log(`[build-bwb-video] Reusing rendered MP4: ${finalMp4} (${sizeMB} MB) — skipping re-render`);

  // 4. DELIVER STAGE — checkpointed so a resume does NOT re-upload or re-email.
  // The artifact carries the deliverable URLs the sidecar + final log print.
  const { result: delivery, reused: deliveryReused } = await ck.stage<{
    deliveryId: any;
    success: boolean;
    publicPlayLink: string | null;
    shareableLink: string | null;
    folderLink: string | null;
    driveFileId: string | null;
    emailSent: boolean;
  }>(
    { stage: "deliver" },
    async () => {
      console.log(`[build-bwb-video] Delivering...`);
      const d = await deliverDigitalProduct({
        customerName: "Bob Washburn",
        customerEmail: "huskyauto@gmail.com",
        productName: `Built With Bob — ${script.title}`,
        filePath: finalMp4,
        fileName: path.basename(finalMp4),
        mimeType: "video/mp4",
        sendEmail: true,
        emailSubject: `${script.videoId} ready — ${script.title}`,
        emailBody: `Video ready for review and YouTube upload.\n\nPlaylist: ${script.playlist}\nLength: ~${renderInfo.durationSeconds.toFixed(0)} seconds\nFile: ${path.basename(finalMp4)}\n\nUse Play to stream on phone, Download to save the MP4 for upload.\n\nYouTube package below — copy/paste into YouTube Studio (or auto-upload via the youtube_upload tool).\n\n— TITLE —\n${script.title}\n\n— DESCRIPTION —\n${script.youtubeDescription}\n\n— TAGS —\n${script.youtubeTags.join(", ")}\n\n— THUMBNAIL —\n${thumbnailPath ? thumbnailPath : "(none — generate manually or rerun with thumbnailPrompt set)"}\n`,
      });
      return {
        deliveryId: d.deliveryId,
        success: d.success,
        publicPlayLink: d.publicPlayLink || null,
        shareableLink: d.shareableLink || null,
        folderLink: d.folderLink || null,
        driveFileId: (d as any).driveFileId || null,
        emailSent: !!d.emailSent,
      };
    },
  );
  if (deliveryReused) console.log(`[build-bwb-video] Delivery already done (checkpoint) — NOT re-emailing. Delivery ID ${delivery.deliveryId}`);

  // Emit a machine-readable result sidecar so the weekly orchestrator (or any
  // automation) can pick up the deliverable URLs without scraping stdout.
  try {
    const resultPath = path.join("data/youtube/scripts", `${script.videoId}.result.json`);
    fs.writeFileSync(
      resultPath,
      JSON.stringify(
        {
          videoId: script.videoId,
          title: script.title,
          playlist: script.playlist,
          description: script.youtubeDescription,
          tags: script.youtubeTags,
          filePath: finalMp4,
          projectFileId: renderInfo.projectFileId,
          thumbnailPath: thumbnailPath || null,
          deliveryId: delivery.deliveryId,
          publicPlayLink: delivery.publicPlayLink || null,
          driveViewUrl: delivery.shareableLink || null,
          driveFolderLink: delivery.folderLink || null,
          driveFileId: delivery.driveFileId || null,
          durationSeconds: renderInfo.durationSeconds || 0,
          success: delivery.success,
          builtAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(`[build-bwb-video] Wrote result sidecar: ${resultPath}`);
  } catch (e: any) {
    console.warn(`[build-bwb-video] Failed to write result sidecar: ${e?.message || e}`);
  }

  console.log(`\n========== BUILD COMPLETE ==========`);
  console.log(`Video ID:        ${script.videoId}`);
  console.log(`Playlist:        ${script.playlist}`);
  console.log(`Title:           ${script.title}`);
  console.log(`MP4 path:        ${finalMp4}`);
  console.log(`Size:            ${sizeMB} MB`);
  console.log(`Duration (est):  ${(renderInfo.durationSeconds || 0).toFixed(1)}s`);
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
