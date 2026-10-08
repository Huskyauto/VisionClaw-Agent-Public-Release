// Structural quality sensor for the VisionClaw codebase.
//
// Inspired by the open-source `sentrux` Rust architectural sensor (5 metrics →
// 0-10000 score, MCP-served). This is a pure-TypeScript reimplementation
// tailored to VC's monorepo: no Rust toolchain, no AST, no language-server
// dependency. It's designed to be CHEAP — under 2 seconds on the full repo —
// and runs in the same Node process as the chat engine so any persona can call
// it via the `quality_baseline_*` tools.
//
// What it scans (server/, shared/, client/src/, scripts/ by default):
//   • file count
//   • total LOC (non-blank, non-comment-line lines)
//   • god-files (>1000 LOC) — VC has chronic god-files (tools.ts, chat-engine.ts)
//     so the metric is "count + their names" not just count
//   • biggest file (LOC + path)
//   • directory LOC distribution (top 5 dirs by LOC)
//   • coupling: top fan-in files (most-imported) + top fan-out files (importing
//     the most other modules) via simple regex import scan
//   • cycles: optional, only if `madge` is on PATH (we don't add it as a dep)
//
// What it does NOT do: anything that needs a parser. We learn from sentrux's
// philosophy ("structural signals over deep semantics") but VC has scripts, TS,
// JSON, markdown all mixed; a regex pass is good enough to catch trends.

import * as fs from "fs";
import { logSilentCatch } from "../lib/silent-catch";
import * as path from "path";

export interface StructuralSnapshot {
  takenAt: string;             // ISO timestamp
  rootsScanned: string[];      // e.g. ["server", "shared", "client/src", "scripts"]
  durationMs: number;          // how long the scan took
  fileCount: number;
  totalLoc: number;
  godFiles: { path: string; loc: number }[];   // sorted desc by loc, all >1000
  biggestFile: { path: string; loc: number } | null;
  topDirsByLoc: { dir: string; loc: number; files: number }[]; // top 5
  topFanIn: { path: string; importedByCount: number }[];       // top 10
  topFanOut: { path: string; importsCount: number }[];         // top 10
  cycles: { detected: boolean; count: number; sample?: string[] };
  score: number;               // 0-10000 (higher = healthier)
  scoreBreakdown: Record<string, number>;
}

export interface BaselineDelta {
  label: string;
  baselineAt: string;
  currentAt: string;
  scoreDelta: number;          // positive = healthier
  fileCountDelta: number;
  totalLocDelta: number;
  newGodFiles: string[];       // god files in current that weren't in baseline
  godFilesGrown: { path: string; baselineLoc: number; currentLoc: number; delta: number }[];
  regressed: boolean;          // score dropped by >100 OR new god file appeared
  notes: string[];
}

const DEFAULT_ROOTS = ["server", "shared", "client/src", "scripts"];
const SKIP_DIR_NAMES = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage", ".cache",
  "attached_assets", "uploads", ".local", ".replit", "data",
]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const GOD_FILE_THRESHOLD = 1000;
const BASELINE_FILE = ".local/structural-baselines.json";

// ─── walk + read ──────────────────────────────────────────────────────────────

function walkCodeFiles(root: string, workspaceRoot: string, out: string[]): void {
  const abs = path.isAbsolute(root) ? root : path.resolve(workspaceRoot, root);
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (SKIP_DIR_NAMES.has(e.name)) continue;
    const full = path.join(abs, e.name);
    if (e.isDirectory()) {
      walkCodeFiles(full, workspaceRoot, out);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (CODE_EXTENSIONS.has(ext)) out.push(full);
    }
  }
}

function countLoc(filePath: string): number {
  try {
    const txt = fs.readFileSync(filePath, "utf-8");
    let loc = 0;
    for (const raw of txt.split("\n")) {
      const t = raw.trim();
      if (!t) continue;
      if (t.startsWith("//")) continue;
      if (t.startsWith("/*") && t.endsWith("*/")) continue;
      loc++;
    }
    return loc;
  } catch {
    return 0;
  }
}

