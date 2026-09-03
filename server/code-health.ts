/**
 * Code Health Scanner — VisionClaw's "BS Detector".
 *
 * Inspired by OpenSwarm's static-analysis registry and SocratiCode's
 * resumable-indexing checkpoint pattern, this scans the codebase for known
 * bad-smell patterns and writes findings to the `code_health_*` tables.
 * Run on demand from the admin UI or via `tsx scripts/code-health-scan.ts`.
 *
 * Patterns detected:
 *   - critical: empty catch block, hardcoded secret-looking string
 *   - warning:  `as any`, `// @ts-ignore`, console.log left in server code
 *   - info:     TODO/FIXME/HACK comments, files >2000 lines (complexity proxy)
 *
 * Skips: node_modules, .git, dist, attached_assets, *.test.*, the scanner itself.
 *
 * R74.13v — Resumable scans (SocratiCode-pattern borrow):
 *   The scan now persists a JSON checkpoint to .local/code-health-checkpoint.json
 *   after every CHECKPOINT_BATCH files. If the process crashes / is killed mid-scan,
 *   the next invocation reads the checkpoint, skips already-scanned files, and
 *   resumes with the previously-collected findings intact. On clean completion the
 *   checkpoint file is deleted. Schema-free (per the no-schema-edits rule).
 */
import { readdir, readFile, stat, mkdir, writeFile, rm, rename } from "node:fs/promises";
import { logSilentCatch } from "./lib/silent-catch";
import path from "node:path";
import { db } from "./db";
import { codeHealthFindings, codeHealthScans } from "@shared/schema";

interface Finding {
  filePath: string;
  lineNumber: number;
  category: string;
  severity: "critical" | "warning" | "info";
  pattern: string;
  snippet: string;
}

interface Checkpoint {
  scanId: string;
  startedAt: number;
  lastUpdatedAt: number;
  completedFiles: string[];     // every file already scanned (for resume-skip)
  findings: Finding[];          // accumulated findings so we don't lose them
}

const SCAN_ROOTS = ["server", "client/src", "shared", "scripts"];
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".cache",
  "attached_assets", ".local", "__tests__", "__mocks__",
]);
const SKIP_FILE_PATTERNS = [/\.test\./, /\.spec\./, /\.d\.ts$/, /code-health-scan\.ts$/];
const TEXT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const CHECKPOINT_PATH = path.join(process.cwd(), ".local", "code-health-checkpoint.json");
const CHECKPOINT_BATCH = 50;            // write checkpoint every N files
const CHECKPOINT_MAX_AGE_MS = 60 * 60 * 1000;  // 1h — older = treat as stale, ignore

const PATTERNS: Array<{
  name: string;
  category: string;
  severity: "critical" | "warning" | "info";
  regex: RegExp;
  // Optional second-pass guard to suppress obvious false positives
  guard?: (line: string, file: string) => boolean;
}> = [
  {
    name: "empty-catch",
    category: "Error swallowing",
    severity: "critical",
    regex: /catch\s*\([^)]*\)\s*\{\s*\}/,
  },
  {
    name: "hardcoded-secret",
    category: "Possible hardcoded secret",
    severity: "critical",
    regex: /(sk-[A-Za-z0-9]{20,}|secret_key\s*=\s*["'][^"']{8,}|password\s*=\s*["'][^"']{6,})/,
    guard: (line) => !/process\.env|getenv|<REDACTED>|example|placeholder|test/i.test(line),
  },
  {
    name: "as-any",
    category: "Type-safety bypass",
    severity: "warning",
    regex: /\bas\s+any\b/,
  },
  {
    name: "ts-ignore",
    category: "Type-safety bypass",
    severity: "warning",
    regex: /@ts-(ignore|nocheck)/,
  },
  {
    name: "console-log-in-server",
    category: "Stray debug log",
    severity: "warning",
    regex: /\bconsole\.log\s*\(/,
    guard: (_line, file) => file.startsWith("server/") && !file.includes("logger"),
  },
  {
    name: "todo-fixme",
    category: "Unresolved TODO/FIXME/HACK",
    severity: "info",
    regex: /\b(TODO|FIXME|HACK|XXX)\b/,
  },
];

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: string[];
  try { entries = await readdir(dir); } catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let s;
    try { s = await stat(full); } catch { continue; }
    if (s.isDirectory()) {
      yield* walk(full);
    } else if (s.isFile()) {
      if (SKIP_FILE_PATTERNS.some((re) => re.test(full))) continue;
      if (!TEXT_EXTS.has(path.extname(full))) continue;
      yield full;
    }
  }
}

function scanFile(file: string, contents: string): Finding[] {
  const findings: Finding[] = [];
  const lines = contents.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length > 1000) continue;
    for (const p of PATTERNS) {
      if (p.regex.test(line)) {
        if (p.guard && !p.guard(line, file)) continue;
        findings.push({
          filePath: file,
          lineNumber: i + 1,
          category: p.category,
          severity: p.severity,
          pattern: p.name,
          snippet: line.trim().slice(0, 240),
        });
      }
    }
  }
  if (lines.length > 2000) {
    findings.push({
      filePath: file,
      lineNumber: 1,
      category: "High complexity (large file)",
      severity: "info",
      pattern: "large-file",
      snippet: `${lines.length} lines — consider splitting into modules`,
    });
  }
  return findings;
}

