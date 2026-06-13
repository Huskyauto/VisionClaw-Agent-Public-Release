// R98.13 W3 — Vision/audio quality grader. Per-format rubrics that turn
// "the file exists and parses" (verify_deliverable) into "the file is
// professional-quality and matches the spec" (grade_deliverable). Score 0-100;
// passing bar 85 by default; if score<85 returns critique that Felix can feed
// back into a SECOND attempt before either re-shipping or escalating to Bob.
//
// This is the layer between W2 (binary proof gate) and the customer's email.

import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { runLlmTask } from "./llm-task";
import { logSilentCatch } from "./lib/silent-catch";

const execFileAsync = promisify(execFile);

const WORKSPACE_ROOT = path.resolve(process.cwd());
const ALLOWED_FILE_ROOTS: string[] = [
  path.resolve(WORKSPACE_ROOT, "deliverables"),
  path.resolve(WORKSPACE_ROOT, "uploads"),
  path.resolve(WORKSPACE_ROOT, "project-assets"),
  path.resolve(WORKSPACE_ROOT, "attached_assets"),
  path.resolve(WORKSPACE_ROOT, "stress-test-output"),
  path.resolve(WORKSPACE_ROOT, "data"),
  path.resolve(WORKSPACE_ROOT, "public", "videos"),
  "/tmp",
];

// R110.21.2 (Manus AI cross-review #1) — defense-in-depth: ALWAYS realpath
// before checking. Previously the grader did string-prefix-only against
// ALLOWED_FILE_ROOTS, so a symlink inside an allowed dir (e.g.
// `attached_assets/escape -> /etc/passwd`) would pass the check and let the
// LLM-driven grader read host files. The verifier had a partial fallback
// (re-check on realpath if direct fails — still vulnerable to allowed-dir
// symlinks); this version is strict for both sides. Falls CLOSED on any
// realpath failure (file missing, permission denied, broken symlink).
function isPathAllowed(absPath: string): boolean {
  const abs = path.resolve(absPath);
  // Try realpath first (resolves symlinks → catches symlink-escape attacks).
  // R110.21.2 architect FAIL fix: ENOENT must NOT collapse "missing file"
  // into "path-jail rejected" — that ate the diagnostic signal callers rely
  // on (`skipped: "missing"` vs `path_rejected`). On ENOENT/EACCES, fall back
  // to the lexical check against `abs`. This is still safe: a symlink-escape
  // attack requires the target to EXIST for realpathSync to dereference it,
  // so a non-existent path can be lexically checked without weakening the jail.
  let target = abs;
  try {
    target = fs.realpathSync(abs);
  } catch (e: any) {
    if (e?.code !== "ENOENT" && e?.code !== "EACCES") {
      logSilentCatch("server/deliverable-grader.ts:isPathAllowed", e);
      return false;
    }
    // ENOENT/EACCES: fall through with lexical `abs`.
  }
  for (const root of ALLOWED_FILE_ROOTS) {
    const rel = path.relative(root, target);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return true;
  }
  return false;
}

export type GraderFormat = "video" | "audio" | "pdf" | "slides" | "html_app" | "image";

export interface GradeInput {
  tenantId: number;
  deliverableType: GraderFormat | string;   // accepts the same strings verify_deliverable uses
  filePath?: string;
  fileUrl?: string;
  expectedSpec?: {
    slide_count?: number;
    requires_photo_on?: number[];           // 1-indexed slide numbers requiring a photo
    min_pages?: number;
    max_pages?: number;
    transcript?: string;                    // for audio/video: expected narration text
    smoke_assertion?: string;               // for html_app: JS expression eval'd in jsdom
    expected_duration_sec?: number;
    brand_colors?: string[];                // hex codes that should appear
  };
  model?: string;
}

export interface GradeIssue {
  severity: "low" | "medium" | "high";
  message: string;
}

export interface GradeResult {
  ok: boolean;
  score: number;                            // 0-100
  passingBar: number;                       // typically 85
  issues: GradeIssue[];
  critique: string;                         // human-readable summary for auto-revise
  metrics: Record<string, any>;             // per-format raw measurements
  graderFormat: GraderFormat | "unsupported";
  skipped?: string;                         // reason if we couldn't grade
  // R106 N3 (LuaN1aoAgent, Apache-2.0) — Near-miss surfacing.
  // When a deliverable FAILS but came within `nearMissBand` points of the
  // bar, we name the SINGLE dimension that, if fixed, would most likely
  // push the score across the bar. Steers the auto-revise loop to the
  // highest-leverage fix instead of regenerating from scratch.
  nearMissDimension?: string;               // e.g. "audio_loudness", "pdf_page_count", "html_smoke"
  nearMissNote?: string;                    // human-readable one-liner with the suggested fix
}