// ─── coupling (regex import scan) ─────────────────────────────────────────────

const IMPORT_RE = /(?:^|\n)\s*(?:import\s+[^;]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\))/g;

function extractImports(filePath: string): string[] {
  try {
    const txt = fs.readFileSync(filePath, "utf-8");
    const found: string[] = [];
    let m: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(txt)) !== null) {
      const spec = m[1] || m[2] || m[3];
      if (spec) found.push(spec);
    }
    return found;
  } catch {
    return [];
  }
}

// Resolve a relative import to a workspace-relative path (best-effort).
function resolveLocal(fromFile: string, spec: string, workspaceRoot: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/") && !spec.startsWith("@shared/")) {
    return null; // node_modules / external
  }
  let basePath: string;
  if (spec.startsWith("@/")) {
    basePath = path.resolve(workspaceRoot, "client/src", spec.slice(2));
  } else if (spec.startsWith("@shared/")) {
    basePath = path.resolve(workspaceRoot, "shared", spec.slice(8));
  } else {
    basePath = path.resolve(path.dirname(fromFile), spec);
  }
  for (const ext of [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]) {
    const candidate = basePath + ext;
    if (fs.existsSync(candidate)) {
      return path.relative(workspaceRoot, candidate);
    }
  }
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
    return path.relative(workspaceRoot, basePath);
  }
  return null;
}

// ─── score ────────────────────────────────────────────────────────────────────
//
// 10000 = perfect. We deduct points per signal, capped, so a score of 6000 is
// still a healthy codebase. The point of the score is to detect REGRESSIONS
// (delta < -100), not to give a moral grade.

function computeScore(snap: Omit<StructuralSnapshot, "score" | "scoreBreakdown">): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let score = 10000;

  // God files: -100 per god file, capped at -2000.
  const godPenalty = Math.min(snap.godFiles.length * 100, 2000);
  score -= godPenalty;
  breakdown.god_files_penalty = -godPenalty;

  // Biggest file size: linearly -1 per 100 LOC over 2000, capped at -1000.
  if (snap.biggestFile) {
    const over = Math.max(0, snap.biggestFile.loc - 2000);
    const bigPenalty = Math.min(Math.floor(over / 100) * 10, 1000);
    score -= bigPenalty;
    breakdown.biggest_file_penalty = -bigPenalty;
  }

  // Top fan-in concentration: if one file is imported by >40 others, -300.
  const topIn = snap.topFanIn[0];
  if (topIn && topIn.importedByCount > 40) {
    const fanInPenalty = Math.min((topIn.importedByCount - 40) * 10, 500);
    score -= fanInPenalty;
    breakdown.fan_in_penalty = -fanInPenalty;
  }

  // Top fan-out: if one file imports >50 modules, -300 (god orchestrator).
  const topOut = snap.topFanOut[0];
  if (topOut && topOut.importsCount > 50) {
    const fanOutPenalty = Math.min((topOut.importsCount - 50) * 10, 500);
    score -= fanOutPenalty;
    breakdown.fan_out_penalty = -fanOutPenalty;
  }

  // Cycles: -200 per cycle detected (only counted if madge ran).
  if (snap.cycles.detected) {
    const cyclePenalty = Math.min(snap.cycles.count * 200, 1500);
    score -= cyclePenalty;
    breakdown.cycles_penalty = -cyclePenalty;
  }

  return { score: Math.max(0, score), breakdown };
}

// ─── public API ───────────────────────────────────────────────────────────────

export interface ScanOptions {
  roots?: string[];                         // default: server, shared, client/src, scripts
  includeCycles?: boolean;                  // default: false (madge is optional)
  workspaceRoot?: string;                   // default: process.cwd()
}

