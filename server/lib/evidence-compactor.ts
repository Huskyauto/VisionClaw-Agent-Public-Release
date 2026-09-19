/**
 * Evidence Compactor (R115.3) — Top-K + diversity sparsification for AEvo evidence.
 *
 * Inspired by the Top-K gradient-compression + error-feedback pattern from
 * DiLoCo-style distributed training (hyperspaceai/agi). Translated to our shape:
 * raw failure-note streams from agent_trace_spans + delivery_verifications are
 * scored for informativeness, deduplicated for diversity, and the long tail
 * collapses into a structured digest of error-class distributions.
 *
 * This module is INTERNAL — it is invoked by server/lib/aevo-meta-editor.ts only.
 * It is NOT exposed as an LLM-callable tool (no new attack surface).
 *
 * Pure functions; no DB access; no IO. Tenant isolation is enforced one layer
 * up in gatherEvidence() which scopes every query by tenant_id.
 */

export interface CompactedFailureNotes {
  topK: string[];
  totalCount: number;
  droppedCount: number;
  topKByErrorClass: Record<string, number>;
  droppedByErrorClass: Record<string, number>;
  ratio: number;
}

const ERROR_CLASS_PATTERNS: Array<{ cls: string; rx: RegExp }> = [
  { cls: "timeout", rx: /\b(timeout|timed[ _-]?out|deadline|ETIMEDOUT)\b/i },
  { cls: "network", rx: /\b(ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network error)\b/i },
  { cls: "auth", rx: /\b(unauthorized|forbidden|401|403|invalid token|expired token)\b/i },
  { cls: "rate_limit", rx: /\b(rate[ _-]?limit|429|too many requests|quota exceeded)\b/i },
  { cls: "validation", rx: /\b(zod|validation failed|invalid input|schema mismatch|missing field|required)\b/i },
  { cls: "not_found", rx: /\b(404|not found|no such|does not exist)\b/i },
  { cls: "size", rx: /\b(too large|exceeds limit|size limit|payload too big|content[ _-]?length)\b/i },
  { cls: "format", rx: /\b(malformed|invalid format|parse error|syntax error|unexpected token)\b/i },
  { cls: "permission", rx: /\b(permission denied|access denied|insufficient (scope|permission))\b/i },
];

export function classifyErrorNote(note: string): string {
  if (!note || typeof note !== "string") return "unknown";
  for (const { cls, rx } of ERROR_CLASS_PATTERNS) {
    if (rx.test(note)) return cls;
  }
  return "unknown";
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function scoreNote(note: string): number {
  let score = 1;
  if (/\bat .+:\d+(?::\d+)?/.test(note)) score += 2; // stack frame
  if (/[0-9a-f]{8,}/i.test(note)) score += 1; // id/hash
  if (/\b(error|failed|exception|throw|reject)\b/i.test(note)) score += 1;
  if (/\b[A-Z][A-Z0-9_]{3,}\b/.test(note)) score += 1; // CODE_CONSTANT
  if (note.length > 80) score += 1;
  if (note.length < 20) score -= 1;
  return score;
}

export interface CompactOpts {
  k?: number;
  duplicateThreshold?: number;
}

/**
 * Top-K + diversity sparsification of failure notes.
 *
 * Algorithm:
 *  1. Score each note by informativeness (stack frames, ids, length, error keywords).
 *  2. Sort descending by score (stable, ties broken by original index).
 *  3. Greedy select up to K notes that are NOT near-duplicates (Jaccard ≥ threshold)
 *     of any already-selected note.
 *  4. Bucketize selected + dropped notes into error classes; emit structured digest.
 *
 * Returns the verbatim top-K, the dropped count, and per-class breakdowns for both.
 */
export function compactFailureNotes(
  rawNotes: string[],
  opts: CompactOpts = {}
): CompactedFailureNotes {
  const k = opts.k ?? 10;
  const duplicateThreshold = opts.duplicateThreshold ?? 0.7;

  if (!Array.isArray(rawNotes) || rawNotes.length === 0) {
    return {
      topK: [],
      totalCount: 0,
      droppedCount: 0,
      topKByErrorClass: {},
      droppedByErrorClass: {},
      ratio: 1,
    };
  }

  const filtered = rawNotes.filter((n) => typeof n === "string" && n.length > 0);
  const total = filtered.length;

  if (k <= 0) {
    const droppedByErrorClass: Record<string, number> = {};
    for (const n of filtered) {
      const c = classifyErrorNote(n);
      droppedByErrorClass[c] = (droppedByErrorClass[c] || 0) + 1;
    }
    return {
      topK: [],
      totalCount: total,
      droppedCount: total,
      topKByErrorClass: {},
      droppedByErrorClass,
      ratio: total || 1,
    };
  }

  const candidates = filtered
    .map((note, idx) => ({
      note,
      tokens: tokenize(note),
      score: scoreNote(note),
      cls: classifyErrorNote(note),
      idx,
    }))
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

  const selected: typeof candidates = [];
  const dropped: typeof candidates = [];
  for (const c of candidates) {
    if (selected.length >= k) {
      dropped.push(c);
      continue;
    }
    const dup = selected.some((s) => jaccard(s.tokens, c.tokens) >= duplicateThreshold);
    if (dup) {
      dropped.push(c);
    } else {
      selected.push(c);
    }
  }

  const topKByErrorClass: Record<string, number> = {};
  for (const s of selected) {
    topKByErrorClass[s.cls] = (topKByErrorClass[s.cls] || 0) + 1;
  }
  const droppedByErrorClass: Record<string, number> = {};
  for (const d of dropped) {
    droppedByErrorClass[d.cls] = (droppedByErrorClass[d.cls] || 0) + 1;
  }

  return {
    topK: selected.map((s) => s.note),
    totalCount: total,
    droppedCount: dropped.length,
    topKByErrorClass,
    droppedByErrorClass,
    ratio: total / Math.max(1, selected.length),
  };
}

/**
 * One-line human-readable digest of the compaction long tail.
 * Returns "" if nothing was dropped.
 */
export function formatCompactionDigest(c: CompactedFailureNotes): string {
  if (c.droppedCount === 0) return "";
  const breakdown = Object.entries(c.droppedByErrorClass)
    .sort((a, b) => b[1] - a[1])
    .map(([cls, n]) => `${cls}=${n}`)
    .join(", ");
  return `Long-tail digest (${c.droppedCount} additional notes compressed, ratio ${c.ratio.toFixed(2)}x): ${breakdown}`;
}