// R106 N3 — Helper: derive a near-miss hint from a failed grade. Pure function,
// no I/O. Returns undefined when the grade isn't a near-miss (passed, or
// failed by >5 points, or no high-severity issue identifiable).
export function deriveNearMiss(g: Pick<GradeResult, "ok" | "score" | "passingBar" | "issues" | "graderFormat">):
  { nearMissDimension: string; nearMissNote: string } | undefined {
  if (g.ok) return undefined;
  const gap = g.passingBar - g.score;
  if (gap <= 0 || gap > 7) return undefined;
  const highIssue = g.issues.find((i) => i.severity === "high") || g.issues[0];
  if (!highIssue) return undefined;
  const msg = highIssue.message.toLowerCase();
  let dim = `${g.graderFormat}_quality`;
  if (msg.match(/loud|lufs|silen|audio/)) dim = "audio_loudness";
  else if (msg.match(/black|frame|video|fps|codec|bitrate/)) dim = "video_quality";
  else if (msg.match(/page|count|short|long/)) dim = `${g.graderFormat}_length`;
  else if (msg.match(/photo|image|color|brand/)) dim = "visual_assets";
  else if (msg.match(/transcript|narration|script|word/)) dim = "narration_match";
  else if (msg.match(/smoke|js|console|render/)) dim = "html_smoke";
  else if (msg.match(/slide|deck|layout/)) dim = "slide_layout";
  return {
    nearMissDimension: dim,
    nearMissNote: `Near-miss: ${gap.toFixed(1)}pt below bar (${g.score}/${g.passingBar}). Highest-leverage fix: ${highIssue.message}`,
  };
}

function normalizeFormat(s: string): GraderFormat | "unsupported" {
  const x = (s || "").toLowerCase();
  if (["video", "mp4", "mov"].includes(x)) return "video";
  if (["audio", "mp3", "wav", "m4a"].includes(x)) return "audio";
  if (["pdf", "pdf_document"].includes(x)) return "pdf";
  if (["slides", "slide_deck", "pptx", "presentation"].includes(x)) return "slides";
  if (["html_app", "html_page", "html"].includes(x)) return "html_app";
  if (["image", "png", "jpg", "jpeg", "webp"].includes(x)) return "image";
  return "unsupported";
}

