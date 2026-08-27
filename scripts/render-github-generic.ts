/**
 * Generic / customer video — GitHub Actions render farm entry (NON-BWB).
 *
 * Renders ANY video on the same free multi-container GitHub farm that Built With
 * Bob uses, WITHOUT the BWB brand opinions: no brand validation, no Fish-voice
 * lock — the caller's chosen voice/provider is used, and delivery info comes from
 * env (customer name/email), not Bob's hardcoded identity.
 *
 * The expensive parts (image gen, TTS) run HERE on the app box where the keys
 * live; CI runs pure ffmpeg. Wired from server/build-video-from-brief.ts for the
 * generic (non-bwbBrand) branch so customer videos render in parallel instead of
 * serially in-process (which previously risked prod OOM — R110.22).
 *
 * Usage (spawned by the brief router; also runnable by hand):
 *   SCRIPT=/path/to/generic-script.json npx tsx scripts/render-github-generic.ts
 *
 * Script JSON shape:
 *   {
 *     "videoId": "vid-123",
 *     "title": "My Video",
 *     "scenes": [ { "narration": "...", "imagePrompt": "..." | "imagePath": "..." } ],
 *     "voice": "onyx",
 *     "voiceProvider": "fish",
 *     "strictVoice": false,
 *     "resolution": "1920x1080"
 *   }
 *
 * Env:
 *   SCRIPT                          (required) path to the generic script JSON
 *   GITHUB_PERSONAL_ACCESS_TOKEN_2  (required) classic PAT, repo scope
 *   GH_RENDER_REPO                  owner/repo override
 *   DELIVER=true                    run deliverDigitalProduct on the result
 *   CUSTOMER_NAME / CUSTOMER_EMAIL  delivery recipient (when DELIVER=true)
 *   PRODUCT_NAME                    delivery product name (default: the title)
 *   PROJECT_ID                      optional project id for delivery linkage
 */
import fs from "node:fs";
import path from "node:path";
import { renderOnGithubFarm, type FarmScene } from "./lib/github-render-farm";
import { readFileSyncEIO, existsSyncEIO } from "./lib/eio-read";

interface GenericScene { narration: string; imagePrompt?: string; imagePath?: string; }
interface GenericScript {
  videoId: string;
  title: string;
  scenes: GenericScene[];
  voice?: string;
  voiceProvider?: string;
  strictVoice?: boolean;
  resolution?: string;
}

function die(msg: string): never { console.error(`\n[gh-render-generic] FAIL: ${msg}\n`); process.exit(1); }

function parseResolution(res: string | undefined): { width: number; height: number } {
  const m = (res || "1920x1080").match(/^(\d+)x(\d+)$/);
  if (!m) return { width: 1920, height: 1080 };
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

async function main(): Promise<number> {
  const scriptPath = process.env.SCRIPT;
  if (!scriptPath || !existsSyncEIO(scriptPath)) die("SCRIPT env var must point to an existing generic script JSON");
  const script: GenericScript = JSON.parse(readFileSyncEIO(scriptPath, "utf8"));
  if (!script.videoId) die("script JSON missing videoId");
  if (!Array.isArray(script.scenes) || script.scenes.length === 0) die("script JSON has no scenes");

  const { width, height } = parseResolution(script.resolution);
  const outMp4 = `data/youtube/${script.videoId}-github-render.mp4`;

  const { chapters, outMp4: finalMp4, runUrl } = await renderOnGithubFarm({
    videoId: script.videoId,
    scenes: script.scenes as FarmScene[],
    // Generic path: honor the caller's resolved voice/provider (NOT Bob's clone).
    voice: script.voice || "onyx",
    voiceProvider: script.voiceProvider || "fish",
    strictVoice: script.strictVoice === true,
    width,
    height,
    fps: 30,
    crf: 23,
    outMp4,
    sceneDir: `data/youtube/scenes/${script.videoId}`,
    callerLabel: "render-github-generic",
    imagePurpose: "customer_video_scene",
    isCustomerFacing: true,
    // Customer media — refuse to stage assets on a public render repo.
    requirePrivateRepo: true,
    fail: die,
  });

  console.log(`[gh-render-generic] DONE — ${finalMp4} (${chapters} chapters) — ${runUrl}`);

  if (process.env.DELIVER === "true") {
    const customerName = process.env.CUSTOMER_NAME || "Customer";
    const customerEmail = process.env.CUSTOMER_EMAIL || "";
    if (!customerEmail) {
      console.warn(`[gh-render-generic] DELIVER=true but CUSTOMER_EMAIL unset — leaving MP4 on disk at ${finalMp4}`);
      return 0;
    }
    const productName = process.env.PRODUCT_NAME || script.title || script.videoId;
    const projectId = process.env.PROJECT_ID ? parseInt(process.env.PROJECT_ID, 10) : undefined;
    const { deliverDigitalProduct } = await import("../server/delivery-pipeline");
    const delivery = await deliverDigitalProduct({
      customerName,
      customerEmail,
      productName,
      filePath: finalMp4,
      fileName: path.basename(finalMp4),
      mimeType: "video/mp4",
      sendEmail: true,
      emailSubject: `${productName} is ready`,
      emailBody: `Your video "${productName}" was rendered on the GitHub Actions farm (${chapters} parallel containers).\nPlay/Download links below.`,
      ...(projectId ? { projectId } : {}),
    } as any);
    console.log(`[gh-render-generic] delivered #${delivery.deliveryId} — Play: ${delivery.publicPlayLink} | Drive: ${delivery.shareableLink}`);
  } else {
    console.log(`[gh-render-generic] (set DELIVER=true + CUSTOMER_EMAIL to ship via deliverDigitalProduct)`);
  }
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error("[gh-render-generic] UNCAUGHT:", e); process.exit(2); });