async function readCheckpoint(): Promise<Checkpoint | null> {
  try {
    const raw = await readFile(CHECKPOINT_PATH, "utf-8");
    const cp = JSON.parse(raw) as Checkpoint;
    if (!cp.scanId || !Array.isArray(cp.completedFiles) || !Array.isArray(cp.findings)) return null;
    // R74.13v hardening — staleness based on most-recent activity, not original start.
    // A long-running scan that's still actively writing checkpoints should NOT be discarded.
    const lastTouched = typeof cp.lastUpdatedAt === "number" ? cp.lastUpdatedAt : cp.startedAt;
    if (Date.now() - lastTouched > CHECKPOINT_MAX_AGE_MS) return null;
    return cp;
  } catch {
    // Corrupted checkpoint (partial write from a crash) → treat as missing and start fresh.
    return null;
  }
}

async function writeCheckpoint(cp: Checkpoint): Promise<void> {
  try {
    await mkdir(path.dirname(CHECKPOINT_PATH), { recursive: true });
    cp.lastUpdatedAt = Date.now();
    // R74.13v hardening — atomic write: temp file + rename. Crash mid-write leaves the
    // previous valid checkpoint intact instead of producing corrupted JSON.
    const tmp = `${CHECKPOINT_PATH}.tmp.${process.pid}`;
    await writeFile(tmp, JSON.stringify(cp), { mode: 0o600 });
    // R98.16 #6 — fsync before rename so the checkpoint actually survives a crash.
    try {
      const { open } = await import("node:fs/promises");
      const fh = await open(tmp, "r+");
      try { await fh.sync(); } finally { await fh.close(); }
    } catch (_silentErr) { logSilentCatch("server/code-health.ts", _silentErr); }
    await rename(tmp, CHECKPOINT_PATH);
  } catch (err: any) {
    console.warn(`[code-health] checkpoint write failed: ${err?.message}`);
  }
}

async function clearCheckpoint(): Promise<void> {
  try {
    await rm(CHECKPOINT_PATH, { force: true });
  } catch (e) {
    console.warn("[silent-catch] server/code-health.ts (clearCheckpoint best-effort):", (e as any)?.message ?? e);
  }
}

export async function runCodeHealthScan(opts: { quiet?: boolean; resume?: boolean } = {}): Promise<{
  scanId: string;
  filesScanned: number;
  findings: Finding[];
  durationMs: number;
  resumed: boolean;
}> {
  const t0 = Date.now();

  // R74.13v — try to resume a recent interrupted scan unless explicitly told not to.
  let cp: Checkpoint | null = opts.resume === false ? null : await readCheckpoint();
  let resumed = false;
  let scanId: string;
  let findings: Finding[];
  let completed: Set<string>;

  if (cp) {
    resumed = true;
    scanId = cp.scanId;
    findings = cp.findings;
    completed = new Set(cp.completedFiles);
    if (!opts.quiet) {
      console.log(`[code-health] resuming ${scanId} — ${completed.size} files already scanned, ${findings.length} findings collected so far`);
    }
  } else {
    scanId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    findings = [];
    completed = new Set<string>();
  }

  let sinceCheckpoint = 0;

  for (const root of SCAN_ROOTS) {
    for await (const file of walk(root)) {
      if (completed.has(file)) continue;     // resume-skip
      let contents: string;
      try { contents = await readFile(file, "utf-8"); } catch { continue; }
      findings.push(...scanFile(file, contents));
      completed.add(file);
      sinceCheckpoint++;
      if (sinceCheckpoint >= CHECKPOINT_BATCH) {
        await writeCheckpoint({
          scanId,
          startedAt: cp?.startedAt ?? t0,
          lastUpdatedAt: Date.now(),
          completedFiles: Array.from(completed),
          findings,
        });
        sinceCheckpoint = 0;
      }
    }
  }

  const filesScanned = completed.size;
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;
  const durationMs = Date.now() - (cp?.startedAt ?? t0);

  // R74.13v hardening — drop the checkpoint BEFORE writing to the DB. The in-memory
  // findings array is now complete; the checkpoint is no longer useful. Clearing it
  // first prevents a unique-constraint collision on `code_health_scans.scan_id` if the
  // process crashes between insert and checkpoint cleanup and is then resumed.
  await clearCheckpoint();

  await db.insert(codeHealthScans).values({
    scanId,
    filesScanned,
    totalFindings: findings.length,
    criticalCount: critical,
    warningCount: warning,
    infoCount: info,
    durationMs,
  });
  if (findings.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < findings.length; i += BATCH) {
      await db.insert(codeHealthFindings).values(
        findings.slice(i, i + BATCH).map((f) => ({ scanId, ...f })),
      );
    }
  }

  if (!opts.quiet) {
    console.log(`[code-health] ${scanId}${resumed ? " (resumed)" : ""} — scanned ${filesScanned} files in ${durationMs}ms`);
    console.log(`  critical: ${critical}, warning: ${warning}, info: ${info}`);
  }
  return { scanId, filesScanned, findings, durationMs, resumed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCodeHealthScan().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
