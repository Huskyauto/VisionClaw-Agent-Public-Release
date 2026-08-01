// R98.16 #1 — `ijfw_run` style large-output command sandbox.
//
// Problem: every time Felix or Forge runs `npm test`, `tsc`, `npm run build`,
// `grep -r` etc. through slash_command, the full stdout/stderr (capped at
// 8KB per stream) gets pasted back into the LLM context. 99% of that text
// is "✓ pass" lines — pure context tax.
//
// Solution (lifted from IJFW): stream the full output to a sandbox file at
// `data/run-sandbox/<label>.<ext>` (mode 0o600), then return a domain-aware
// summary plus the LAST 10 raw lines (reliability backstop). The full text
// is reachable later by `getRunOutput(label)` for forensics. Auto-purges
// after 24h on the next run.
//
// Inline pass-through: if the captured output is small (≤ INLINE_LINES OR
// ≤ INLINE_BYTES), we skip the sandbox entirely and just return raw — no
// summary overhead for trivial commands.
//
// Summarizers are cheap regex-based (no LLM) and cover the common families:
//   - test runners (jest / vitest / mocha / pytest)
//   - tsc / type-checker output
//   - build output (vite / webpack / esbuild)
//   - grep / ripgrep
//   - log tails (pure pass-through tail)
//   - raw fallback (head + tail + line count)

import * as fs from "node:fs";
import { logSilentCatch } from "./silent-catch";
import * as path from "node:path";
import { sanitizeUntrusted, redactSecrets, buildSecretLits } from "./sanitize-untrusted";
import { atomicWriteFileSync } from "./atomic-write";

const SANDBOX_DIR = path.resolve(process.cwd(), "data", "run-sandbox");
const TTL_MS = 24 * 60 * 60 * 1000;
const INLINE_LINES = 40;
const INLINE_BYTES = 50 * 1024;
const TAIL_LINES = 10;

export type SummaryDomain = "test" | "tsc" | "build" | "grep" | "log" | "raw";

export interface RunCaptureInput {
  label: string;             // short identifier; sanitized to [a-z0-9_-]
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  command?: string;          // captured command, for the manifest only
  domain?: SummaryDomain;    // override; otherwise auto-detected
}

export interface RunCaptureOutput {
  label: string;
  exitCode: number;
  status: "done" | "skipped" | "failed";
  durationMs: number;
  domain: SummaryDomain;
  inline: boolean;           // true → raw stdout/stderr returned as-is
  summary: string;           // domain-aware summary (or full text if inline)
  tail: string;              // last 10 lines of stdout (reliability backstop)
  stdoutBytes: number;
  stderrBytes: number;
  totalBytes: number;
  sandboxPath?: string;      // present when !inline; readable by getRunOutput
}

function ensureDir(): void {
  if (!fs.existsSync(SANDBOX_DIR)) fs.mkdirSync(SANDBOX_DIR, { recursive: true, mode: 0o700 });
}

function purgeOld(): void {
  try {
    if (!fs.existsSync(SANDBOX_DIR)) return;
    const now = Date.now();
    for (const f of fs.readdirSync(SANDBOX_DIR)) {
      try {
        const fp = path.join(SANDBOX_DIR, f);
        const st = fs.statSync(fp);
        if (now - st.mtimeMs > TTL_MS) fs.unlinkSync(fp);
      } catch (_silentErr) { logSilentCatch("server/lib/output-sandbox.ts", _silentErr); }
    }
  } catch (_silentErr) { logSilentCatch("server/lib/output-sandbox.ts", _silentErr); }
}

function safeLabel(label: string): string {
  return (label || "run").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60) || "run";
}

function detectDomain(stdout: string, stderr: string, command?: string): SummaryDomain {
  const cmd = (command || "").toLowerCase();
  const blob = (stdout + "\n" + stderr).slice(0, 4000);
  if (/\b(jest|vitest|mocha|pytest)\b/.test(cmd) || /Tests:\s+\d+ passed|PASS\s|FAIL\s|=+\s*\d+ (?:passed|failed)\s*=+/.test(blob)) return "test";
  if (/\btsc\b/.test(cmd) || /error TS\d{4}:/.test(blob)) return "tsc";
  if (/\b(npm run build|vite build|webpack|esbuild|tsup|rollup)\b/.test(cmd) || /built in \d|building for production/.test(blob)) return "build";
  if (/\b(grep|rg|ripgrep)\b/.test(cmd)) return "grep";
  if (/\btail\b/.test(cmd) || /\.log\b/.test(cmd)) return "log";
  return "raw";
}