async function ffprobe(filePath: string): Promise<any> {
  // R110.20 — bundled ffprobe-static; no Nix-store dependency.
  const { getFfprobePath } = await import("./lib/ffmpeg-paths");
  const ffprobeBin = getFfprobePath();
  const { stdout } = await execFileAsync(ffprobeBin, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function ffmpegBlackDetect(filePath: string, durSec: number): Promise<{ blackSegments: { start: number; end: number; dur: number }[]; raw: string }> {
  // R110.20 — bundled ffmpeg-static.
  const { getFfmpegPath } = await import("./lib/ffmpeg-paths");
  const ffmpegBin = getFfmpegPath();
  // black detection: any frame with avg luminance < 0.1 for >2s.
  try {
    const { stderr } = await execFileAsync(ffmpegBin, [
      "-i", filePath,
      "-vf", "blackdetect=d=2.0:pix_th=0.10",
      "-an",
      "-f", "null",
      "-",
    ], { timeout: Math.max(60000, Math.min(durSec * 2000, 240000)), maxBuffer: 8 * 1024 * 1024 });
    const segments: { start: number; end: number; dur: number }[] = [];
    const re = /black_start:([\d.]+).*?black_end:([\d.]+).*?black_duration:([\d.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stderr)) !== null) {
      segments.push({ start: parseFloat(m[1]), end: parseFloat(m[2]), dur: parseFloat(m[3]) });
    }
    return { blackSegments: segments, raw: stderr.slice(-2000) };
  } catch (e: any) {
    return { blackSegments: [], raw: `blackdetect failed: ${e?.message || String(e)}` };
  }
}

// ---- VIDEO grader ----
async function gradeVideo(input: GradeInput): Promise<GradeResult> {
  const issues: GradeIssue[] = [];
  const metrics: Record<string, any> = {};
  const fp = input.filePath;
  if (!fp) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "no file_path provided" }], critique: "Cannot grade video without a local file_path.", metrics: {}, graderFormat: "video", skipped: "no_file_path" };
  const abs = path.resolve(fp);
  if (!isPathAllowed(abs)) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "file_path outside allowed roots" }], critique: "Path-jail rejection.", metrics: {}, graderFormat: "video", skipped: "path_rejected" };
  if (!fs.existsSync(abs)) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "file does not exist" }], critique: "File missing on disk.", metrics: {}, graderFormat: "video", skipped: "missing" };

  let probe: any;
  try { probe = await ffprobe(abs); }
  catch (e: any) { return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: `ffprobe failed: ${e?.message || String(e)}` }], critique: "Could not probe file — likely corrupt.", metrics: {}, graderFormat: "video" }; }

  const vStream = (probe.streams || []).find((s: any) => s.codec_type === "video");
  const aStream = (probe.streams || []).find((s: any) => s.codec_type === "audio");
  const formatDur = parseFloat(probe.format?.duration || "0");
  metrics.duration_sec = formatDur;
  metrics.video_codec = vStream?.codec_name;
  metrics.audio_codec = aStream?.codec_name;
  metrics.bitrate = parseInt(probe.format?.bit_rate || "0", 10);
  metrics.size_bytes = parseInt(probe.format?.size || "0", 10);

  let score = 100;
  if (!vStream) { issues.push({ severity: "high", message: "no video stream" }); score -= 50; }
  if (!aStream) { issues.push({ severity: "high", message: "no audio stream — silent video" }); score -= 40; }
  if (vStream && vStream.codec_name !== "h264") { issues.push({ severity: "medium", message: `video codec ${vStream.codec_name} not H.264 — Drive preview may not work` }); score -= 10; }
  if (aStream && !["aac", "mp3"].includes(aStream.codec_name)) { issues.push({ severity: "medium", message: `audio codec ${aStream.codec_name} not AAC/MP3 — Drive preview may not work` }); score -= 10; }
  if (formatDur < 3) { issues.push({ severity: "high", message: `duration ${formatDur}s too short to be a real video` }); score -= 30; }

  const expDur = input.expectedSpec?.expected_duration_sec;
  if (typeof expDur === "number" && expDur > 0) {
    const driftRatio = Math.abs(formatDur - expDur) / expDur;
    metrics.duration_drift_ratio = driftRatio;
    if (driftRatio > 0.05) { issues.push({ severity: "medium", message: `duration drift ${(driftRatio * 100).toFixed(1)}% (>${5}% bar): expected ${expDur}s, got ${formatDur.toFixed(1)}s` }); score -= 10; }
  }

  // Audio/video duration drift sanity (should match closely)
  if (vStream && aStream) {
    const vDur = parseFloat(vStream.duration || "0") || formatDur;
    const aDur = parseFloat(aStream.duration || "0") || formatDur;
    const avDrift = Math.abs(vDur - aDur);
    metrics.av_drift_sec = avDrift;
    if (avDrift > 0.5) { issues.push({ severity: "high", message: `audio/video duration mismatch ${avDrift.toFixed(2)}s — half-mute video risk` }); score -= 20; }
  }

  // Black frame detect (only for short-ish videos — skip if >5min to avoid blowing the timeout)
  if (formatDur > 0 && formatDur < 300) {
    const { blackSegments, raw: _raw } = await ffmpegBlackDetect(abs, formatDur);
    metrics.black_segments = blackSegments;
    const longBlack = blackSegments.filter((s) => s.dur > 2);
    if (longBlack.length > 0) {
      issues.push({ severity: "medium", message: `${longBlack.length} black segment(s) >2s detected (longest ${longBlack[0].dur.toFixed(1)}s @ ${longBlack[0].start}s)` });
      score -= Math.min(20, longBlack.length * 5);
    }
  } else {
    metrics.black_detect = formatDur >= 300 ? "skipped (video >5min)" : "skipped";
  }

  // Meta-narration anti-pattern (only checkable if expectedSpec.transcript provided)
  const transcript = input.expectedSpec?.transcript;
  if (transcript && typeof transcript === "string") {
    const metaPatterns = [/\bin this video i('| wi)ll\b/i, /\btoday i('| wi)ll\b/i, /\bfirst i('| wi)ll\b/i, /\blet me tell you about how i\b/i, /\bwe('| wi)ll (explore|look at|cover)\b/i];
    const hits = metaPatterns.filter((re) => re.test(transcript));
    if (hits.length > 0) { issues.push({ severity: "medium", message: `${hits.length} meta-narration phrase(s) in script — should describe content, not announce it` }); score -= hits.length * 5; }
    metrics.transcript_word_count = transcript.split(/\s+/).filter(Boolean).length;
  }

  score = Math.max(0, Math.min(100, score));
  const passingBar = 85;
  const critique = issues.length === 0 ? "Video passes all grader checks." : `Video grader found ${issues.length} issue(s):\n${issues.map((i) => `- [${i.severity}] ${i.message}`).join("\n")}`;
  return { ok: score >= passingBar, score, passingBar, issues, critique, metrics, graderFormat: "video" };
}

