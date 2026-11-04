import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Bundle the real discovery/transcription module with every external transport
// replaced. Never import live Drive, Scribe, provider clients or application DB.
async function offlineDrive(files: any[]) {
  const fixture = { files, transcribed: [] as string[], downloads: [] as string[] };
  const result = await build({
    entryPoints: [resolve("scripts/lib/drive-discover.ts")],
    bundle: true, write: false, platform: "node", format: "cjs", logLevel: "silent",
    plugins: [{
      name: "offline-bwb",
      setup(b) {
        b.onResolve({ filter: /server\/(google-drive|video-editor|safety\/spawn-env-guard|lib\/ffmpeg-paths)$|^node:child_process$/ },
          a => ({ path: a.path, namespace: "offline-bwb" }));
        b.onLoad({ filter: /.*/, namespace: "offline-bwb" }, a => ({
          contents: a.path.endsWith("google-drive") ? `
            export async function driveJson(){return {files:globalThis.fixture.files};}
            export async function driveRequest(url){
              globalThis.fixture.downloads.push(url);
              return new Response(new Uint8Array([1,2,3]));
            }
          ` : a.path.endsWith("video-editor") ? `
            export async function transcribeWords(file){
              globalThis.fixture.transcribed.push(file);
              return {success:true,text:"A complete daily update.",durationSeconds:600};
            }
          ` : a.path.endsWith("spawn-env-guard") ? `
            export const sanitizeSpawnEnv = e => e;
          ` : a.path.endsWith("ffmpeg-paths") ? `
            export const getFfmpegPath = () => "fixture-ffmpeg";
            export const getFfprobePath = () => "fixture-ffprobe";
          ` : `
            export function spawnSync(cmd,args){
              if(cmd==="fixture-ffprobe") return {status:1,stderr:"fixture probe unavailable"};
              globalThis.writeFileSync(args[args.length-1],new Uint8Array([1]));
              return {status:0};
            }
          `,
        }));
      },
    }],
  });
  const mod = { exports: {} as any };
  runInNewContext(result.outputFiles[0].text, {
    module: mod, exports: mod.exports, require: createRequire(import.meta.url),
    process: { env: { BWB_MAX_SHORT_SEC: "120" } },
    fixture, writeFileSync, Response, Uint8Array, console,
  });
  return { api: mod.exports, fixture };
}

const weeklyFiles = [60298, 72685, 127915, 120811, 126999, 158361, 111784]
  .map((duration, i) => ({
    id: `daily_${i}`, name: `2026-10-${25 + i} Morning.mp4`,
    mimeType: "video/mp4", modifiedTime: "2026-11-01T00:00:00Z",
    videoMediaMetadata: { durationMillis: String(duration) },
  }));

test("all seven Oct 25–31 daily uploads qualify regardless of duration or legacy ceiling", async () => {
  const { api } = await offlineDrive([
    ...weeklyFiles,
    { ...weeklyFiles[0], id: "much_longer", name: "2026-10-25 Evening.mp4",
      videoMediaMetadata: { durationMillis: "1800000" } },
    { ...weeklyFiles[0], id: "unknown", name: "2026-10-26 Evening.mp4", videoMediaMetadata: {} },
    { ...weeklyFiles[0], id: "recap", name: "Copy of weekly-2026-10-25-github-render.mp4" },
    { ...weeklyFiles[0], id: "outside", name: "2026-10-24 Morning.mp4" },
    { ...weeklyFiles[0], id: "undated", name: "Morning.mp4" },
    { ...weeklyFiles[0], id: "copy", name: "Copy of 2026-10-25 Morning.mp4" },
  ]);
  const clips = await api.discoverWeeklyDriveClips({
    weekStart: "2026-10-25", weekEnd: "2026-10-31", allowUndated: false,
  });
  assert.deepEqual(Array.from(clips, (c: any) => c.fileId).sort(),
    [...weeklyFiles.map(f => f.id), "much_longer", "unknown"].sort());
});

test("long daily uploads with unknown metadata still reach Scribe when ffprobe is unavailable", async () => {
  const { api, fixture } = await offlineDrive([]);
  const result = await api.extractWeeklyDriveTranscripts([
    { fileId: "long_daily", name: "2026-10-28 Morning.mp4", durationSeconds: 1800 },
    { fileId: "unknown_daily", name: "2026-10-29 Morning.mp4", durationSeconds: 0 },
  ]);
  assert.equal(result.transcripts.length, 2);
  assert.equal(result.failures.length, 0);
  assert.equal(fixture.transcribed.length, 2);
});
