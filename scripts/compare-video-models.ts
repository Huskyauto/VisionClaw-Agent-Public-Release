/**
 * Head-to-head video-model comparison harness.
 *
 * Runs the SAME prompt through N candidate Google video models, saves each
 * output to data/video-model-comparison/<run-id>/<model>.mp4, and prints a
 * comparison table with latency, file size, resolution, and duration so Bob
 * can pick the winner by watching.
 *
 * Default candidates (Google video-gen model family as of May 2026 — edit the
 * MODELS const or pass --models to override):
 *   - veo-3.1-generate-preview        (Veo 3.1 top-tier, our current default)
 *   - veo-3.1-fast-generate-preview   (Veo 3.1 fast, lower-cost / faster)
 *   - veo-3.0-generate-001            (Veo 3.0 GA, previous-gen baseline)
 *
 * Note: "gemini-omni-flash" was a placeholder. The showdown confirmed Google
 * never shipped that literal id (52 models surveyed). "Omni Flash" in Bob's
 * vocabulary === Veo 3.1 top-tier. Pass it via --models if you want to
 * re-verify the 404; it's no longer in DEFAULT_MODELS.
 *
 * Usage:
 *   GEMINI_OMNI_FLASH_ENABLED=true \
 *     npx tsx scripts/compare-video-models.ts \
 *     --prompt "a slow dolly across a sunlit coffee cup, cinematic, shallow depth of field" \
 *     [--models veo-3.1-generate-preview,veo-3.1-fast-generate-preview,veo-3.0-generate-001] \
 *     [--duration 6] \
 *     [--aspect 16:9]
 *
 * Output:
 *   data/video-model-comparison/<run-id>/
 *     ├── prompt.txt
 *     ├── <model>.mp4          (one per successful model)
 *     ├── <model>.error.txt    (one per failed model)
 *     └── report.md            (comparison table + verdict template)
 *
 * Exit codes:
 *   0 — at least one model succeeded
 *   1 — config problem (disabled, no key, bad flag)
 *   2 — all models failed
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { generateOmniFlashClip, OmniFlashError, isOmniFlashEnabled, getOmniFlashConfig } from "../server/video/gemini-omni-flash";

const DEFAULT_MODELS = [
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.0-generate-001",
];

type ArgMap = Record<string, string>;
function parseArgs(argv: string[]): ArgMap {
  const out: ArgMap = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[k] = v;
    }
  }
  return out;
}

interface ModelResult {
  model: string;
  ok: boolean;
  videoPath?: string;
  errorMessage?: string;
  latencyMs?: number;
  fileSizeBytes?: number;
  resolution?: string;
  durationSec?: number;
  pollAttempts?: number;
}

function probeVideo(filePath: string): { resolution?: string; durationSec?: number } {
  try {
    const res = spawnSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height:format=duration",
      "-of", "default=noprint_wrappers=1:nokey=0",
      filePath,
    ], { encoding: "utf8" });
    const out = res.stdout || "";
    const w = out.match(/width=(\d+)/)?.[1];
    const h = out.match(/height=(\d+)/)?.[1];
    const d = out.match(/duration=([\d.]+)/)?.[1];
    return {
      resolution: w && h ? `${w}x${h}` : undefined,
      durationSec: d ? Math.round(parseFloat(d) * 10) / 10 : undefined,
    };
  } catch {
    return {};
  }
}

async function runOne(model: string, prompt: string, durationSec: number, aspect: "16:9" | "9:16" | "1:1", outDir: string): Promise<ModelResult> {
  const t0 = Date.now();
  try {
    const r = await generateOmniFlashClip({
      prompt, durationSec, aspectRatio: aspect, outDir,
      modelOverride: model,
    });
    // Rename for clarity
    const dest = path.join(outDir, `${safeName(model)}.mp4`);
    if (r.videoPath !== dest) fs.renameSync(r.videoPath, dest);
    const stat = fs.statSync(dest);
    const probe = probeVideo(dest);
    return {
      model, ok: true, videoPath: dest,
      latencyMs: r.latencyMs, fileSizeBytes: stat.size,
      resolution: probe.resolution, durationSec: probe.durationSec,
      pollAttempts: r.pollAttempts,
    };
  } catch (e: any) {
    const msg = e instanceof OmniFlashError ? e.message : String(e?.message || e);
    const errPath = path.join(outDir, `${safeName(model)}.error.txt`);
    fs.writeFileSync(errPath, `${msg}\n\n${e?.cause ? JSON.stringify(e.cause, null, 2) : ""}`);
    return { model, ok: false, errorMessage: msg, latencyMs: Date.now() - t0 };
  }
}

function safeName(s: string) { return s.replace(/[^a-z0-9._-]/gi, "_"); }

function fmtBytes(n?: number) {
  if (n == null) return "—";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

function fmtMs(n?: number) { return n == null ? "—" : `${(n / 1000).toFixed(1)}s`; }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prompt = args.prompt || "a slow dolly shot of a sunlit coffee cup on a wooden table, cinematic, shallow depth of field, 24fps";
  const models = (args.models || DEFAULT_MODELS.join(",")).split(",").map(s => s.trim()).filter(Boolean);
  const durationSec = Math.max(1, Math.min(10, parseInt(args.duration || "6", 10)));
  const aspect = (args.aspect || "16:9") as "16:9" | "9:16" | "1:1";

  if (!isOmniFlashEnabled()) {
    console.error("[compare] GEMINI_OMNI_FLASH_ENABLED is not 'true' — set it and retry.");
    process.exit(1);
  }
  const cfg = getOmniFlashConfig();
  if (!cfg.apiKey) {
    console.error("[compare] no API key on AI_INTEGRATIONS_GEMINI_API_KEY or GOOGLE_API_KEY.");
    process.exit(1);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.resolve("data/video-model-comparison", runId);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "prompt.txt"), `${prompt}\n\nduration=${durationSec}s aspect=${aspect}\nmodels: ${models.join(", ")}\n`);

  console.log(`[compare] run ${runId}`);
  console.log(`[compare] prompt: ${prompt}`);
  console.log(`[compare] models: ${models.join(", ")}`);
  console.log(`[compare] out: ${outDir}\n`);

  // Run sequentially to avoid quota bursts; each Veo job is the bottleneck anyway
  const results: ModelResult[] = [];
  for (const model of models) {
    process.stdout.write(`[compare] ${model}: running... `);
    const r = await runOne(model, prompt, durationSec, aspect, outDir);
    if (r.ok) {
      console.log(`OK ${fmtMs(r.latencyMs)} ${fmtBytes(r.fileSizeBytes)} ${r.resolution || "?"} ${r.durationSec ?? "?"}s`);
    } else {
      console.log(`FAIL — ${r.errorMessage?.slice(0, 120)}`);
    }
    results.push(r);
  }

  // Write report
  const okCount = results.filter(r => r.ok).length;
  const lines: string[] = [];
  lines.push(`# Video Model Comparison — ${runId}\n`);
  lines.push(`**Prompt:** ${prompt}\n`);
  lines.push(`**Duration target:** ${durationSec}s · **Aspect:** ${aspect}\n`);
  lines.push(`**Result:** ${okCount}/${results.length} models succeeded\n`);
  lines.push(`| Model | Status | Latency | Size | Resolution | Duration | Poll Attempts |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const r of results) {
    lines.push(`| \`${r.model}\` | ${r.ok ? "✅" : "❌"} | ${fmtMs(r.latencyMs)} | ${fmtBytes(r.fileSizeBytes)} | ${r.resolution || "—"} | ${r.durationSec ?? "—"}s | ${r.pollAttempts ?? "—"} |`);
  }
  lines.push(`\n## Files\n`);
  for (const r of results) {
    if (r.ok) lines.push(`- **${r.model}** → \`${path.relative(process.cwd(), r.videoPath!)}\``);
    else lines.push(`- ~~${r.model}~~ — see \`${safeName(r.model)}.error.txt\``);
  }
  lines.push(`\n## Verdict template (fill in after watching)\n`);
  lines.push(`- Winner: \`<model>\``);
  lines.push(`- Reason: <prompt adherence / motion quality / lighting / artifacts / cost>`);
  lines.push(`- Action: set \`GEMINI_OMNI_FLASH_MODEL=<winner>\` in Secrets and re-run smoke to lock it in.`);

  fs.writeFileSync(path.join(outDir, "report.md"), lines.join("\n") + "\n");

  console.log(`\n[compare] report: ${path.join(outDir, "report.md")}`);
  console.log(`[compare] watch the .mp4 files side-by-side and tell me which wins.`);
  process.exit(okCount > 0 ? 0 : 2);
}

main();