export async function scanStructure(opts: ScanOptions = {}): Promise<StructuralSnapshot> {
  const start = Date.now();
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const roots = opts.roots || DEFAULT_ROOTS;

  // 1. enumerate files
  const files: string[] = [];
  for (const r of roots) walkCodeFiles(r, workspaceRoot, files);

  // 2. LOC per file
  const fileLocs = new Map<string, number>();
  let totalLoc = 0;
  for (const f of files) {
    const loc = countLoc(f);
    fileLocs.set(f, loc);
    totalLoc += loc;
  }

  // 3. god files
  const godFiles = Array.from(fileLocs.entries())
    .filter(([, loc]) => loc > GOD_FILE_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([p, loc]) => ({ path: path.relative(workspaceRoot, p), loc }));

  // 4. biggest file
  let biggestFile: { path: string; loc: number } | null = null;
  for (const [p, loc] of fileLocs.entries()) {
    if (!biggestFile || loc > biggestFile.loc) {
      biggestFile = { path: path.relative(workspaceRoot, p), loc };
    }
  }

  // 5. top dirs by LOC
  const dirAgg = new Map<string, { loc: number; files: number }>();
  for (const [p, loc] of fileLocs.entries()) {
    const rel = path.relative(workspaceRoot, p);
    const parts = rel.split(path.sep);
    const topDir = parts.slice(0, 2).join("/"); // e.g. "server" or "client/src"
    const cur = dirAgg.get(topDir) || { loc: 0, files: 0 };
    cur.loc += loc;
    cur.files += 1;
    dirAgg.set(topDir, cur);
  }
  const topDirsByLoc = Array.from(dirAgg.entries())
    .map(([dir, v]) => ({ dir, loc: v.loc, files: v.files }))
    .sort((a, b) => b.loc - a.loc)
    .slice(0, 5);

  // 6. coupling
  const importsByFile = new Map<string, string[]>(); // file -> list of resolved local imports (workspace-relative)
  const fanInCount = new Map<string, number>();      // workspace-relative -> count
  for (const f of files) {
    const specs = extractImports(f);
    const localImports: string[] = [];
    for (const s of specs) {
      const resolved = resolveLocal(f, s, workspaceRoot);
      if (resolved) {
        localImports.push(resolved);
        fanInCount.set(resolved, (fanInCount.get(resolved) || 0) + 1);
      }
    }
    importsByFile.set(path.relative(workspaceRoot, f), localImports);
  }
  const topFanIn = Array.from(fanInCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([p, c]) => ({ path: p, importedByCount: c }));
  const topFanOut = Array.from(importsByFile.entries())
    .map(([p, list]) => ({ path: p, importsCount: list.length }))
    .sort((a, b) => b.importsCount - a.importsCount)
    .slice(0, 10);

  // 7. cycles (optional)
  let cycles: StructuralSnapshot["cycles"] = { detected: false, count: 0 };
  if (opts.includeCycles) {
    try {
      const { spawnSync } = await import("child_process");
      const r = spawnSync("npx", ["madge", "--circular", "--extensions", "ts,tsx", "server/"], {
        cwd: workspaceRoot,
        timeout: 15000,
        encoding: "utf-8",
      });
      if (r.status === 0 && r.stdout) {
        const lines = r.stdout.split("\n").filter(l => l.trim() && !l.startsWith("Processed"));
        cycles = {
          detected: lines.length > 0,
          count: lines.length,
          sample: lines.slice(0, 3),
        };
      }
    } catch (_silentErr) { logSilentCatch("server/sensors/structural-signal.ts", _silentErr); }
  }

  const partial: Omit<StructuralSnapshot, "score" | "scoreBreakdown"> = {
    takenAt: new Date().toISOString(),
    rootsScanned: roots,
    durationMs: Date.now() - start,
    fileCount: files.length,
    totalLoc,
    godFiles,
    biggestFile,
    topDirsByLoc,
    topFanIn,
    topFanOut,
    cycles,
  };
  const { score, breakdown } = computeScore(partial);
  return { ...partial, score, scoreBreakdown: breakdown };
}

// ─── baseline persistence ─────────────────────────────────────────────────────

interface BaselineFile {
  baselines: Record<string, StructuralSnapshot>;
  updatedAt: string;
}

function readBaselineFile(workspaceRoot: string): BaselineFile {
  const p = path.resolve(workspaceRoot, BASELINE_FILE);
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.baselines) return parsed as BaselineFile;
    }
  } catch (_silentErr) { logSilentCatch("server/sensors/structural-signal.ts", _silentErr); }
  return { baselines: {}, updatedAt: new Date().toISOString() };
}