// ---- AUDIO grader ----
async function gradeAudio(input: GradeInput): Promise<GradeResult> {
  const issues: GradeIssue[] = [];
  const metrics: Record<string, any> = {};
  const fp = input.filePath;
  if (!fp) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "no file_path" }], critique: "no file", metrics: {}, graderFormat: "audio", skipped: "no_file_path" };
  const abs = path.resolve(fp);
  if (!isPathAllowed(abs)) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "path-jail" }], critique: "rejected", metrics: {}, graderFormat: "audio", skipped: "path_rejected" };
  if (!fs.existsSync(abs)) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "missing" }], critique: "missing", metrics: {}, graderFormat: "audio", skipped: "missing" };

  let probe: any;
  try { probe = await ffprobe(abs); }
  catch (e: any) { return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: `ffprobe failed: ${e?.message || String(e)}` }], critique: "probe failed", metrics: {}, graderFormat: "audio" }; }

  const aStream = (probe.streams || []).find((s: any) => s.codec_type === "audio");
  const dur = parseFloat(probe.format?.duration || "0");
  metrics.duration_sec = dur;
  metrics.codec = aStream?.codec_name;
  metrics.sample_rate = parseInt(aStream?.sample_rate || "0", 10);
  metrics.channels = aStream?.channels;
  metrics.size_bytes = parseInt(probe.format?.size || "0", 10);

  let score = 100;
  if (!aStream) { issues.push({ severity: "high", message: "no audio stream" }); score -= 60; }
  if (dur < 1) { issues.push({ severity: "high", message: `duration ${dur}s too short` }); score -= 40; }
  if (metrics.sample_rate && metrics.sample_rate < 22050) { issues.push({ severity: "medium", message: `sample rate ${metrics.sample_rate}Hz below 22.05kHz minimum` }); score -= 15; }

  // Loudness (LUFS) via volumedetect — quick & free; not exact LUFS but flags silence-padded ends.
  try {
    const { getFfmpegPath: _gfa } = await import("./lib/ffmpeg-paths");
    const { stderr } = await execFileAsync(_gfa(), ["-i", abs, "-af", "volumedetect", "-f", "null", "-"], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    const meanMatch = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
    const maxMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
    if (meanMatch) metrics.mean_volume_db = parseFloat(meanMatch[1]);
    if (maxMatch) metrics.max_volume_db = parseFloat(maxMatch[1]);
    if (typeof metrics.mean_volume_db === "number" && metrics.mean_volume_db < -45) {
      issues.push({ severity: "high", message: `mean volume ${metrics.mean_volume_db}dB — likely silent/near-silent file` });
      score -= 30;
    }
  } catch (_e) { logSilentCatch("server/deliverable-grader.ts:volumedetect", _e); }

  // End-cut detection: probe last 1.5s — if max volume there is silence (< -50dB), narration was cut off.
  if (dur > 2) {
    try {
      const tailStart = Math.max(0, dur - 1.5);
      const { getFfmpegPath: _gft } = await import("./lib/ffmpeg-paths");
      const { stderr } = await execFileAsync(_gft(), ["-ss", String(tailStart), "-i", abs, "-af", "volumedetect", "-f", "null", "-"], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      const tailMax = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
      if (tailMax) {
        const m = parseFloat(tailMax[1]);
        metrics.tail_1500ms_max_db = m;
        if (m < -50) { issues.push({ severity: "high", message: `last 1.5s is silent (max ${m}dB) — narration likely cut off` }); score -= 25; }
      }
    } catch (_e) { logSilentCatch("server/deliverable-grader.ts:tail-volumedetect", _e); }
  }

  const expDur = input.expectedSpec?.expected_duration_sec;
  if (typeof expDur === "number" && expDur > 0 && dur > 0) {
    const drift = Math.abs(dur - expDur) / expDur;
    metrics.duration_drift_ratio = drift;
    if (drift > 0.10) { issues.push({ severity: "medium", message: `duration drift ${(drift * 100).toFixed(1)}% (expected ${expDur}s, got ${dur.toFixed(1)}s)` }); score -= 10; }
  }

  score = Math.max(0, Math.min(100, score));
  const passingBar = 85;
  const critique = issues.length === 0 ? "Audio passes all grader checks." : `Audio grader found ${issues.length} issue(s):\n${issues.map((i) => `- [${i.severity}] ${i.message}`).join("\n")}`;
  return { ok: score >= passingBar, score, passingBar, issues, critique, metrics, graderFormat: "audio" };
}

// ---- PDF grader ----
async function gradePdf(input: GradeInput): Promise<GradeResult> {
  const issues: GradeIssue[] = [];
  const metrics: Record<string, any> = {};
  const fp = input.filePath;
  if (!fp) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "no file_path" }], critique: "no file", metrics: {}, graderFormat: "pdf", skipped: "no_file_path" };
  const abs = path.resolve(fp);
  if (!isPathAllowed(abs)) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "path-jail" }], critique: "rejected", metrics: {}, graderFormat: "pdf", skipped: "path_rejected" };
  if (!fs.existsSync(abs)) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "missing" }], critique: "missing", metrics: {}, graderFormat: "pdf", skipped: "missing" };

  const buf = fs.readFileSync(abs);
  metrics.size_bytes = buf.length;
  let score = 100;
  // PDF magic header
  if (!buf.slice(0, 5).toString("utf8").startsWith("%PDF-")) {
    issues.push({ severity: "high", message: "missing %PDF- header — not a valid PDF" });
    score -= 60;
  } else {
    metrics.pdf_version = buf.slice(0, 8).toString("utf8");
  }
  // EOF marker
  const tail = buf.slice(Math.max(0, buf.length - 1024)).toString("utf8");
  if (!tail.includes("%%EOF")) {
    issues.push({ severity: "high", message: "missing %%EOF marker — file may be truncated" });
    score -= 30;
  }
  // Page count via /Type /Page (rough but ok)
  const text = buf.toString("latin1");
  const pageMatches = text.match(/\/Type\s*\/Page[^s]/g) || [];
  metrics.estimated_page_count = pageMatches.length;
  const minPages = input.expectedSpec?.min_pages;
  const maxPages = input.expectedSpec?.max_pages;
  if (typeof minPages === "number" && pageMatches.length < minPages) {
    issues.push({ severity: "medium", message: `page count ${pageMatches.length} below min ${minPages}` });
    score -= 15;
  }
  if (typeof maxPages === "number" && pageMatches.length > maxPages) {
    issues.push({ severity: "low", message: `page count ${pageMatches.length} above max ${maxPages}` });
    score -= 5;
  }
  // Font embedding — look for /FontFile or /FontFile2 or /FontFile3
  const fontEmbedded = /\/FontFile[23]?\b/.test(text);
  metrics.fonts_embedded = fontEmbedded;
  if (!fontEmbedded) {
    issues.push({ severity: "low", message: "no embedded fonts detected — may render differently on other systems" });
    score -= 5;
  }
  // Bounded size sanity
  if (buf.length < 1024) {
    issues.push({ severity: "high", message: `PDF size ${buf.length}B suspiciously small` });
    score -= 30;
  }

  score = Math.max(0, Math.min(100, score));
  const passingBar = 85;
  const critique = issues.length === 0 ? "PDF passes all grader checks." : `PDF grader found ${issues.length} issue(s):\n${issues.map((i) => `- [${i.severity}] ${i.message}`).join("\n")}`;
  return { ok: score >= passingBar, score, passingBar, issues, critique, metrics, graderFormat: "pdf" };
}

