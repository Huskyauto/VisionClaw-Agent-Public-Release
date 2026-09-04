/**
 * server/agentic/harness-addendum-lib.ts — PURE helpers for per-model harness
 * adaptation (Self-Harness, arXiv:2606.09498, CC BY 4.0 — pattern, not code).
 *
 * Self-Harness's one genuine delta over VisionClaw's existing nightly self-
 * improvement stack is PER-MODEL harness adaptation: different base models fail
 * differently, so the operating harness (here: a small system-prompt addendum)
 * should be tailored per model, mined from THAT model's own failure traces, and
 * accepted only after a held-out regression check.
 *
 * This file is intentionally dependency-free (no db, no llm, no providers) so the
 * unit tests can import the deterministic logic WITHOUT opening a pg pool — the
 * known node:test exit-hang when a lib transitively touches `db`. The runtime
 * injector (harness-injection.ts) and the nightly loop (harness-adaptation.ts)
 * both import from here.
 */

// Minimality bound (the paper's "minimal" candidate): a single addendum is a
// short, surgical nudge — never a second system prompt.
export const MAX_ADDENDUM_CHARS = 600;
export const MIN_ADDENDUM_CHARS = 8;
// Total injected budget per model at runtime — caps how much learned guidance
// can stack onto any one call's system prompt.
export const MAX_TOTAL_INJECT_CHARS = 1200;