function writeBaselineFile(workspaceRoot: string, data: BaselineFile): void {
  const p = path.resolve(workspaceRoot, BASELINE_FILE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

export async function saveBaseline(label: string, opts: ScanOptions = {}): Promise<StructuralSnapshot> {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const safeLabel = String(label || "").trim().replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
  if (!safeLabel) throw new Error("saveBaseline requires a non-empty label");
  const snap = await scanStructure(opts);
  const file = readBaselineFile(workspaceRoot);
  file.baselines[safeLabel] = snap;
  file.updatedAt = new Date().toISOString();
  writeBaselineFile(workspaceRoot, file);
  return snap;
}

export async function compareToBaseline(label: string, opts: ScanOptions = {}): Promise<{ baseline: StructuralSnapshot | null; current: StructuralSnapshot; delta: BaselineDelta | null }> {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const safeLabel = String(label || "").trim().replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
  const file = readBaselineFile(workspaceRoot);
  const baseline = file.baselines[safeLabel] || null;
  const current = await scanStructure(opts);
  if (!baseline) return { baseline: null, current, delta: null };

  const baselineGodSet = new Set(baseline.godFiles.map(g => g.path));
  const newGodFiles = current.godFiles.filter(g => !baselineGodSet.has(g.path)).map(g => g.path);
  const baselineGodMap = new Map(baseline.godFiles.map(g => [g.path, g.loc]));
  const godFilesGrown = current.godFiles
    .filter(g => baselineGodMap.has(g.path) && g.loc > (baselineGodMap.get(g.path) || 0) + 50)
    .map(g => ({
      path: g.path,
      baselineLoc: baselineGodMap.get(g.path) || 0,
      currentLoc: g.loc,
      delta: g.loc - (baselineGodMap.get(g.path) || 0),
    }));

  const scoreDelta = current.score - baseline.score;
  const regressed = scoreDelta < -100 || newGodFiles.length > 0;
  const notes: string[] = [];
  if (newGodFiles.length > 0) notes.push(`NEW god file(s): ${newGodFiles.join(", ")}`);
  if (godFilesGrown.length > 0) notes.push(`${godFilesGrown.length} existing god file(s) grew >50 LOC`);
  if (scoreDelta < -100) notes.push(`Score dropped ${-scoreDelta} points (${baseline.score} → ${current.score})`);
  if (scoreDelta > 100) notes.push(`Score improved ${scoreDelta} points`);
  if (current.fileCount - baseline.fileCount > 20) notes.push(`+${current.fileCount - baseline.fileCount} new files`);
  if (current.totalLoc - baseline.totalLoc > 2000) notes.push(`+${current.totalLoc - baseline.totalLoc} total LOC`);

  const delta: BaselineDelta = {
    label: safeLabel,
    baselineAt: baseline.takenAt,
    currentAt: current.takenAt,
    scoreDelta,
    fileCountDelta: current.fileCount - baseline.fileCount,
    totalLocDelta: current.totalLoc - baseline.totalLoc,
    newGodFiles,
    godFilesGrown,
    regressed,
    notes,
  };
  return { baseline, current, delta };
}

export async function listBaselines(workspaceRoot?: string): Promise<{ label: string; takenAt: string; score: number }[]> {
  const root = workspaceRoot || process.cwd();
  const file = readBaselineFile(root);
  return Object.entries(file.baselines).map(([label, snap]) => ({
    label,
    takenAt: snap.takenAt,
    score: snap.score,
  }));
}

export async function deleteBaseline(label: string, workspaceRoot?: string): Promise<boolean> {
  const root = workspaceRoot || process.cwd();
  const safeLabel = String(label || "").trim().replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
  const file = readBaselineFile(root);
  if (!(safeLabel in file.baselines)) return false;
  delete file.baselines[safeLabel];
  file.updatedAt = new Date().toISOString();
  writeBaselineFile(root, file);
  return true;
}
