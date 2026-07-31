#!/usr/bin/env node
// BWB GitHub Actions render farm — pure-ffmpeg chapter renderer.
//
// Runs in TWO places with IDENTICAL output:
//   • locally (smoke tests) and
//   • inside a GitHub Actions matrix job (one container per chapter).
//
// ZERO npm dependencies — only Node builtins + the `ffmpeg` binary already
// preinstalled on GitHub-hosted ubuntu runners. NO app code, NO secrets.
// All scene images + narration audio are pre-rendered on the orchestrator box
// (where the LLM/TTS/image keys live) and shipped in the bundle. This script
// only stitches static assets, so credentials NEVER touch CI.
//
// The ffmpeg arg arrays below are byte-faithful copies of the in-process
// pipeline in server/mpeg-engine.ts (provided-image segment encode ~L889-914
// and concat ~L951-955) so CI output matches local renders exactly.
//
// Modes:
//   --chapter <N> --bundle <dir> --out <file>   render one chapter -> mp4
//   --concat <dir-of-chapter-mp4s> --out <file>  stream chapters -> final mp4
//
// Manifest (bundle/manifest.json):
//   { width, height, fps, crf, chapters: [ { index, scenes: [
//       { image, audio?, duration } ] } ] }
//   image/audio paths are RELATIVE to the bundle dir.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

// Loader-hijack scrub (mirrors server/safety/spawn-env-guard.ts; inlined because
// this .mjs runs standalone in CI and cannot import the server TS module).
const HIJACK_EXACT = new Set([
  "NODE_OPTIONS", "NODE_PATH",
  "PERL5LIB", "PERLLIB", "PERL5OPT",
  "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP",
  "RUBYLIB", "RUBYOPT", "GEM_PATH", "GEM_HOME",
  "LUA_PATH", "LUA_CPATH", "BUN_OPTIONS", "BUN_INSTALL",
  "DENO_DIR", "DENO_INSTALL_ROOT",
]);
function safeEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (HIJACK_EXACT.has(k) || /^(LD_|DYLD_)/i.test(k)) continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--chapter") out.chapter = parseInt(argv[++i], 10);
    else if (a === "--bundle") out.bundle = argv[++i];
    else if (a === "--concat") out.concat = argv[++i];
    else if (a === "--out") out.out = argv[++i];
  }
  return out;
}

function runFfmpeg(args, label) {
  console.log(`[render-chapter] ffmpeg ${args.join(" ").slice(0, 240)}`);
  const r = spawnSync(FFMPEG, args, { stdio: ["ignore", "inherit", "inherit"], env: safeEnv() });
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed (${label}) exit=${r.status} ${r.error?.message || ""}`);
  }
}

// Mirrors server/mpeg-engine.ts provided-image segment encode (kenBurns off,
// pad-to-fit). dur is the engine's computed duration; audio attached with
// -shortest so the segment ends with the narration.
function encodeSegment(bundleDir, scene, manifest, segPath) {
  const { width, height, fps } = manifest;
  const imageAbs = path.resolve(bundleDir, scene.image);
  if (!fs.existsSync(imageAbs)) throw new Error(`scene image missing: ${scene.image}`);
  const dur = Number(scene.duration);
  const hasAudio = !!scene.audio && fs.existsSync(path.resolve(bundleDir, scene.audio));

  const args = ["-y", "-loop", "1", "-i", imageAbs, "-t", String(dur)];
  if (hasAudio) {
    args.push("-i", path.resolve(bundleDir, scene.audio), "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest");
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-t", String(dur), "-c:a", "aac");
  }
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
  args.push("-vf", vf, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "fast", "-crf", String(manifest.crf ?? 23), "-movflags", "+faststart", "-r", String(fps), segPath);
  runFfmpeg(args, "segment");
}

// Mirrors server/mpeg-engine.ts concat (re-encode, crf 23) — used both for
// segments->chapter and chapters->final so params stay uniform.
function concatClips(clipPaths, manifest, outPath, workDir) {
  const { fps } = manifest;
  const concatFile = path.join(workDir, `concat_${Date.now()}.txt`);
  fs.writeFileSync(concatFile, clipPaths.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join("\n"));
  runFfmpeg([
    "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
    "-c:v", "libx264", "-preset", "fast", "-crf", String(manifest.crf ?? 23), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", String(fps),
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    outPath,
  ], "concat");
  try { fs.unlinkSync(concatFile); } catch { /* ignore */ }
}

function renderChapter(opts) {
  const bundleDir = path.resolve(opts.bundle);
  const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, "manifest.json"), "utf8"));
  const chapter = manifest.chapters.find((c) => Number(c.index) === Number(opts.chapter));
  if (!chapter) throw new Error(`chapter ${opts.chapter} not found in manifest (have ${manifest.chapters.map((c) => c.index).join(",")})`);

  const workDir = fs.mkdtempSync(path.join(bundleDir, `chap_${opts.chapter}_`));
  const segPaths = [];
  chapter.scenes.forEach((scene, i) => {
    const segPath = path.join(workDir, `seg_${i}.mp4`);
    encodeSegment(bundleDir, scene, manifest, segPath);
    segPaths.push(segPath);
  });
  if (segPaths.length === 0) throw new Error(`chapter ${opts.chapter} has no scenes`);

  const outPath = path.resolve(opts.out);
  if (segPaths.length === 1) {
    // single scene -> still normalize via concat so params match multi-scene
    concatClips(segPaths, manifest, outPath, workDir);
  } else {
    concatClips(segPaths, manifest, outPath, workDir);
  }
  console.log(`[render-chapter] chapter ${opts.chapter} -> ${outPath} (${fs.statSync(outPath).size} bytes)`);
}

function concatFinal(opts) {
  const dir = path.resolve(opts.concat);
  // chapter-1.mp4, chapter-2.mp4 ... ordered numerically
  const files = fs.readdirSync(dir)
    .filter((f) => /^chapter-\d+\.mp4$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))
    .map((f) => path.join(dir, f));
  if (files.length === 0) throw new Error(`no chapter-N.mp4 files in ${dir}`);
  console.log(`[render-chapter] concatenating ${files.length} chapters: ${files.map((f) => path.basename(f)).join(", ")}`);
  const manifest = fs.existsSync(path.join(dir, "manifest.json"))
    ? JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"))
    : { fps: 30, crf: 23 };
  concatClips(files, manifest, path.resolve(opts.out), dir);
  console.log(`[render-chapter] final -> ${opts.out} (${fs.statSync(path.resolve(opts.out)).size} bytes)`);
}

function main() {
  const opts = parseArgs(process.argv);
  if (!opts.out) throw new Error("--out is required");
  if (opts.concat) concatFinal(opts);
  else if (opts.chapter && opts.bundle) renderChapter(opts);
  else throw new Error("usage: --chapter N --bundle DIR --out FILE  |  --concat DIR --out FILE");
}

main();