function summarize(domain: SummaryDomain, stdout: string, stderr: string): string {
  const lines = (stdout + "\n" + stderr).split("\n");
  switch (domain) {
    case "test": {
      const passMatch = stdout.match(/Tests?:\s+(?:(\d+)\s+failed[^\d]*)?(?:(\d+)\s+passed[^\d]*)?(?:(\d+)\s+skipped[^\d]*)?(?:(\d+)\s+total)?/i);
      const failingNames = lines.filter((l) => /^(?:FAIL|✕|✗|\s+✕|\s+✗)\s/.test(l)).slice(0, 20);
      const summary = passMatch
        ? `Test summary — failed: ${passMatch[1] || 0}, passed: ${passMatch[2] || 0}, skipped: ${passMatch[3] || 0}, total: ${passMatch[4] || "?"}`
        : `Test run — counts not parseable from output.`;
      return failingNames.length
        ? `${summary}\nFailing tests:\n${failingNames.join("\n")}`
        : summary;
    }
    case "tsc": {
      const errs = lines.filter((l) => /error TS\d{4}:/.test(l));
      const head = errs.slice(0, 20);
      return errs.length === 0
        ? `tsc clean — 0 errors.`
        : `tsc — ${errs.length} TypeScript error(s).${head.length ? `\nFirst ${head.length}:\n${head.join("\n")}` : ""}`;
    }
    case "build": {
      const errs = lines.filter((l) => /\b(error|failed|cannot find|not found)\b/i.test(l)).slice(0, 15);
      const builtMatch = stdout.match(/built in (\S+)/i);
      return errs.length
        ? `Build — ${errs.length} error-like line(s).\n${errs.join("\n")}`
        : builtMatch
          ? `Build OK (${builtMatch[1]}).`
          : `Build completed (no errors detected, no timing line found).`;
    }
    case "grep": {
      const matchLines = lines.filter((l) => l.trim().length > 0);
      const fileSet = new Set<string>();
      for (const l of matchLines) {
        const m = l.match(/^([^:]+):\d+:/);
        if (m) fileSet.add(m[1]);
      }
      const topFiles = Array.from(fileSet).slice(0, 10);
      return `Grep — ${matchLines.length} match line(s) across ${fileSet.size} file(s).${topFiles.length ? `\nTop files:\n${topFiles.join("\n")}` : ""}`;
    }
    case "log": {
      const tail = lines.slice(-30).join("\n");
      return `Log tail (last ${Math.min(30, lines.length)} lines):\n${tail}`;
    }
    case "raw":
    default: {
      const head = lines.slice(0, 10).join("\n");
      const tail = lines.slice(-10).join("\n");
      return lines.length <= 25
        ? lines.join("\n")
        : `Head (10 lines):\n${head}\n…[${lines.length - 20} lines elided]…\nTail (10 lines):\n${tail}`;
    }
  }
}

/**
 * Capture a finished command's output, decide inline vs sandbox, return
 * a structured result. Caller (e.g. the run_command tool) is responsible
 * for actually executing the command — this function only handles capture.
 */
