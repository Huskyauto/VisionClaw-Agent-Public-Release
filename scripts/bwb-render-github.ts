/**
 * Built With Bob — GitHub Actions render farm orchestrator (thin wrapper).
 *
 * The render-farm machinery (bake images → gen audio → bundle → dispatch CI →
 * poll → download) lives in scripts/lib/github-render-farm.ts and is shared with
 * the generic/customer path (scripts/render-github-generic.ts). THIS wrapper adds
 * only the Built With Bob brand opinions:
 *   - brand validation (spoken-URL / playlist / forbidden-token / Shorts gate)
 *   - Bob's own Fish Audio voice clone (hard-asserted, fails closed)
 *   - delivery as "Bob Washburn" + the weekly-orchestrator result sidecar
 *
 * Secrets NEVER touch CI — the shared core pre-renders all assets on the app box.
 *
 * Usage:
 *   SCRIPT=data/youtube/scripts/weekly-2026-05-30.json npx tsx scripts/bwb-render-github.ts
 *
 * Env:
 *   SCRIPT                          (required) path to the BWB script JSON
 *   GITHUB_PERSONAL_ACCESS_TOKEN_2  (required) classic PAT, repo scope
 *   BWB_VOICE                       Fish voice id/name (default + enforced: Bob's clone)
 *   GH_RENDER_REPO                  owner/repo override (default: parsed from git remote)
 *   DELIVER=true                    also run deliverDigitalProduct on the result
 */
import fs from "node:fs";
import path from "node:path";
import { validateBwbScript, assertRenderableFormat, assertBobVoice, resolveBwbVoice } from "./lib/bwb-validate";
import { renderOnGithubFarm, type FarmScene } from "./lib/github-render-farm";
import { setBwbPhase, updateBwbChapters } from "../server/lib/bwb-job-progress";

const VOICE = resolveBwbVoice(process.env.BWB_VOICE);

interface SceneSpec { narration: string; imagePrompt?: string; imagePath?: string; }
interface VideoScript {
  videoId: string;
  playlist: string;
  title: string;
  scenes: SceneSpec[];
  youtubeDescription?: string;
  youtubeTags?: string[];
  thumbnailPrompt?: string;
}

function die(msg: string): never { console.error(`\n[gh-render] FAIL: ${msg}\n`); process.exit(1); }

async function main(): Promise<number> {
  const scriptPath = process.env.SCRIPT;
  if (!scriptPath || !fs.existsSync(scriptPath)) die("SCRIPT env var must point to an existing script JSON");
  const script: VideoScript = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
  // Same brand rules as the local builder — neither backend renders an unvalidated script.
  validateBwbScript(script, die);
  assertRenderableFormat(script, die);
  assertBobVoice(VOICE, die);

  const outMp4 = `data/youtube/${script.videoId}-github-render.mp4`;
  const { chapters } = await renderOnGithubFarm({
    videoId: script.videoId,
    scenes: script.scenes as FarmScene[],
    voice: VOICE,
    voiceProvider: "fish",
    strictVoice: true,
    width: 1920,
    height: 1080,
    fps: 30,
    crf: 23,
    outMp4,
    sceneDir: `data/youtube/scenes/${script.videoId}`,
    callerLabel: "bwb-render-github",
    imagePurpose: "customer_video_scene",
    isCustomerFacing: true,
    skipDailyCap: true, // Bob's own channel — content he's deliberately paying for; never cap.
    fail: die,
    // Live progress → video_jobs row (no-op when BWB_JOB_ID is unset, e.g. manual
    // CLI runs). Fire-and-forget: the DB writer never throws (logSilentCatch) and
    // we don't await so a slow write can't stall the render poll loop.
    onProgress: (p) => {
      if (p.chapters && p.chapters.length) {
        void updateBwbChapters(p.chapters, { phase: p.phase, totalChapters: p.totalChapters });
      } else if (p.phase) {
        void setBwbPhase(p.phase, { totalChapters: p.totalChapters });
      }
    },
  });

  // Optional delivery (otherwise just leave the MP4 on disk)
  if (process.env.DELIVER === "true") {
    // Bake a thumbnail for parity with the local builder (best-effort — a
    // missing thumbnail must not fail the render or the approval flow).
    let thumbnailPath: string | null = null;
    if (script.thumbnailPrompt) {
      const tp = `data/youtube/${script.videoId}-thumbnail.png`;
      try {
        if (!fs.existsSync(tp)) {
          console.log(`[gh-render] baking thumbnail...`);
          const { generateImage } = await import("../server/replit_integrations/image/client");
          const result = await generateImage(script.thumbnailPrompt, { purpose: "customer_video_scene", isCustomerFacing: true, callerLabel: "bwb-render-github" });
          const m = result.match(/^data:([^;]+);base64,(.+)$/);
          if (!m) throw new Error(`generateImage returned non-data-URI (first 80): ${result.slice(0, 80)}`);
          fs.mkdirSync(path.dirname(tp), { recursive: true });
          fs.writeFileSync(tp, Buffer.from(m[2], "base64"));
        }
        thumbnailPath = tp;
      } catch (e: any) {
        console.warn(`[gh-render] thumbnail bake failed (${e?.message || e}) — continuing without one`);
      }
    }

    const { deliverDigitalProduct } = await import("../server/delivery-pipeline");
    const delivery = await deliverDigitalProduct({
      customerName: "Bob Washburn", customerEmail: "huskyauto@gmail.com",
      productName: `Built With Bob — ${script.title}`, filePath: outMp4, fileName: path.basename(outMp4),
      mimeType: "video/mp4", sendEmail: true, emailSubject: `${script.videoId} ready (GitHub render) — ${script.title}`,
      emailBody: `Rendered via the GitHub Actions farm (${chapters} parallel containers).\nPlay/Download links below.`,
    });
    console.log(`[gh-render] delivered #${delivery.deliveryId} — Play: ${delivery.publicPlayLink} | Drive: ${delivery.shareableLink}`);

    // Emit the SAME machine-readable result sidecar the local builder writes so
    // scripts/bwb-weekly-orchestrator.ts (findNewestResultSince) can pick up the
    // deliverable and fire the approval/publish email regardless of backend.
    try {
      const resultPath = path.join("data/youtube/scripts", `${script.videoId}.result.json`);
      const sidecar = {
        videoId: script.videoId,
        title: script.title,
        playlist: script.playlist,
        description: script.youtubeDescription || `Built With Bob — ${script.title}.`,
        tags: Array.isArray(script.youtubeTags) ? script.youtubeTags : [],
        filePath: outMp4,
        projectFileId: null,
        thumbnailPath,
        deliveryId: (delivery as any).deliveryId ?? null,
        publicPlayLink: (delivery as any).publicPlayLink ?? null,
        driveViewUrl: (delivery as any).shareableLink ?? null,
        driveFolderLink: (delivery as any).folderLink ?? null,
        driveFileId: (delivery as any).driveFileId ?? null,
        renderedVia: "github-actions",
        builtAt: new Date().toISOString(),
      };
      fs.writeFileSync(resultPath, JSON.stringify(sidecar, null, 2));
      console.log(`[gh-render] wrote result sidecar: ${resultPath}`);
    } catch (e: any) {
      console.warn(`[gh-render] failed to write result sidecar (approval email may not fire): ${e?.message || e}`);
    }
  } else {
    console.log(`[gh-render] (set DELIVER=true to ship via deliverDigitalProduct)`);
  }
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error("[gh-render] UNCAUGHT:", e); process.exit(2); });
