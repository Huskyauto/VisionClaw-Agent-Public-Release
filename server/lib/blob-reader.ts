/**
 * Blob Reader (R117) — companion to `large-output-wrap.ts`.
 *
 * `wrapLargeResult` offloads big tool outputs to sandbox files and returns a
 * label + head/tail preview. Until R117, the only way to read the full blob
 * back was `run_command action="get_output"`, which is heavy (full file dump
 * into context, no partial reads, no grep).
 *
 * This module adds slice + grep + byte-cap fetching so an agent can pull
 * exactly the lines it needs without re-loading the entire blob. Modeled
 * after `mksglu/context-mode` (recommendation #4 from the user's token-saver
 * eval), adapted to our existing sandbox layout.
 *
 * Storage path: `data/run-sandbox/<label>.<ext>` (written by `wrapLargeResult`).
 * Same path-jail rules apply — label must match LABEL_RE, resolved path must
 * stay under SANDBOX_DIR.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logSilentCatch } from "./silent-catch";

const SANDBOX_DIR = path.resolve(process.cwd(), "data", "run-sandbox");
const LABEL_RE = /^[A-Za-z0-9_][A-Za-z0-9_\-]{0,63}$/;
const DEFAULT_MAX_BYTES = 16 * 1024;
const HARD_MAX_BYTES = 64 * 1024;
const HARD_MAX_GREP_MATCHES = 200;
const MAX_BLOB_SIZE_BYTES = 16 * 1024 * 1024;   // pre-read file size cap (DoS guard)
const MAX_GREP_PATTERN_LEN = 512;                // ReDoS surface reduction
const MAX_GREP_LINE_LEN = 8 * 1024;              // clip each line before regex.test() — bounds backtracking input
const GREP_TOTAL_BUDGET_MS = 1000;               // total wall-time budget for grep scan
const GREP_SINGLE_LINE_BUDGET_MS = 50;           // per-test wall-time guard for the slowest single line

export interface ReadBlobInput {
  label: string;
  sliceLines?: [number, number];
  grep?: string;
  grepFlags?: string;
  maxBytes?: number;
  contextLines?: number;
}

export interface ReadBlobResult {
  ok: boolean;
  error?: string;
  label?: string;
  filePath?: string;
  totalBytes?: number;
  totalLines?: number;
  returnedLines?: number;
  returnedBytes?: number;
  truncated?: boolean;
  matchedLines?: number;
  content?: string;
  mode?: "full" | "slice" | "grep" | "head";
}

function resolveBlobPath(label: string): string | null {
  if (!LABEL_RE.test(label)) return null;
  if (!fs.existsSync(SANDBOX_DIR)) return null;
  // Canonicalize the sandbox root once via realpath to defeat symlink shenanigans.
  let sandboxReal: string;
  try { sandboxReal = fs.realpathSync(SANDBOX_DIR); } catch { return null; }
  let chosen: { path: string; mtimeMs: number } | null = null;
  for (const f of fs.readdirSync(SANDBOX_DIR)) {
    const base = f.replace(/\.[a-z0-9]+$/i, "");
    if (base !== label) continue;
    const fp = path.join(SANDBOX_DIR, f);
    try {
      // Reject symlinks at the entry itself — never follow.
      const lst = fs.lstatSync(fp);
      if (lst.isSymbolicLink()) continue;
      if (!lst.isFile()) continue;
      // Canonicalize the candidate too; require it to stay inside the canonical sandbox.
      const real = fs.realpathSync(fp);
      if (!real.startsWith(sandboxReal + path.sep) && real !== sandboxReal) continue;
      if (!chosen || lst.mtimeMs > chosen.mtimeMs) chosen = { path: real, mtimeMs: lst.mtimeMs };
    } catch (_e) { logSilentCatch("blob-reader:stat", _e); }
  }
  return chosen?.path || null;
}

/**
 * Reject high-risk regex constructs that are the classic ReDoS surface.
 * Native JS RegExp is a backtracking engine with no preemption, so once a
 * catastrophic pattern starts evaluating we cannot stop it. Defense: refuse
 * to compile patterns that exhibit the dangerous shapes in the first place.
 *
 * Architect-finding-triage round 3 — recommendation #2.
 */