// ---- HTML APP grader (re-runs jsdom smoke + per-app assertion) ----
async function gradeHtmlApp(input: GradeInput): Promise<GradeResult> {
  const issues: GradeIssue[] = [];
  const metrics: Record<string, any> = {};
  const fp = input.filePath;
  if (!fp) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "no file_path" }], critique: "no file", metrics: {}, graderFormat: "html_app", skipped: "no_file_path" };
  const abs = path.resolve(fp);
  if (!isPathAllowed(abs)) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "path-jail" }], critique: "rejected", metrics: {}, graderFormat: "html_app", skipped: "path_rejected" };
  if (!fs.existsSync(abs)) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "missing" }], critique: "missing", metrics: {}, graderFormat: "html_app", skipped: "missing" };

  const html = fs.readFileSync(abs, "utf8");
  metrics.size_bytes = html.length;
  let score = 100;

  if (!/<!doctype html/i.test(html)) { issues.push({ severity: "medium", message: "missing <!doctype html>" }); score -= 5; }
  if (!/<title[^>]*>[^<]+<\/title>/i.test(html)) { issues.push({ severity: "medium", message: "missing or empty <title>" }); score -= 5; }
  if (!/<meta[^>]+viewport/i.test(html)) { issues.push({ severity: "low", message: "no viewport meta — mobile rendering may break" }); score -= 3; }
  if (/<script[^>]+src\s*=/i.test(html)) { issues.push({ severity: "high", message: "external <script src=...> — violates single-file rule" }); score -= 30; }
  if (/<link[^>]+rel\s*=\s*["']?stylesheet[^>]+href\s*=\s*["']?https?:/i.test(html)) { issues.push({ severity: "high", message: "external CDN stylesheet — violates single-file rule" }); score -= 20; }
  if (/document\.write\s*\(/.test(html)) { issues.push({ severity: "low", message: "document.write usage" }); score -= 3; }

  // jsdom smoke
  try {
    const { JSDOM, VirtualConsole } = (await import("jsdom" as any)) as any;
    const vc = new VirtualConsole();
    const consoleErrors: string[] = [];
    vc.on("jsdomError", (e: any) => { consoleErrors.push(String(e?.message || e).slice(0, 300)); });
    // R110 +sec gold-pass-3 — runScripts:"dangerously" REMOVED. Executing
    // LLM-authored JavaScript inside the grader process is a remote-code
    // execution sink. We now do static DOM-structure validation only.
    // (Runtime JS errors that previously surfaced via `consoleErrors` are
    // no longer detectable here; producer-time smoke testing in
    // build_html_app remains the source of runtime correctness signal.)
    const dom = new JSDOM(html, { runScripts: undefined, virtualConsole: vc, pretendToBeVisual: true, url: "about:blank" });
    const doc = dom.window.document;
    metrics.title = doc.title?.trim();
    metrics.body_text_chars = (doc.body?.textContent || "").trim().length;
    metrics.console_error_count = consoleErrors.length;
    if (consoleErrors.length > 0) { issues.push({ severity: "high", message: `${consoleErrors.length} runtime JS error(s); first: ${consoleErrors[0].slice(0, 150)}` }); score -= 20; }
    if (metrics.body_text_chars < 5 && !doc.querySelector("input,button,canvas,svg,select,textarea")) {
      issues.push({ severity: "high", message: "body has no visible content nor interactive elements" });
      score -= 25;
    }
    // Architect CRITICAL fix: NO eval of caller-controlled smoke_assertion in
    // the grader. `build_html_app` already evaluates the smoke_assertion ONCE
    // at creation time (with a constrained call site), and the resulting file
    // is what the grader re-checks. Re-evaluating here on a string that flows
    // through `params.expected_spec` (which Felix can populate from any source
    // including a prompt-injected customer message) is a code-execution sink
    // we don't need. Grader checks structural quality; producer enforced the
    // assertion. If the producer didn't (because the developer didn't supply
    // one), the grader can't retroactively invent one safely.
    metrics.smoke_assertion = "skipped — evaluated at producer time only (W3 safety)";
    try { dom.window.close(); } catch (_e) { logSilentCatch("server/deliverable-grader.ts:dom-close", _e); }
  } catch (e: any) {
    issues.push({ severity: "high", message: `jsdom parse failed: ${e?.message || String(e)}` });
    score -= 40;
  }

  score = Math.max(0, Math.min(100, score));
  const passingBar = 85;
  const critique = issues.length === 0 ? "HTML app passes all grader checks." : `HTML app grader found ${issues.length} issue(s):\n${issues.map((i) => `- [${i.severity}] ${i.message}`).join("\n")}`;
  return { ok: score >= passingBar, score, passingBar, issues, critique, metrics, graderFormat: "html_app" };
}

// ---- SLIDES grader (vision LLM) ----
async function gradeSlides(input: GradeInput): Promise<GradeResult> {
  const issues: GradeIssue[] = [];
  const metrics: Record<string, any> = {};
  const fp = input.filePath;
  if (!fp) {
    return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "no file_path" }], critique: "no file", metrics: {}, graderFormat: "slides", skipped: "no_file_path" };
  }
  const abs = path.resolve(fp);
  if (!isPathAllowed(abs)) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "path-jail" }], critique: "rejected", metrics: {}, graderFormat: "slides", skipped: "path_rejected" };
  if (!fs.existsSync(abs)) return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "missing" }], critique: "missing", metrics: {}, graderFormat: "slides", skipped: "missing" };

  const stat = fs.statSync(abs);
  metrics.size_bytes = stat.size;
  metrics.extension = path.extname(abs).toLowerCase();

  // Lightweight structural checks. PPTX is a zip; PDF (slides exported) we delegate to the PDF grader's structural checks.
  let score = 100;

  if (metrics.extension === ".pdf") {
    // Reuse PDF structural grader for the slides-as-PDF export.
    const pdfRes = await gradePdf({ ...input, deliverableType: "pdf" });
    issues.push(...pdfRes.issues);
    metrics.pdf_metrics = pdfRes.metrics;
    score = Math.min(score, pdfRes.score);

    // Slide count check via expected_spec.
    const expected = input.expectedSpec?.slide_count;
    if (typeof expected === "number" && pdfRes.metrics?.estimated_page_count) {
      const got = pdfRes.metrics.estimated_page_count;
      if (Math.abs(got - expected) > 1) { issues.push({ severity: "medium", message: `slide count ${got} differs from expected ${expected}` }); score -= 10; }
    }
  } else if (metrics.extension === ".pptx") {
    // PPTX is a zip with /ppt/slides/slideN.xml inside; cheap signature check.
    const buf = fs.readFileSync(abs);
    const isZip = buf[0] === 0x50 && buf[1] === 0x4B; // 'PK'
    if (!isZip) { issues.push({ severity: "high", message: "not a valid PPTX (zip header missing)" }); score -= 50; }
    if (buf.length < 5000) { issues.push({ severity: "high", message: `PPTX size ${buf.length}B suspiciously small` }); score -= 30; }
  } else {
    issues.push({ severity: "medium", message: `unexpected slides extension '${metrics.extension}' (expected .pptx or .pdf)` });
    score -= 10;
  }

  // The deep "vision check that slide 5 has a photo" pass requires rendered
  // thumbnails. If the caller passes a `thumbnail_paths` array via expectedSpec
  // (R98.6 style), we run a vision LLM on them. Otherwise we skip with a note
  // — better to be honest than to hallucinate a vision verdict.
  const rawThumbs = (input.expectedSpec as any)?.thumbnail_paths as string[] | undefined;
  const requiresPhotoOn = input.expectedSpec?.requires_photo_on;
  // Architect HIGH fix: validate thumbnail entries before passing to vision
  // LLM. Reject anything that isn't a local path under our path-jail OR a
  // data: URI. NO http(s) / file: / ftp: URLs — those are SSRF surfaces. The
  // slides exporter writes thumbnails to disk; they should never be remote.
  // Convert local paths to data: URIs the model client can render directly.
  let thumbs: string[] | undefined;
  if (Array.isArray(rawThumbs) && rawThumbs.length > 0) {
    const validated: string[] = [];
    const rejected: string[] = [];
    for (const t of rawThumbs.slice(0, 12)) {
      const s = String(t || "").trim();
      if (!s) continue;
      if (s.startsWith("data:image/")) { validated.push(s); continue; }
      // Treat as local path; resolve + jail-check + read + base64-encode.
      try {
        const tabs = path.resolve(s);
        if (!isPathAllowed(tabs)) { rejected.push(`${s.slice(0, 60)}: outside path-jail`); continue; }
        if (!fs.existsSync(tabs)) { rejected.push(`${s.slice(0, 60)}: missing`); continue; }
        const ext = path.extname(tabs).toLowerCase().slice(1);
        const mime = ext === "png" ? "image/png" : (ext === "jpg" || ext === "jpeg") ? "image/jpeg" : ext === "webp" ? "image/webp" : null;
        if (!mime) { rejected.push(`${s.slice(0, 60)}: unsupported ext`); continue; }
        const buf = fs.readFileSync(tabs);
        if (buf.length > 8 * 1024 * 1024) { rejected.push(`${s.slice(0, 60)}: >8MB`); continue; }
        validated.push(`data:${mime};base64,${buf.toString("base64")}`);
      } catch (e: any) {
        rejected.push(`${s.slice(0, 60)}: ${e?.message || String(e)}`);
      }
    }
    if (rejected.length > 0) {
      metrics.thumbnail_rejected = rejected;
      issues.push({ severity: "low", message: `${rejected.length} thumbnail(s) rejected by safety check (must be local files under allowed roots, ≤8MB, png/jpg/webp).` });
    }
    thumbs = validated.length > 0 ? validated : undefined;
  }
  if (Array.isArray(thumbs) && thumbs.length > 0) {
    metrics.thumbnail_count = thumbs.length;
    try {
      const visionPrompt = `You are grading a slide deck for professional quality. For each slide thumbnail (numbered 1..${thumbs.length}), assess:
- Does it have a meaningful image/photo (vs. text-only)? Important for slides flagged as needing a photo: ${JSON.stringify(requiresPhotoOn || [])}
- Is the layout clean, with no text overlap or cutoff?
- Are colors readable (sufficient contrast)?

Output JSON: {slides: [{n, has_image, layout_ok, contrast_ok, notes}], overall_quality_0_100, critical_issues:[strings]}`;
      const vRes = await runLlmTask({
        tenantId: input.tenantId,
        prompt: visionPrompt,
        model: input.model || "gemini-2.5-flash",
        images: thumbs.slice(0, 12), // already validated + base64-encoded above; cap for cost
        timeoutMs: 60000,
        temperature: 0.1,
        maxTokens: 4000,
        schema: {
          type: "object",
          required: ["slides", "overall_quality_0_100"],
          properties: {
            slides: { type: "array", items: { type: "object", properties: { n: { type: "number" }, has_image: { type: "boolean" }, layout_ok: { type: "boolean" }, contrast_ok: { type: "boolean" }, notes: { type: "string" } } } },
            overall_quality_0_100: { type: "number" },
            critical_issues: { type: "array", items: { type: "string" } },
          },
        },
      });
      const vJson = (vRes as any)?.json;
      if (vJson) {
        metrics.vision = vJson;
        const overall = Number(vJson.overall_quality_0_100) || 0;
        score = Math.min(score, overall);
        for (const ci of (vJson.critical_issues || []).slice(0, 5)) issues.push({ severity: "high", message: `vision: ${String(ci).slice(0, 200)}` });
        // Photo-on-required-slides enforcement
        if (Array.isArray(requiresPhotoOn) && Array.isArray(vJson.slides)) {
          for (const reqIdx of requiresPhotoOn) {
            const s = vJson.slides.find((x: any) => Number(x.n) === Number(reqIdx));
            if (s && s.has_image === false) { issues.push({ severity: "high", message: `slide ${reqIdx} required a photo but none detected (R98.6)` }); score -= 15; }
          }
        }
      }
    } catch (e: any) {
      issues.push({ severity: "low", message: `vision grader call failed: ${e?.message || String(e)}` });
    }
  } else {
    metrics.vision = "skipped — no thumbnail_paths provided in expected_spec";
  }

  score = Math.max(0, Math.min(100, score));
  const passingBar = 85;
  const critique = issues.length === 0 ? "Slides pass all grader checks." : `Slides grader found ${issues.length} issue(s):\n${issues.map((i) => `- [${i.severity}] ${i.message}`).join("\n")}`;
  return { ok: score >= passingBar, score, passingBar, issues, critique, metrics, graderFormat: "slides" };
}

