// R116 — agentmemory N7. Heuristic quality_score (0..1) computed at write time.
//
// Distinct from `confidence` (= "how true is this fact"). quality_score is
// "how well-formed is this fact entry": structure, length, source citation,
// internal coherence. Low quality_score → routed to the partial-index review
// queue idx_memory_entries_quality_below.
//
// Heuristic-only (no LLM call) — runs INSIDE the 30s debounced memory queue
// flush, so it must be fast and dependency-free. If we ever want a 2nd-pass
// LLM grader, layer it OUTSIDE this function as an optional async refiner.

export interface QualityScoreInput {
  fact: string;
  source: string;          // 'conversation' | 'auto_capture' | 'tool' | 'manual' | ...
  confidence: number;      // 0..1
  confidenceSource?: string | null;
  category?: string | null;
}

export interface QualityScoreResult {
  score: number;           // 0..1
  reasons: string[];       // human-readable contributors
}

// Tuned so the default well-formed conversation-extracted fact lands ~0.85,
// auto-capture facts ~0.75, and degenerate/empty/duplicate-content rows <0.5.
export function computeQualityScore(input: QualityScoreInput): QualityScoreResult {
  const reasons: string[] = [];
  let score = 0.5; // baseline

  const fact = String(input.fact || "").trim();
  const len = fact.length;

  // ── length contribution ──────────────────────────────────────────────────
  if (len === 0) {
    return { score: 0, reasons: ["empty_fact"] };
  }
  if (len < 12) {
    score -= 0.25;
    reasons.push(`very_short(${len}c)`);
  } else if (len < 40) {
    score += 0.05;
    reasons.push(`short(${len}c)`);
  } else if (len <= 400) {
    score += 0.15;
    reasons.push(`well_sized(${len}c)`);
  } else if (len <= 1200) {
    score += 0.05;
    reasons.push(`long(${len}c)`);
  } else {
    score -= 0.10;
    reasons.push(`bloated(${len}c)`);
  }

  // ── structural signals ───────────────────────────────────────────────────
  // Multi-token: degenerate single-word entries are low quality
  const tokenCount = fact.split(/\s+/).filter(Boolean).length;
  if (tokenCount >= 4) {
    score += 0.05;
    reasons.push(`tokens>=4`);
  } else if (tokenCount <= 1) {
    score -= 0.15;
    reasons.push(`single_token`);
  }

  // Has a sentence-ish terminator (period / ? / ! ) or clear key-value form
  if (/[.?!]\s*$|^[A-Za-z_][A-Za-z0-9_ ]*[:=]/m.test(fact)) {
    score += 0.05;
    reasons.push("structured");
  }

  // Repeated-token spam (e.g. "test test test test test")
  const uniqueTokens = new Set(fact.toLowerCase().split(/\s+/));
  if (tokenCount >= 5 && uniqueTokens.size / tokenCount < 0.35) {
    score -= 0.25;
    reasons.push("repetitive");
  }

  // Mostly-non-printable / control-character contamination
  const printable = fact.replace(/[\x20-\x7E\u00A0-\uFFFF]/g, "").length;
  if (printable > 0 && printable / Math.max(1, len) > 0.10) {
    score -= 0.30;
    reasons.push("non_printable");
  }

  // ── source contribution ─────────────────────────────────────────────────
  // Explicit user/manual signal is highest quality; auto-capture is mid;
  // tool / conversation extraction is mid; unknown is neutral.
  const src = String(input.source || "").toLowerCase();
  if (src === "manual" || src === "user" || src === "explicit") {
    score += 0.15;
    reasons.push(`source:${src}`);
  } else if (src === "auto_capture" || src === "heuristic" || src === "tool") {
    score += 0.05;
    reasons.push(`source:${src}`);
  } else if (src === "conversation" || src === "extractor") {
    score += 0.08;
    reasons.push(`source:${src}`);
  }

  // Bonus when confidenceSource is set — provenance is half the quality story
  if (input.confidenceSource && String(input.confidenceSource).length > 2) {
    score += 0.05;
    reasons.push("has_confidence_source");
  }

  // ── confidence-quality coupling ─────────────────────────────────────────
  // Very-low-confidence facts get capped at 0.6 quality_score regardless of
  // structure: a perfectly-formatted sentence we're 0.2 sure about is still
  // low-quality MEMORY content.
  const conf = Number.isFinite(input.confidence) ? input.confidence : 1.0;
  if (conf < 0.5 && score > 0.6) {
    score = 0.6;
    reasons.push(`capped_low_conf(${conf.toFixed(2)})`);
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    reasons,
  };
}

// Default threshold for routing into the review queue (idx partial index hits
// rows below 0.5). Env override for tenants that want a stricter gate.
export const QUALITY_REVIEW_THRESHOLD = (() => {
  const v = Number(process.env.MEMORY_QUALITY_REVIEW_THRESHOLD);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.5;
})();