function isDangerousRegexShape(pattern: string): string | null {
  // Cheap lexical checks first.
  if (/\(\?[=!<]/.test(pattern)) return "lookaround not allowed";
  if (/\\[1-9]/.test(pattern)) return "backreference not allowed";
  // Direct (X+)+ shallow shape — fast pre-check before the full structural scan.
  if (/\([^)]*[+*?}][^)]*\)\s*[+*?{]/.test(pattern)) return "nested quantifier on group";

  // Structural scan (round-5 architect bypass: `((a|aa))+$` slips past shallow
  // [^)] regex because the alternation is inside a wrapping group). Walk the
  // pattern token-aware (handle \\ escapes and [...] char classes), track group
  // nesting, and reject any quantified group whose subtree contains alternation.
  // Bubble inner alternation up to the parent group on close so outer quantifiers
  // can see it. O(pattern length); pattern length already capped at 512.
  type Frame = { hasAlternation: boolean };
  const stack: Frame[] = [{ hasAlternation: false }];
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "[") {
      i++;
      while (i < pattern.length && pattern[i] !== "]") {
        if (pattern[i] === "\\") i++;
        i++;
      }
      i++; continue;
    }
    if (c === "(") {
      stack.push({ hasAlternation: false });
      i++; continue;
    }
    if (c === ")") {
      // Malformed: unmatched `)` — only the sentinel root frame remains.
      // Treat as unsafe rather than throwing on stack underflow.
      if (stack.length <= 1) return "malformed pattern (unbalanced ')')";
      const frame = stack.pop()!;
      i++;
      const q = pattern[i];
      const isQuant = q === "+" || q === "*" || q === "?" || q === "{";
      if (isQuant && frame.hasAlternation) {
        return "quantified group contains alternation (ReDoS)";
      }
      stack[stack.length - 1].hasAlternation ||= frame.hasAlternation;
      continue;
    }
    if (c === "|") {
      // Stack always has the root sentinel frame, so this is safe — but be defensive.
      if (stack.length === 0) return "malformed pattern (alternation without frame)";
      stack[stack.length - 1].hasAlternation = true;
      i++; continue;
    }
    i++;
  }
  return null;
}

function safeRegex(pattern: string, flags?: string): RegExp | null {
  if (!pattern || pattern.length > MAX_GREP_PATTERN_LEN) return null;
  if (isDangerousRegexShape(pattern)) return null;
  try {
    const f = (flags || "").replace(/[^gimsuy]/g, "").slice(0, 6);
    return new RegExp(pattern, f.includes("g") ? f : f + "g");
  } catch { return null; }
}