export function captureRun(input: RunCaptureInput): RunCaptureOutput {
  ensureDir();
  purgeOld();

  const lits = buildSecretLits();
  const stdoutSafe = redactSecrets(input.stdout || "", lits);
  const stderrSafe = redactSecrets(input.stderr || "", lits);
  const stdoutBytes = Buffer.byteLength(stdoutSafe, "utf-8");
  const stderrBytes = Buffer.byteLength(stderrSafe, "utf-8");
  const totalBytes = stdoutBytes + stderrBytes;
  const totalLines = (stdoutSafe.match(/\n/g)?.length || 0) + (stderrSafe.match(/\n/g)?.length || 0);

  const inline = totalLines <= INLINE_LINES && totalBytes <= INLINE_BYTES;
  const status = input.exitCode === 0 ? "done" : input.exitCode === 77 ? "skipped" : "failed";
  const domain = input.domain || detectDomain(stdoutSafe, stderrSafe, input.command);

  // Tail backstop: last 10 lines of stdout, sanitized.
  const tailRaw = stdoutSafe.split("\n").slice(-TAIL_LINES).join("\n");
  const tail = sanitizeUntrusted(tailRaw, { maxBytes: 4000 });

  if (inline) {
    return {
      label: safeLabel(input.label),
      exitCode: input.exitCode,
      status,
      durationMs: input.durationMs,
      domain,
      inline: true,
      summary: sanitizeUntrusted([stdoutSafe, stderrSafe].filter(Boolean).join("\n--- stderr ---\n"), { maxBytes: INLINE_BYTES }),
      tail,
      stdoutBytes,
      stderrBytes,
      totalBytes,
    };
  }

  // Sandbox path: persist full sanitized output, return summary.
  const label = safeLabel(input.label) + "_" + Date.now().toString(36);
  const sandboxPath = path.join(SANDBOX_DIR, `${label}.txt`);
  try {
    const blob = `# command: ${input.command || "(unknown)"}\n# exit: ${input.exitCode}  duration_ms: ${input.durationMs}\n# domain: ${domain}\n# stdout_bytes: ${stdoutBytes}  stderr_bytes: ${stderrBytes}\n\n--- stdout ---\n${stdoutSafe}\n\n--- stderr ---\n${stderrSafe}\n`;
    // R98.16+sec — architect HIGH fix: was fs.writeFileSync (no fsync,
    // non-atomic). A power loss between write and pagecache-flush would
    // leave a truncated/empty sandbox file — exactly the bug the new
    // atomic-write helper was created to fix. Use it here too.
    // R98.19+sec — was `require()` under "type":"module" → threw at runtime
    // and the catch below silently degraded every sandbox write. Now static.
    atomicWriteFileSync(sandboxPath, blob, { mode: 0o600 });
  } catch (e: any) {
    // Sandbox write failed — degrade gracefully to inline summary only.
    return {
      label,
      exitCode: input.exitCode,
      status,
      durationMs: input.durationMs,
      domain,
      inline: false,
      summary: sanitizeUntrusted(summarize(domain, stdoutSafe, stderrSafe), { maxBytes: INLINE_BYTES }) + `\n\n[sandbox write failed: ${e?.message || String(e)}]`,
      tail,
      stdoutBytes,
      stderrBytes,
      totalBytes,
    };
  }

  return {
    label,
    exitCode: input.exitCode,
    status,
    durationMs: input.durationMs,
    domain,
    inline: false,
    summary: sanitizeUntrusted(summarize(domain, stdoutSafe, stderrSafe), { maxBytes: INLINE_BYTES }),
    tail,
    stdoutBytes,
    stderrBytes,
    totalBytes,
    sandboxPath,
  };
}

/**
 * Read back the full sandboxed output for forensic / "show me the rest" use.
 * Returns null if the label is unknown or expired.
 */
export function getRunOutput(label: string, opts?: { maxBytes?: number }): { content: string; bytes: number } | null {
  ensureDir();
  const safe = safeLabel(label);
  // Allow either the exact filename or the timestamp-suffixed form.
  let target = path.join(SANDBOX_DIR, `${safe}.txt`);
  if (!fs.existsSync(target)) {
    // Fallback: find any file starting with safe label prefix.
    try {
      const matches = fs.readdirSync(SANDBOX_DIR).filter((f) => f.startsWith(safe + "_") && f.endsWith(".txt"));
      if (matches.length === 0) return null;
      // Most recent first.
      matches.sort((a, b) => b.localeCompare(a));
      target = path.join(SANDBOX_DIR, matches[0]);
    } catch { return null; }
  }
  try {
    const st = fs.statSync(target);
    if (Date.now() - st.mtimeMs > TTL_MS) {
      try { fs.unlinkSync(target); } catch (_silentErr) { logSilentCatch("server/lib/output-sandbox.ts", _silentErr); }
      return null;
    }
    const max = opts?.maxBytes ?? 200_000;
    const fd = fs.openSync(target, "r");
    try {
      const buf = Buffer.alloc(Math.min(st.size, max));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return { content: buf.toString("utf-8"), bytes: st.size };
    } finally {
      fs.closeSync(fd);
    }
  } catch { return null; }
}

export function listRunOutputs(): Array<{ label: string; bytes: number; mtimeMs: number }> {
  ensureDir();
  try {
    return fs.readdirSync(SANDBOX_DIR)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => {
        const st = fs.statSync(path.join(SANDBOX_DIR, f));
        return { label: f.replace(/\.txt$/, ""), bytes: st.size, mtimeMs: st.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch { return []; }
}
