// Video editor: transcript-driven editing for raw footage.
//
// Patterns ported from github.com/browser-use/video-use:
//   1. The LLM never watches the video — it reads a word-level transcript.
//   2. Edits are expressed as an EDL (segments to KEEP), then rendered with ffmpeg.
//   3. 30ms audio fades at every cut so you never hear a pop.
//   4. 2-word UPPERCASE caption chunks burned in via ffmpeg drawtext.
//
// Plays nicely with the existing mpeg-engine.ts conventions: same OUTPUT_DIR,
// same ffmpeg locator, same {success, filePath, driveUrl} result shape.

import { execFileSync, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { logSilentCatch } from "./lib/silent-catch";
const OUTPUT_DIR = path.resolve(process.cwd(), "project-assets");
const TMP_DIR = path.resolve(OUTPUT_DIR, "video-editor-tmp");

function ensureDirs() {
  for (const d of [OUTPUT_DIR, TMP_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// R110.20 — bundled ffmpeg-static via shared helper.
import { getFfmpegPath as _resolvedFfmpeg, getFfprobePath as _resolvedFfprobe } from "./lib/ffmpeg-paths";
function getFFmpegPath(): string { return _resolvedFfmpeg(); }
function getFFprobePath(): string { return _resolvedFfprobe(); }

function probeDuration(filePath: string): number {
  if (!fs.existsSync(filePath)) {
    console.error(`[video-editor] probeDuration INPUT_MISSING filePath="${filePath}"`);
    throw new Error(`probeDuration: input file does not exist: ${filePath} (this is an upstream orchestration / TTS path-mismatch issue, NOT an ffmpeg/ffprobe problem — verify the audio generation step actually produced this exact path)`);
  }
  let stdout = "";
  try {
    stdout = execFileSync(
      getFFprobePath(),
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
      { encoding: "utf-8", timeout: 10000 },
    ).trim();
  } catch (err: any) {
    const msg = String(err?.stderr || err?.message || err).slice(0, 300);
    console.error(`[video-editor] probeDuration FAIL filePath="${filePath}" err=${msg}`);
    throw new Error(`probeDuration: ffprobe failed for ${filePath}: ${msg}`);
  }
  const n = parseFloat(stdout);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`[video-editor] probeDuration NON-NUMERIC filePath="${filePath}" stdout="${stdout.slice(0, 80)}"`);
    throw new Error(`probeDuration: non-finite duration for ${filePath}: "${stdout.slice(0, 80)}"`);
  }
  return n;
}

function resolveInputPath(input: string): string {
  // Accept absolute paths, /uploads/<file>, or workspace-relative.
  if (input.startsWith("/uploads/") || input.startsWith("uploads/")) {
    const fname = input.replace(/^\/?uploads\//, "");
    const prodDir = process.env.NODE_ENV === "production" ? "/tmp/uploads" : path.resolve(process.cwd(), "uploads");
    return path.resolve(prodDir, fname);
  }
  if (path.isAbsolute(input)) return input;
  return path.resolve(process.cwd(), input);
}

// ---------------------------------------------------------------------------
// 1. Word-level transcription (ElevenLabs Scribe)
// ---------------------------------------------------------------------------

export interface WordToken {
  word: string;
  start: number; // seconds
  end: number;   // seconds
  speaker?: string;
  type?: "word" | "spacing" | "audio_event";
}

export interface TranscribeResult {
  success: boolean;
  words?: WordToken[];
  text?: string;
  language?: string;
  durationSeconds?: number;
  error?: string;
}

export async function transcribeWords(input: string): Promise<TranscribeResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { success: false, error: "ELEVENLABS_API_KEY not set" };

  const filePath = resolveInputPath(input);
  if (!fs.existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` };

  try {
    const fileBuf = fs.readFileSync(filePath);
    const ext = (path.extname(filePath).slice(1) || "mp4").toLowerCase();
    const mime = ext === "mp3" ? "audio/mpeg"
               : ext === "wav" ? "audio/wav"
               : ext === "m4a" ? "audio/mp4"
               : ext === "webm" ? "video/webm"
               : "video/mp4";

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(fileBuf)], { type: mime }), path.basename(filePath));
    form.append("model_id", "scribe_v1");
    form.append("timestamps_granularity", "word");
    form.append("diarize", "true");

    // R98.27.6 — bounded leaf timeout. ElevenLabs Scribe STT can take 30-60s
    // on a long clip; cap at 90s so a stuck call can't burn the agent turn.
    const _ttsCtrl = new AbortController();
    const _ttsTimer = setTimeout(() => _ttsCtrl.abort(), 90_000);
    const resp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form as any,
      signal: _ttsCtrl.signal,
    }).finally(() => clearTimeout(_ttsTimer));
    if (!resp.ok) {
      const txt = await resp.text().catch(() => resp.statusText);
      return { success: false, error: `ElevenLabs Scribe ${resp.status}: ${txt.slice(0, 200)}` };
    }
    const data: any = await resp.json();
    const words: WordToken[] = (data.words || []).map((w: any) => ({
      word: String(w.text || w.word || "").trim(),
      start: Number(w.start ?? 0),
      end: Number(w.end ?? 0),
      speaker: w.speaker_id || w.speaker,
      type: w.type || "word",
    })).filter((w: WordToken) => w.word.length > 0);

    return {
      success: true,
      words,
      text: data.text || words.map(w => w.word).join(" "),
      language: data.language_code || data.language,
      durationSeconds: probeDuration(filePath),
    };
  } catch (e: any) {
    return { success: false, error: `Transcription failed: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// 2. Filler-word detection → EDL
// ---------------------------------------------------------------------------

const DEFAULT_FILLERS = new Set([
  "um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "ahh",
  "like", "literally", "basically", "actually", "honestly",
  "you know", "i mean", "sort of", "kind of",
]);

function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^\w'\s]/g, "").trim();
}

export interface KeepSegment { start: number; end: number; }

export interface FillerCutPlan {
  keepSegments: KeepSegment[];
  removedWords: WordToken[];
  removedSeconds: number;
  totalSeconds: number;
}

export function planFillerCuts(words: WordToken[], opts?: {
  customFillers?: string[];
  cutSilenceLongerThan?: number; // seconds
  paddingMs?: number;            // padding kept around each spoken segment
  totalDurationSeconds?: number;
}): FillerCutPlan {
  const fillers = new Set([...DEFAULT_FILLERS, ...(opts?.customFillers || []).map(normalizeWord)]);
  const silenceCut = opts?.cutSilenceLongerThan ?? 0.6;
  const pad = (opts?.paddingMs ?? 60) / 1000;

  // Mark each word as keep/cut.
  const removed: WordToken[] = [];
  const keepers: WordToken[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const norm = normalizeWord(w.word);
    // Multi-word fillers ("you know", "i mean")
    const next = words[i + 1];
    const pair = next ? `${norm} ${normalizeWord(next.word)}` : "";
    if (fillers.has(pair)) {
      removed.push(w, next);
      i++;
      continue;
    }
    if (fillers.has(norm)) { removed.push(w); continue; }
    keepers.push(w);
  }

  // Build keep segments by collapsing adjacent kept words; break on long silences.
  const segments: KeepSegment[] = [];
  let curStart: number | null = null;
  let curEnd = 0;
  for (let i = 0; i < keepers.length; i++) {
    const w = keepers[i];
    if (curStart === null) { curStart = Math.max(0, w.start - pad); curEnd = w.end + pad; continue; }
    const gap = w.start - curEnd;
    if (gap > silenceCut) {
      segments.push({ start: curStart, end: curEnd });
      curStart = Math.max(0, w.start - pad);
      curEnd = w.end + pad;
    } else {
      curEnd = w.end + pad;
    }
  }
  if (curStart !== null) segments.push({ start: curStart, end: curEnd });

  const totalSec = opts?.totalDurationSeconds || (words.length ? words[words.length - 1].end : 0);
  const keptSec = segments.reduce((a, s) => a + (s.end - s.start), 0);
  return {
    keepSegments: segments,
    removedWords: removed,
    removedSeconds: Math.max(0, totalSec - keptSec),
    totalSeconds: totalSec,
  };
}

// ---------------------------------------------------------------------------
// 3. EDL → rendered MP4 (with 30ms audio fades at every cut)
// ---------------------------------------------------------------------------

export interface RenderOptions {
  outputName?: string;
  audioFadeMs?: number; // default 30
  videoFadeMs?: number; // default 0 (hard cut)
}

export interface RenderResult {
  success: boolean;
  filePath?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  segmentsRendered?: number;
  error?: string;
}

export async function renderEDL(sourcePath: string, segments: KeepSegment[], opts: RenderOptions = {}): Promise<RenderResult> {
  ensureDirs();
  const ffmpeg = getFFmpegPath();
  const src = resolveInputPath(sourcePath);
  if (!fs.existsSync(src)) return { success: false, error: `Source not found: ${src}` };
  if (!segments.length) return { success: false, error: "No segments to render" };

  const audioFade = (opts.audioFadeMs ?? 30) / 1000;
  const outName = (opts.outputName || `cut-${Date.now()}`).replace(/[^a-z0-9._-]/gi, "_");
  const outPath = path.join(OUTPUT_DIR, `${outName}.mp4`);

  // Cut each segment to its own file with ffmpeg, applying afade in/out so cuts are pop-free.
  const segFiles: string[] = [];
  try {
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const dur = Math.max(0.04, s.end - s.start);
      const segPath = path.join(TMP_DIR, `${outName}-seg${String(i).padStart(4, "0")}.ts`);
      const fadeIn = audioFade;
      const fadeOut = Math.min(audioFade, dur / 2);
      const args = [
        "-y", "-ss", s.start.toFixed(3), "-i", src, "-t", dur.toFixed(3),
        "-af", `afade=t=in:st=0:d=${fadeIn.toFixed(3)},afade=t=out:st=${(dur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k",
        "-avoid_negative_ts", "make_zero",
        "-f", "mpegts", segPath,
      ];
      execFileSync(ffmpeg, args, { stdio: "pipe", timeout: 120_000 });
      segFiles.push(segPath);
    }

    // Concat via the demuxer (proven reliable in mpeg-engine.ts) — handles
    // variable-frame-rate and non-zero start timestamps better than the
    // concat: protocol.
    const listPath = path.join(TMP_DIR, `${outName}.concat.txt`);
    fs.writeFileSync(listPath, segFiles.map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join("\n"));
    try {
      // R74.13z-quint+10: -movflags +faststart relocates the moov atom to the
      // start of the MP4 so Google Drive's HTML5 preview can stream-play
      // without downloading the whole file. Without it Drive sits forever on
      // the clapperboard "still processing" placeholder.
      execFileSync(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", outPath], { stdio: "pipe", timeout: 300_000 });
    } finally {
      try { fs.unlinkSync(listPath); } catch (_silentErr) { logSilentCatch("server/video-editor.ts", _silentErr); }
    }

    const stat = fs.statSync(outPath);
    return {
      success: true,
      filePath: outPath,
      durationSeconds: probeDuration(outPath),
      sizeBytes: stat.size,
      segmentsRendered: segments.length,
    };
  } catch (e: any) {
    return { success: false, error: `Render failed: ${e.message?.slice(0, 300)}` };
  } finally {
    for (const f of segFiles) { try { fs.unlinkSync(f); } catch (_silentErr) { logSilentCatch("server/video-editor.ts", _silentErr); } }
  }
}

// ---------------------------------------------------------------------------
// 4. Burn 2-word UPPERCASE captions (TikTok / Reels style)
// ---------------------------------------------------------------------------

export interface BurnCaptionOptions {
  outputName?: string;
  wordsPerChunk?: number;   // default 2
  fontSize?: number;        // default 64
  upperCase?: boolean;      // default true
  position?: "bottom" | "center" | "top"; // default "bottom"
  highlightColor?: string;  // hex without #, default "FFFFFF"
  boxColor?: string;        // default "000000@0.55"
}

interface CaptionChunk { text: string; start: number; end: number; }

function chunkWords(words: WordToken[], n: number, upper: boolean): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  for (let i = 0; i < words.length; i += n) {
    const slice = words.slice(i, i + n);
    if (!slice.length) continue;
    const text = slice.map(w => w.word).join(" ");
    chunks.push({
      text: upper ? text.toUpperCase() : text,
      start: slice[0].start,
      end: slice[slice.length - 1].end,
    });
  }
  return chunks;
}

// Match the proven sanitizer in mpeg-engine.ts — strips every char that the
// drawtext filter parser treats specially. Loses some punctuation but never
// crashes ffmpeg. Apostrophes ("don't") are the most common foot-gun.
function escapeDrawtext(s: string): string {
  return s.replace(/[\\':;\[\]{}()%#=@&!<>^~`|"]/g, " ").replace(/\s+/g, " ").trim();
}

export async function burnCaptions(sourcePath: string, words: WordToken[], opts: BurnCaptionOptions = {}): Promise<RenderResult> {
  ensureDirs();
  const ffmpeg = getFFmpegPath();
  const src = resolveInputPath(sourcePath);
  if (!fs.existsSync(src)) return { success: false, error: `Source not found: ${src}` };
  if (!words.length) return { success: false, error: "No words provided" };

  // R110.20 — bundled ffmpeg-static lacks the `drawtext` filter (johnvansickle
  // GPL build ships without libfreetype configure). Probe capabilities BEFORE
  // building the filter graph so the failure is a clean structured error
  // instead of a 30+ second ffmpeg crash with cryptic "No such filter" text.
  // libass-based (`subtitles`/`ass`) burn is available — future enhancement
  // could rewrite this function to emit ASS instead of drawtext.
  try {
    const { probeFfmpegCapabilities } = await import("./lib/ffmpeg-paths");
    const cap = probeFfmpegCapabilities();
    if (!cap.filters.drawtext) {
      return {
        success: false,
        error: "video_burn_captions unavailable: bundled ffmpeg lacks the `drawtext` filter. " +
               "Use video_cut_fillers + a separate caption track instead, or rebuild with " +
               "a libfreetype-enabled ffmpeg. (R110.20 known limitation)",
      };
    }
  } catch (_silentErr) {
    logSilentCatch("server/video-editor.ts", _silentErr);
    // Fall through — if the probe itself errors, let ffmpeg attempt and surface its own error.
  }

  const outName = (opts.outputName || `captioned-${Date.now()}`).replace(/[^a-z0-9._-]/gi, "_");
  const outPath = path.join(OUTPUT_DIR, `${outName}.mp4`);
  const chunks = chunkWords(words, opts.wordsPerChunk ?? 2, opts.upperCase !== false);

  const fontSize = opts.fontSize ?? 64;
  const yExpr = opts.position === "center" ? "(h-text_h)/2"
              : opts.position === "top"    ? "h*0.08"
                                           : "h-text_h-h*0.10";
  const fontColor = (opts.highlightColor || "FFFFFF").replace(/^#/, "");
  const boxColor  = opts.boxColor || "000000@0.55";

  // One drawtext filter per chunk, gated by enable=between(t,start,end).
  const drawtexts = chunks.map(c => {
    const txt = escapeDrawtext(c.text);
    return `drawtext=text='${txt}':fontsize=${fontSize}:fontcolor=0x${fontColor}:` +
           `box=1:boxcolor=${boxColor}:boxborderw=18:` +
           `x=(w-text_w)/2:y=${yExpr}:` +
           `enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'`;
  }).join(",");

  // ffmpeg has filter graph length limits — write to a script file when long.
  const scriptPath = path.join(TMP_DIR, `${outName}.filter`);
  fs.writeFileSync(scriptPath, drawtexts);
  try {
    execFileSync(ffmpeg, [
      "-y", "-i", src,
      "-filter_complex_script", scriptPath,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      // R74.13z-quint+10: faststart on the captioned final output for Drive streaming preview.
      "-c:a", "copy", "-movflags", "+faststart", outPath,
    ], { stdio: "pipe", timeout: 600_000 });

    const stat = fs.statSync(outPath);
    return {
      success: true,
      filePath: outPath,
      durationSeconds: probeDuration(outPath),
      sizeBytes: stat.size,
      segmentsRendered: chunks.length,
    };
  } catch (e: any) {
    return { success: false, error: `Caption burn failed: ${e.message?.slice(0, 300)}` };
  } finally {
    try { fs.unlinkSync(scriptPath); } catch (_silentErr) { logSilentCatch("server/video-editor.ts", _silentErr); }
  }
}

// ---------------------------------------------------------------------------
// 5. Drive upload helper (matches the convention used by mpeg_produce)
// ---------------------------------------------------------------------------

export async function pushToDrive(filePath: string, label: string, projectFolderId?: string): Promise<{ driveUrl?: string; error?: string }> {
  try {
    const { uploadAndShare } = await import("./google-drive");
    const r = await uploadAndShare({
      filePath,
      fileName: path.basename(filePath),
      mimeType: "video/mp4",
      folderLabel: label || "Video Editor Output",
      description: "Produced by video-editor",
      share: true,
      parentFolderId: projectFolderId,
    });
    return { driveUrl: r.viewUrl, error: r.success ? undefined : r.error };
  } catch (e: any) {
    return { error: e.message };
  }
}
