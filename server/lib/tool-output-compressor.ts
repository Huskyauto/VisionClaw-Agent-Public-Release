/**
 * Tool-Output Compressor — native, type-aware semantic compression of tool
 * results BEFORE they enter the next LLM request.
 *
 * Motivation (Headroom evaluation, 2026-06-13): the chat round loop previously
 * capped large tool outputs with a DUMB head-slice (`raw.slice(0, MAX)`), which
 * (a) cuts JSON mid-structure into invalid text and (b) can throw away the
 * single most important line when it sits near the END of the payload (the
 * classic "the FATAL is on the last line of the log" failure). Headroom
 * (github.com/chopratejas/headroom) validated the input-compression thesis for
 * API consumers — we pay per input token, and our biggest sinks are exactly
 * its targets: large JSON result arrays, log/text dumps, and code blobs.
 *
 * This is the NATIVE-TS borrow of the IDEA (not the Python/HF package): a
 * cheap, rule-based, dependency-free compressor that preserves signal:
 *   - JSON  → collapse oversized arrays (keep head+tail items), trim very long
 *             strings (keep head+tail), re-stringify compact.
 *   - text/ → dedup repeated consecutive lines, collapse blank-line runs.
 *     logs
 *   - any   → final hard cap keeps BOTH head and tail (not head-only) so an
 *             end-of-payload signal survives.
 *
 * Hard guarantees:
 *   - FAIL OPEN: any error falls back to the original dumb head-slice, so the
 *     budget cap (`maxChars`) is NEVER exceeded and the caller never throws.
 *   - PURE: no DB, no network, no fs — safe to unit-test and call on the hot
 *     path. (Heavy ML compression / sandbox-offload stays out of scope; see
 *     `large-output-wrap.ts` for the offload/retrieval pattern.)
 */

// Local heuristic estimator (kept in lockstep with server/compaction.ts's
// estimateTokens = ceil(len/3.5)). Inlined deliberately so this module stays
// dependency-free (no DB/network/fs) and unit-testable without a pg pool.
function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 3.5);
}

export interface CompressResult {
  text: string;
  originalChars: number;
  outputChars: number;
  tokensSaved: number;
  strategy: "passthrough" | "json" | "text" | "headtail-cap" | "slice-fallback";
  lossy: boolean;
}

// --- tunables (conservative; bias toward preserving signal) ---
const MAX_ARRAY_ITEMS = 8; // arrays longer than this get head+tail sampled
const ARRAY_HEAD = 6;
const ARRAY_TAIL = 2;
const MAX_STRING_CHARS = 600; // strings longer than this get head+tail trimmed
const STR_HEAD = 400;
const STR_TAIL = 120;
const MAX_DEPTH = 12;
const HEADTAIL_HEAD_RATIO = 0.7; // when hard-capping, keep 70% head / 30% tail
const TRUNC_SUFFIX = "…(truncated)";

/** Slice to maxChars leaving room for the truncation suffix; never exceeds cap. */
function capWithSuffix(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  if (maxChars <= TRUNC_SUFFIX.length) return s.slice(0, maxChars);
  return s.slice(0, maxChars - TRUNC_SUFFIX.length) + TRUNC_SUFFIX;
}

// process-lifetime aggregate so we can SEE whether the savings hold for OUR
// workloads (mirrors the "make the felt-vs-real gap measurable" principle).
const stats = {
  calls: 0,
  compressedCalls: 0,
  originalChars: 0,
  outputChars: 0,
  tokensSaved: 0,
};

export function getToolCompressionStats() {
  const ratio = stats.originalChars > 0 ? 1 - stats.outputChars / stats.originalChars : 0;
  return { ...stats, savingsRatio: Math.round(ratio * 1000) / 1000 };
}

