/**
 * Large-Output Wrap (R115.5) — generalized head+tail+sandbox-file pattern.
 *
 * Inspired by Osmani's "Agent Harness Engineering" (O'Reilly Radar,
 * 2026-05-15): "Tool-call offloading. Large tool outputs (think 2,000-line
 * log files) clutter context without adding much signal. The harness keeps
 * the head and tail tokens above a threshold and offloads the full output
 * to the filesystem, where the agent can read it on demand."
 *
 * We already have this pattern hard-wired into `run_command` via
 * `server/lib/output-sandbox.ts`. This module lifts the same idea into a
 * generic wrapper any tool can call on its outbound payload.
 *
 * Usage:
 *   import { wrapLargeResult } from "./lib/large-output-wrap";
 *   const payload = JSON.stringify(bigResult);
 *   const wrapped = wrapLargeResult({ label: "web_search", payload });
 *   return wrapped;   // either passthrough or {summary, sandboxLabel, ...}
 *
 * Retrieval:
 *   `run_command` already exposes action="get_output" with a label, which
 *   reads from the same SANDBOX_DIR. We re-use that path so there is no new
 *   retrieval tool to register.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logSilentCatch } from "./silent-catch";
import { atomicWriteFileSync } from "./atomic-write";

const SANDBOX_DIR = path.resolve(process.cwd(), "data", "run-sandbox");
const DEFAULT_THRESHOLD_BYTES = 16 * 1024; // 16KB — generous; tools producing
                                            // less than this should bypass.
const HEAD_CHARS = 1500;
const TAIL_CHARS = 1500;
const TTL_MS = 24 * 60 * 60 * 1000;
// R115.6 — first char restricted to [A-Za-z0-9_] so labels can never start
// with `.` (hidden file) or `-` (mistaken-as-CLI-flag) in the sandbox.
const LABEL_RE = /^[A-Za-z0-9_][A-Za-z0-9_\-]{0,63}$/;

function ensureSandboxDir(): void {
  try {
    if (!fs.existsSync(SANDBOX_DIR)) fs.mkdirSync(SANDBOX_DIR, { recursive: true, mode: 0o700 });
  } catch (_e) { logSilentCatch("server/lib/large-output-wrap.ts:ensureSandboxDir", _e); }
}

function purgeExpired(): void {
  try {
    if (!fs.existsSync(SANDBOX_DIR)) return;
    const now = Date.now();
    for (const f of fs.readdirSync(SANDBOX_DIR)) {
      try {
        const fp = path.join(SANDBOX_DIR, f);
        const st = fs.statSync(fp);
        if (now - st.mtimeMs > TTL_MS) fs.unlinkSync(fp);
      } catch (_e) { logSilentCatch("server/lib/large-output-wrap.ts:purgeExpired:item", _e); }
    }
  } catch (_e) { logSilentCatch("server/lib/large-output-wrap.ts:purgeExpired", _e); }
}

export interface WrapLargeResultInput {
  /** Short identifier (a-z, 0-9, _, -, 1-64 chars). Used as the sandbox filename stem. */
  label: string;
  /** Stringified payload. Pass `JSON.stringify(obj)` for objects. */
  payload: string;
  /** Byte threshold. Default 16KB. Below threshold returns passthrough. */
  threshold?: number;
  /** Optional file extension hint (defaults to .txt). */
  ext?: string;
}

export interface WrappedSmall {
  truncated: false;
  inline: string;
  bytes: number;
}

export interface WrappedLarge {
  truncated: true;
  bytes: number;
  sandboxLabel: string;
  sandboxPath: string;
  head: string;
  tail: string;
  hint: string; // human-readable retrieval hint
}

export type WrappedResult = WrappedSmall | WrappedLarge;

export function wrapLargeResult(input: WrapLargeResultInput): WrappedResult {
  const label = String(input.label || "").trim();
  if (!LABEL_RE.test(label)) {
    throw new Error(`wrapLargeResult: label must match ${LABEL_RE} (got ${JSON.stringify(input.label)})`);
  }
  const payload = String(input.payload ?? "");
  const bytes = Buffer.byteLength(payload, "utf8");
  const threshold = Math.max(1024, Number(input.threshold) || DEFAULT_THRESHOLD_BYTES);
  if (bytes <= threshold) {
    return { truncated: false, inline: payload, bytes };
  }
  ensureSandboxDir();
  purgeExpired();
  const ext = (input.ext || "txt").replace(/[^a-z0-9]/gi, "").slice(0, 10) || "txt";
  // Timestamped filename so two writes with the same label coexist briefly.
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const fname = `${label}-${stamp}.${ext}`;
  const sandboxPath = path.join(SANDBOX_DIR, fname);
  // Path-jail check: confirm the resolved path stays under SANDBOX_DIR.
  // (Defense in depth — label regex already blocks "../".)
  const resolved = path.resolve(sandboxPath);
  if (!resolved.startsWith(SANDBOX_DIR + path.sep)) {
    throw new Error("wrapLargeResult: path escape detected");
  }
  atomicWriteFileSync(resolved, payload, { mode: 0o600 });
  const head = payload.slice(0, HEAD_CHARS);
  const tail = payload.length > HEAD_CHARS + TAIL_CHARS ? payload.slice(-TAIL_CHARS) : "";
  return {
    truncated: true,
    bytes,
    sandboxLabel: fname.replace(/\.[a-z0-9]+$/i, ""),
    sandboxPath: resolved,
    head,
    tail,
    hint: `Output offloaded to sandbox file (${bytes} bytes). Retrieve full content via run_command action='get_output' label='${fname.replace(/\.[a-z0-9]+$/i, "")}'.`,
  };
}

// Test/diagnostic helper — exported for invariant tests.
export const __internals = {
  SANDBOX_DIR,
  DEFAULT_THRESHOLD_BYTES,
  HEAD_CHARS,
  TAIL_CHARS,
  LABEL_RE,
};