// ---- IMAGE grader ----
async function gradeImage(input: GradeInput): Promise<GradeResult> {
  const issues: GradeIssue[] = [];
  const metrics: Record<string, any> = {};
  const fp = input.filePath;
  if (!fp) return { ok: false, score: 0, passingBar: 80, issues: [{ severity: "high", message: "no file_path" }], critique: "no file", metrics: {}, graderFormat: "image", skipped: "no_file_path" };
  const abs = path.resolve(fp);
  if (!isPathAllowed(abs)) return { ok: false, score: 0, passingBar: 80, issues: [{ severity: "high", message: "path-jail" }], critique: "rejected", metrics: {}, graderFormat: "image", skipped: "path_rejected" };
  if (!fs.existsSync(abs)) return { ok: false, score: 0, passingBar: 80, issues: [{ severity: "high", message: "missing" }], critique: "missing", metrics: {}, graderFormat: "image", skipped: "missing" };

  const stat = fs.statSync(abs);
  metrics.size_bytes = stat.size;
  let score = 100;
  if (stat.size < 1024) { issues.push({ severity: "high", message: `image size ${stat.size}B suspiciously small` }); score -= 50; }
  // Magic bytes
  const buf = fs.readFileSync(abs, { encoding: null }).slice(0, 12);
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  const isJpg = buf[0] === 0xFF && buf[1] === 0xD8;
  const isWebp = buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP";
  metrics.format = isPng ? "png" : isJpg ? "jpg" : isWebp ? "webp" : "unknown";
  if (metrics.format === "unknown") { issues.push({ severity: "high", message: "unrecognized image format (not PNG/JPG/WebP)" }); score -= 40; }
  score = Math.max(0, Math.min(100, score));
  const passingBar = 80;
  const critique = issues.length === 0 ? "Image passes all grader checks." : `Image grader found ${issues.length} issue(s):\n${issues.map((i) => `- [${i.severity}] ${i.message}`).join("\n")}`;
  return { ok: score >= passingBar, score, passingBar, issues, critique, metrics, graderFormat: "image" };
}