function compressJsonValue(value: any, depth: number): any {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === "string") {
    if (value.length > MAX_STRING_CHARS) {
      const omitted = value.length - STR_HEAD - STR_TAIL;
      return value.slice(0, STR_HEAD) + `…[${omitted} chars omitted]…` + value.slice(value.length - STR_TAIL);
    }
    return value;
  }
  if (Array.isArray(value)) {
    const compressedItems = value.map((v) => compressJsonValue(v, depth + 1));
    if (compressedItems.length > MAX_ARRAY_ITEMS) {
      const head = compressedItems.slice(0, ARRAY_HEAD);
      const tail = compressedItems.slice(compressedItems.length - ARRAY_TAIL);
      const omitted = compressedItems.length - ARRAY_HEAD - ARRAY_TAIL;
      return [...head, { __omitted_items: omitted, __array_len: compressedItems.length }, ...tail];
    }
    return compressedItems;
  }
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = compressJsonValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Dedup runs of identical consecutive lines and collapse blank-line runs. */
function compressText(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let blankRun = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      blankRun++;
      if (blankRun <= 1) out.push(line);
      i++;
      continue;
    }
    blankRun = 0;
    // count identical consecutive non-blank lines
    let run = 1;
    while (i + run < lines.length && lines[i + run] === line) run++;
    if (run > 2) {
      out.push(line);
      out.push(`…(previous line repeated ${run - 1}× more)`);
    } else {
      for (let r = 0; r < run; r++) out.push(line);
    }
    i += run;
  }
  return out.join("\n");
}

/** Keep head + tail (never head-only) so end-of-payload signal survives. */
function headTailCap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const mkMarker = (n: number) => `\n…[${n} chars omitted — middle elided]…\n`;
  // Reserve marker space using text.length as a safe upper bound on the digit
  // count — the real omitted count is always smaller, so the real marker can
  // only be shorter, guaranteeing the final string never exceeds maxChars.
  const reserved = mkMarker(text.length).length;
  const budget = maxChars - reserved;
  // Degenerate case: cap too small to fit even the marker — return a bounded
  // head slice so the contract (never exceed maxChars) still holds.
  if (budget <= 0) return text.slice(0, maxChars);
  const headLen = Math.floor(budget * HEADTAIL_HEAD_RATIO);
  const tailLen = budget - headLen;
  const omitted = text.length - headLen - tailLen;
  return text.slice(0, headLen) + mkMarker(omitted) + text.slice(text.length - tailLen);
}

export function compressToolOutput(opts: {
  toolName: string;
  raw: string;
  maxChars: number;
  enabled?: boolean;
}): CompressResult {
  const { raw } = opts;
  const maxChars = Math.max(0, opts.maxChars); // never rely on caller for non-negativity
  const enabled = opts.enabled !== false;
  const originalChars = raw.length;
  stats.calls++;

  // Nothing to do if it already fits and compression is off.
  if (!enabled) {
    const text = capWithSuffix(raw, maxChars);
    return finalize(text, originalChars, "passthrough", raw.length > maxChars);
  }
  if (raw.length <= maxChars) {
    return finalize(raw, originalChars, "passthrough", false);
  }

  try {
    let strategy: CompressResult["strategy"] = "text";
    let compressed: string;

    const trimmed = raw.trimStart();
    const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
    if (looksJson) {
      try {
        const parsed = JSON.parse(raw);
        compressed = JSON.stringify(compressJsonValue(parsed, 0));
        strategy = "json";
      } catch {
        compressed = compressText(raw);
        strategy = "text";
      }
    } else {
      compressed = compressText(raw);
      strategy = "text";
    }

    // Final budget cap — head+tail so a trailing signal line survives. Post-cap
    // output may no longer be valid JSON, so report it honestly as headtail-cap.
    if (compressed.length > maxChars) {
      compressed = headTailCap(compressed, maxChars);
      strategy = "headtail-cap";
    }

    return finalize(compressed, originalChars, strategy, true);
  } catch {
    // FAIL OPEN: never throw on the hot path; honor the budget cap.
    const text = capWithSuffix(raw, maxChars);
    return finalize(text, originalChars, "slice-fallback", true);
  }
}

function finalize(
  text: string,
  originalChars: number,
  strategy: CompressResult["strategy"],
  lossy: boolean,
): CompressResult {
  const outputChars = text.length;
  const tokensSaved = Math.max(0, estimateTokensFromChars(originalChars) - estimateTokensFromChars(outputChars));
  if (strategy !== "passthrough") {
    stats.compressedCalls++;
    stats.originalChars += originalChars;
    stats.outputChars += outputChars;
    stats.tokensSaved += tokensSaved;
  }
  return { text, originalChars, outputChars, tokensSaved, strategy, lossy };
}

export const __internals = { compressJsonValue, compressText, headTailCap };