// Fail-CLOSED forbidden surfaces for a learned addendum. An addendum is machine-
// generated and auto-applied (jury-gated), so it must never be able to (a) touch
// the safety machinery, (b) countermand / jailbreak the base harness, or (c)
// smuggle links/secrets. Validation fails closed on any hit. Mirrors the spirit
// of aevo-meta-editor's EDIT_FORBIDDEN_PATTERNS but is inlined to keep the hot
// runtime path free of aevo's heavier import graph.
export const HARNESS_FORBIDDEN_PATTERNS: RegExp[] = [
  // safety machinery — never editable by a learned addendum
  /safety_profile/i,
  /\bintentGate\b/i,
  /restrictedCategories/i,
  /destructiveToolPolicy/i,
  /refusalCopy/i,
  /TOOL_POLICIES/i,
  /\bAHB\b/i,
  /persona_souls?/i,
  // prompt-override / jailbreak shapes — an addendum nudges, never overrides
  /ignore\s+(all\s+|the\s+)?(previous|prior|above)/i,
  /disregard\s+(all\s+|the\s+)?(previous|prior|above|safety|instructions?)/i,
  /forget\s+(everything|all|previous|prior)/i,
  /\boverride\b/i,
  /\bjailbreak\b/i,
  /you\s+are\s+now\b/i,
  /\bsystem\s+prompt\b/i,
  /\bdeveloper\s+mode\b/i,
  // role / instruction-override language (broad — an addendum never re-roles the model)
  /\bact\s+as\s+(an?|the)\b/i,
  /\bpretend\b/i,
  /from\s+now\s+on\b/i,
  /\bnew\s+(role|persona|identity|instructions?)\b/i,
  // SEMANTIC safety / refusal weakening — keyword-equivalent forms the blacklist
  // above would miss. These are the high-impact deny shapes for an auto-applied,
  // globally-injected addendum: never let it tell a model to stop refusing,
  // invert instruction priority away from safety, or operate unrestricted.
  /\b(do\s*n[o']?t|never|dont|do\s+not)\s+refuse\b/i,
  /\balways\s+comply\b/i,
  /\bcompl(y|ies)\s+with\s+(all|any|every)\b/i,
  /\bignore\s+(the\s+)?(safety|guard|guardrails?|rules?|polic(y|ies)|restrictions?|filters?)\b/i,
  /\bbypass\b/i,
  /\bskip\s+(the\s+)?(guard|guardrails?|check|safety|validation|refusals?)\b/i,
  /\bdisable\s+(the\s+)?(guard|guardrails?|safety|filters?|check)/i,
  /\b(prioriti[sz]e|favor|put)\b[^.]{0,40}\bover\s+(safety|safeguards?|guards?|the\s+rules?)\b/i,
  /\banswer\s+(anything|everything|any\s+(request|question))\b/i,
  /\bunrestricted\b/i,
  /\bunfiltered\b/i,
  /\bwithout\s+(any\s+)?(restrictions?|limitations?|filters?|safeguards?|guardrails?)\b/i,
  /\bno\s+(restrictions?|limitations?|filters?|safeguards?|guardrails?)\b/i,
  /\bregardless\s+of\s+(the\s+)?(risk|safety|polic(y|ies)|harm|consequences?)\b/i,
  /\beven\s+(when|if)\s+(it'?s\s+|it\s+is\s+)?(risky|harmful|dangerous|unsafe|disallowed)\b/i,
  // exfiltration / secrets / links
  /https?:\/\//i,
  /\bAPI[_-]?KEY\b/i,
  /\bSECRET\b/i,
  /process\.env/i,
];

/**
 * NFKC-normalize + strip zero-width / format / control chars BEFORE the
 * forbidden-pattern regex, so a banned token can't be smuggled past via
 * confusables, compatibility forms, or zero-width insertions. (Same technique as
 * aevo-meta-editor's normalizeForPatternCheck; re-implemented here to keep this
 * file dependency-free.)
 */
export function normalizeForPatternCheck(s: string): string {
  const stripped = s
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u00AD\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu, "")
    .replace(/[\p{Cf}\p{Cc}]/gu, "");
  return stripped.normalize("NFKC");
}

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

/** Validate a single proposed addendum. Fail-closed on any forbidden surface. */
export function validateAddendum(text: unknown): ValidationResult {
  const reasons: string[] = [];
  if (typeof text !== "string") return { ok: false, reasons: ["addendum not a string"] };
  const trimmed = text.trim();
  if (trimmed.length < MIN_ADDENDUM_CHARS) reasons.push(`addendum too short (${trimmed.length} < ${MIN_ADDENDUM_CHARS})`);
  if (trimmed.length > MAX_ADDENDUM_CHARS) reasons.push(`addendum too long (${trimmed.length} > ${MAX_ADDENDUM_CHARS}) — must stay minimal`);
  const normalized = normalizeForPatternCheck(trimmed);
  for (const pat of HARNESS_FORBIDDEN_PATTERNS) {
    if (pat.test(trimmed) || pat.test(normalized)) reasons.push(`forbidden pattern in addendum: ${pat}`);
  }
  return { ok: reasons.length === 0, reasons };
}

export interface DeltaLike {
  weakness: string;
  addendum: string;
}

/**
 * Compose the runtime system-prompt suffix for one model from its active deltas.
 * Dedups by normalized addendum, preserves order, and stops once the total
 * injected budget is exhausted (minimality at the call site too). Returns "" for
 * no usable deltas.
 */
export function buildModelInjection(deltas: DeltaLike[]): string {
  if (!Array.isArray(deltas) || deltas.length === 0) return "";
  const seen = new Set<string>();
  const lines: string[] = [];
  let total = 0;
  for (const d of deltas) {
    const addendum = typeof d?.addendum === "string" ? d.addendum.trim() : "";
    if (!addendum) continue;
    if (!validateAddendum(addendum).ok) continue; // defense in depth: never inject an invalid row
    const key = normalizeForPatternCheck(addendum).toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    const bullet = `- ${addendum}`;
    if (total + bullet.length + 1 > MAX_TOTAL_INJECT_CHARS) break;
    seen.add(key);
    lines.push(bullet);
    total += bullet.length + 1;
  }
  if (lines.length === 0) return "";
  return (
    "Model-specific operating notes (learned from your own past failures on this platform; " +
    "follow them in addition to — never instead of — the instructions above):\n" +
    lines.join("\n")
  );
}

// ---- deterministic trace splitting + digesting (nightly mining) -------------

/** mulberry32 — tiny deterministic PRNG so a (model, window) split is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic in-place-safe seeded shuffle (Fisher–Yates). Returns a new array. */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  const rnd = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Split mined failures into a train slice (used to PROPOSE the addendum) and a
 * held-out slice (used to VALIDATE it) — the paper's train/held-out protocol,
 * built from our own trace data. Deterministic given the seed. heldOutRatio is
 * clamped to [0.1, 0.9]; both slices are guaranteed non-empty when items.length
 * >= 2.
 */
export function splitFailures<T>(items: T[], heldOutRatio: number, seed: number): { train: T[]; heldOut: T[] } {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length < 2) return { train: arr.slice(), heldOut: [] };
  const ratio = Math.min(0.9, Math.max(0.1, Number.isFinite(heldOutRatio) ? heldOutRatio : 0.4));
  const shuffled = seededShuffle(arr, seed);
  let nHeldOut = Math.round(arr.length * ratio);
  nHeldOut = Math.min(arr.length - 1, Math.max(1, nHeldOut));
  const heldOut = shuffled.slice(0, nHeldOut);
  const train = shuffled.slice(nHeldOut);
  return { train, heldOut };
}

export interface FailureSample {
  summary?: string | null;
  status?: string | null;
  toolName?: string | null;
}

/** Stable normalized grouping key for a failure (so recurring shapes cluster). */
export function failureKey(f: FailureSample): string {
  const base = `${f.toolName ? f.toolName + ": " : ""}${(f.summary || "").toString()}`;
  return base.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120) || "(no summary)";
}

/**
 * Cluster failures by normalized key and render a compact, top-K digest the
 * proposer LLM can turn into a concrete addendum. Pure + deterministic.
 */
export function digestFailures(failures: FailureSample[], topK = 8): string {
  const counts = new Map<string, number>();
  for (const f of failures || []) {
    const k = failureKey(f);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topK);
  return ranked.map(([k, n]) => `- (${n}×) ${k}`).join("\n");
}