export function readBlob(input: ReadBlobInput): ReadBlobResult {
  const label = String(input.label || "").trim();
  if (!LABEL_RE.test(label)) {
    return { ok: false, error: `invalid label (must match ${LABEL_RE})` };
  }
  const filePath = resolveBlobPath(label);
  if (!filePath) return { ok: false, error: `no blob found for label '${label}'` };
  // Pre-read size guard — refuse pathologically large blobs before swallowing them into RSS.
  let fileSize = 0;
  try { fileSize = fs.statSync(filePath).size; } catch { return { ok: false, error: "blob stat failed" }; }
  if (fileSize > MAX_BLOB_SIZE_BYTES) {
    return { ok: false, error: `blob too large (${fileSize} > ${MAX_BLOB_SIZE_BYTES}); use sliceLines or grep with a tighter scope` };
  }
  let raw: string;
  try { raw = fs.readFileSync(filePath, "utf8"); } catch (e: any) {
    return { ok: false, error: `read failed: ${String(e?.message || e).slice(0, 120)}` };
  }
  const totalBytes = Buffer.byteLength(raw, "utf8");
  const lines = raw.split("\n");
  const totalLines = lines.length;
  const maxBytes = Math.min(Math.max(Number(input.maxBytes) || DEFAULT_MAX_BYTES, 256), HARD_MAX_BYTES);

  if (input.grep) {
    const ctx = Math.max(0, Math.min(Number(input.contextLines) || 2, 20));
    const re = safeRegex(input.grep, input.grepFlags);
    if (!re) return { ok: false, error: "invalid grep pattern" };
    const matchLineIdx: number[] = [];
    const grepStart = Date.now();
    let grepBudgetExceeded = false;
    for (let i = 0; i < lines.length; i++) {
      // Total wall-time budget — defeats catastrophic backtracking even if a single line is fast.
      if ((i & 0xff) === 0 && Date.now() - grepStart > GREP_TOTAL_BUDGET_MS) {
        grepBudgetExceeded = true;
        break;
      }
      // Clip the line before handing it to the regex engine. Bounded input length = bounded
      // worst-case backtracking time. 8KB is well over any reasonable log line and still keeps
      // even pathological patterns from hanging for seconds.
      const candidate = lines[i].length > MAX_GREP_LINE_LEN ? lines[i].slice(0, MAX_GREP_LINE_LEN) : lines[i];
      re.lastIndex = 0;
      const testStart = Date.now();
      let matched = false;
      try { matched = re.test(candidate); } catch { matched = false; }
      // Per-test wall-time guard — if a single regex.test() blew through the per-line budget,
      // assume a degenerate pattern + line combination and bail out of the entire scan.
      if (Date.now() - testStart > GREP_SINGLE_LINE_BUDGET_MS) {
        grepBudgetExceeded = true;
        break;
      }
      if (matched) {
        matchLineIdx.push(i);
        if (matchLineIdx.length >= HARD_MAX_GREP_MATCHES) break;
      }
    }
    const wantSet = new Set<number>();
    for (const i of matchLineIdx) {
      for (let j = Math.max(0, i - ctx); j <= Math.min(lines.length - 1, i + ctx); j++) wantSet.add(j);
    }
    const wantSorted = Array.from(wantSet).sort((a, b) => a - b);
    const chunks: string[] = [];
    let lastEmitted = -2;
    let bytesEmitted = 0;
    let truncated = false;
    for (const i of wantSorted) {
      if (i > lastEmitted + 1 && lastEmitted >= 0) chunks.push("---");
      const line = `${i + 1}: ${lines[i]}`;
      const lineBytes = Buffer.byteLength(line, "utf8") + 1;
      if (bytesEmitted + lineBytes > maxBytes) { truncated = true; break; }
      chunks.push(line);
      bytesEmitted += lineBytes;
      lastEmitted = i;
    }
    const content = chunks.join("\n");
    return {
      ok: true, label, filePath, totalBytes, totalLines,
      mode: "grep", matchedLines: matchLineIdx.length, content,
      returnedLines: chunks.filter((c) => c !== "---").length,
      returnedBytes: Buffer.byteLength(content, "utf8"),
      truncated: truncated || grepBudgetExceeded || matchLineIdx.length >= HARD_MAX_GREP_MATCHES,
    };
  }

  if (input.sliceLines && Array.isArray(input.sliceLines) && input.sliceLines.length === 2) {
    let [start, end] = input.sliceLines;
    start = Math.max(1, Math.floor(Number(start) || 1));
    end = Math.max(start, Math.floor(Number(end) || start));
    const startIdx = start - 1;
    const endIdx = Math.min(end, totalLines);
    const chunks: string[] = [];
    let bytesEmitted = 0;
    let truncated = false;
    for (let i = startIdx; i < endIdx; i++) {
      const line = `${i + 1}: ${lines[i]}`;
      const lineBytes = Buffer.byteLength(line, "utf8") + 1;
      if (bytesEmitted + lineBytes > maxBytes) { truncated = true; break; }
      chunks.push(line);
      bytesEmitted += lineBytes;
    }
    const content = chunks.join("\n");
    return {
      ok: true, label, filePath, totalBytes, totalLines,
      mode: "slice", content,
      returnedLines: chunks.length,
      returnedBytes: Buffer.byteLength(content, "utf8"),
      truncated,
    };
  }

  // Default: return head up to maxBytes
  if (totalBytes <= maxBytes) {
    return {
      ok: true, label, filePath, totalBytes, totalLines,
      mode: "full", content: raw,
      returnedLines: totalLines, returnedBytes: totalBytes, truncated: false,
    };
  }
  const head = raw.slice(0, maxBytes);
  return {
    ok: true, label, filePath, totalBytes, totalLines,
    mode: "head", content: head,
    returnedLines: head.split("\n").length,
    returnedBytes: Buffer.byteLength(head, "utf8"),
    truncated: true,
  };
}

export const __internals = { SANDBOX_DIR, LABEL_RE, DEFAULT_MAX_BYTES, HARD_MAX_BYTES, HARD_MAX_GREP_MATCHES };