export async function gradeDeliverable(input: GradeInput): Promise<GradeResult> {
  if (typeof input.tenantId !== "number" || input.tenantId <= 0) {
    return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "high", message: "tenantId required" }], critique: "no tenant", metrics: {}, graderFormat: "unsupported", skipped: "no_tenant" };
  }
  const fmt = normalizeFormat(input.deliverableType);
  let result: GradeResult;
  switch (fmt) {
    case "video": result = await gradeVideo(input); break;
    case "audio": result = await gradeAudio(input); break;
    case "pdf": result = await gradePdf(input); break;
    case "slides": result = await gradeSlides(input); break;
    case "html_app": result = await gradeHtmlApp(input); break;
    case "image": result = await gradeImage(input); break;
    default:
      return { ok: false, score: 0, passingBar: 85, issues: [{ severity: "low", message: `format '${input.deliverableType}' not gradable yet — falling back to verify_deliverable only` }], critique: `Grader doesn't support '${input.deliverableType}'.`, metrics: {}, graderFormat: "unsupported", skipped: "unsupported_format" };
  }
  // R106 N3 — uniformly surface near-miss hints across all 6 grader formats.
  const nm = deriveNearMiss(result);
  if (nm) {
    result.nearMissDimension = nm.nearMissDimension;
    result.nearMissNote = nm.nearMissNote;
    result.critique = `${result.critique}\n[NEAR-MISS] ${nm.nearMissNote}`;
  }
  return result;
}
