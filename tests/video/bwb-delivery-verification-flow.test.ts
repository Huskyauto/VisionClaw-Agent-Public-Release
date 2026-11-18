/**
 * Run the real BWB GitHub wrapper + brand/output validators in a subprocess.
 * Farm, models, progress DB and delivery are replaced BEFORE bundling; the child
 * inherits no credentials. Nothing is rendered, uploaded, emailed or published.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { getFfprobePath } from "../../server/lib/ffmpeg-paths";
import { FISH_VOICE_BOB_DIRECT } from "../../server/lib/fish-voice-ids";

const source = path.resolve("data/youtube/video-01-origin-story-v2.mp4");
const probe = getFfprobePath();
const wrapper = path.resolve("scripts/bwb-render-github.ts");

async function runFlow(mode: "success" | "corrupt" | "soft-fail" | "throw" | "backup-fail") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bwb-delivery-flow-"));
  try {
    fs.mkdirSync(path.join(dir, "data/youtube/scripts"), { recursive: true });
    const scriptPath = path.join(dir, "script.json");
    fs.writeFileSync(scriptPath, JSON.stringify({
      videoId: "weekly-offline-fixture", playlist: "The Build", title: "A steady week of showing up",
      scenes: [{ narration: "I kept showing up for my walks this week.", imagePath: "unused-fixture.png" }],
    }));
    const bundle = path.join(dir, "wrapper.cjs");
    await build({
      entryPoints: [wrapper], outfile: bundle, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
      plugins: [{
        name: "offline-boundaries",
        setup(b) {
          b.onResolve({ filter: /github-render-farm$|bwb-drive-recovery$|bwb-job-progress$|server\/delivery-pipeline$|replit_integrations\/image\/client$|ffmpeg-paths$/ },
            a => ({ path: a.path, namespace: "offline-boundaries" }));
          b.onLoad({ filter: /.*/, namespace: "offline-boundaries" }, a => ({
            contents: a.path.endsWith("bwb-drive-recovery") ? `
              export function createBwbRecovery(){return {
                async json(){if(process.env.FIXTURE_MODE==="backup-fail")throw new Error("BWB recovery paused: offline refusal")},
                async file(){},async save(){}
              }}
            ` : a.path.endsWith("github-render-farm") ? `
              import fs from "node:fs";
              export async function renderOnGithubFarm(o) {
                if(o.toolAuthority?.tenantId!==1 || o.toolAuthority?.actor!=="system" ||
                  o.toolAuthority?.invokedVia!=="video-render" || !o.toolAuthority?.internalPurpose)
                  throw new Error("missing tenant-scoped narration authority");
                if(o.voiceProvider!=="fish" || o.voice!==${JSON.stringify(FISH_VOICE_BOB_DIRECT)} || !o.strictVoice ||
                  o.width!==1920 || o.height!==1080 || o.fps!==30) throw new Error("brand render contract changed");
                fs.writeFileSync("farm-options.json",JSON.stringify({voiceLocked:true,formatLocked:true}));
                if(process.env.FIXTURE_MODE==="corrupt") fs.writeFileSync(o.outMp4,"not a finished video");
                else fs.copyFileSync(${JSON.stringify(source)},o.outMp4);
                return {chapters:1};
              }
            ` : a.path.endsWith("bwb-job-progress") ? `
              export async function setBwbPhase(){}
              export async function updateBwbChapters(){}
            ` : a.path.endsWith("delivery-pipeline") ? `
              import fs from "node:fs";
              import { createHash } from "node:crypto";
              export async function deliverDigitalProduct(o){
                const digest=createHash("sha256").update(fs.readFileSync(o.filePath)).digest("hex");
                if(!o.metadata.outputVerification.ok || digest!==o.metadata.outputVerification.identity.sha256)
                  throw new Error("delivery bytes do not match verification");
                fs.writeFileSync("delivery-request.json",JSON.stringify({
                  path:o.filePath,sendEmail:o.sendEmail,tenantId:o.tenantId,sha256:digest,
                  report:o.metadata.outputVerification
                }));
                if(process.env.FIXTURE_MODE==="throw") throw new Error("offline transport failure");
                return {success:process.env.FIXTURE_MODE!=="soft-fail",deliveryId:123,
                  publicPlayLink:"https://example.invalid/play",shareableLink:"https://example.invalid/drive"};
              }
            ` : a.path.endsWith("image/client") ? `
              export async function generateImage(){throw new Error("unexpected paid image generation");}
            ` : `
              export const getFfprobePath=()=>${JSON.stringify(probe)};
              export const getFfmpegPath=()=>{throw new Error("no detector requested");};
            `,
          }));
        },
      }],
    });
    const child = spawnSync(process.execPath, [bundle], {
      cwd: dir, env: {
        PATH: process.env.PATH, SCRIPT: scriptPath, DELIVER: "true",
        FIXTURE_MODE: mode, BWB_ORCHESTRATOR_RUN_ID: "offline-fixture", BWB_JOB_KEY: "offline-fixture",
      },
      encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024,
    });
    assert.equal(child.error, undefined);
    const read = (name: string) => fs.existsSync(path.join(dir, name))
      ? JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) : null;
    const delivery = read("delivery-request.json");
    const sidecar = read("data/youtube/scripts/weekly-offline-fixture.result.json");
    if (mode !== "backup-fail") {
      assert.deepEqual(read("farm-options.json"), { voiceLocked: true, formatLocked: true });
      assert.equal(fs.existsSync(path.join(dir, "data/youtube/weekly-offline-fixture-github-render.mp4")), true,
        "accepted farm output must survive verification or transport failure");
    } else assert.equal(read("farm-options.json"), null, "backup failure must precede any farm spend");
    if (delivery) assert.equal(fs.existsSync(delivery.path), false, "private delivery snapshot must be cleaned");
    return { status: child.status, log: child.stdout + child.stderr, delivery, sidecar };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("weekly wrapper awaits real verification and delivers the exact accepted bytes without sending its own approval email", async () => {
  const result = await runFlow("success");
  assert.equal(result.status, 0, result.log);
  assert.equal(result.delivery.sendEmail, false);
  assert.equal(result.delivery.tenantId, 1);
  assert.equal(result.sidecar.success, true);
  assert.equal(result.sidecar.outputVerification.identity.sha256, result.delivery.sha256);
  assert.equal(result.sidecar.orchestratorRunId, "offline-fixture");
});

test("weekly wrapper blocks corrupt output before the delivery boundary", async () => {
  const result = await runFlow("corrupt");
  assert.equal(result.status, 1, result.log);
  assert.equal(result.delivery, null);
  assert.equal(result.sidecar, null);
});

test("weekly wrapper records failed delivery rather than falsely completing the recap", async () => {
  const result = await runFlow("soft-fail");
  assert.equal(result.status, 4, result.log);
  assert.equal(result.sidecar.success, false);
});

test("weekly wrapper preserves the farm output and cleans its copy when delivery throws", async () => {
  const result = await runFlow("throw");
  assert.equal(result.status, 2, result.log);
  assert.equal(result.sidecar, null);
});

test("weekly wrapper stops before rendering when its mandatory recovery backup fails", async () => {
  const result = await runFlow("backup-fail");
  assert.equal(result.status, 2, result.log);
  assert.equal(result.delivery, null);
  assert.equal(result.sidecar, null);
});
