/**
 * Skill Fit Tiering — R125+155 (2026-08-18).
 *
 * Problem (arXiv:2608.14036 "Demystifying Agent Skills"): as a skill pool
 * grows, retrieval/attention precision collapses (measured 29.6% → 3.3% going
 * from 5 to 100 skills). Our chat lane injects EVERY enabled skill wholesale,
 * so the model itself must tell "the procedure for this request" apart from
 * "a procedure for some other request" — exactly the dilution failure mode.
 *
 * Fix: per-turn, score each enabled skill's semantic fit against the user's
 * message and tag it High / Medium / Low (reusing the platform's canonical
 * EvidenceConfidence scale). The prompt then instructs the model that
 * Low-fit skills are candidate procedures to adapt or ignore — never scripts
 * to follow mechanically.
 *
 * Invariants (match skill-activation-test.ts + platform loop policy):
 * - ADVISORY + FAIL-OPEN: any error, missing embedder, or timeout returns
 *   null and the caller injects skills untiered, exactly as before. Quality
 *   signals never block or drop a skill.
 * - Hard timeout on the awaited path (awaited-autohook-latency-bound): this
 *   runs pre-first-token in the chat hot path, so the whole scoring pass is
 *   raced against a deadline; late results are swallowed.
 * - Skill embeddings are cached per (name + text hash) in-process — steady
 *   state costs ONE user-message embedding per turn.
 */

import crypto from "node:crypto";
import type { EvidenceConfidence } from "./evidence-confidence";

export interface SkillFitInput {
  name: string;
  /** Short description preferred; falls back to a prompt-content prefix. */
  description?: string | null;
  promptContent?: string | null;
}

export interface SkillFitScore {
  tier: EvidenceConfidence;
  similarity: number;
}

export interface SkillFitOptions {
  userMessage: string;
  skills: SkillFitInput[];
  /** Injectable for tests; production passes generateEmbedding. */
  embed: (text: string) => Promise<number[] | null>;
  /** Whole-pass deadline in ms; fail-open to null when exceeded. */
  timeoutMs?: number;
  /** Similarity ≥ high ⇒ High; ≥ medium ⇒ Medium; else Low. */
  highThreshold?: number;
  mediumThreshold?: number;
}

/** Aligned with skill-rag's neighborhood (top gate 0.5, knowledge 0.25/0.3). */
export const DEFAULT_HIGH_THRESHOLD = 0.45;
export const DEFAULT_MEDIUM_THRESHOLD = 0.25;
const DEFAULT_TIMEOUT_MS = 1500;
const CACHE_MAX = 500;

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Text we embed for a skill: name + description (stable, short). */
export function skillFitText(s: SkillFitInput): string {
  const desc = (s.description || "").trim() || (s.promptContent || "").trim().slice(0, 400);
  return `${(s.name || "").trim()}: ${desc}`.trim();
}

// In-process cache of skill-text embeddings (bounded, insertion-evicted).
const skillVecCache = new Map<string, number[]>();

function cacheKey(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 24);
}

/** Test hook — clears the module-level embedding cache. */
export function _clearSkillFitCache(): void {
  skillVecCache.clear();
}

export function tierFromSimilarity(
  sim: number,
  high: number = DEFAULT_HIGH_THRESHOLD,
  medium: number = DEFAULT_MEDIUM_THRESHOLD,
): EvidenceConfidence {
  if (!Number.isFinite(sim)) return "Low";
  return sim >= high ? "High" : sim >= medium ? "Medium" : "Low";
}

async function scoreSkillFitInner(opts: SkillFitOptions): Promise<Map<string, SkillFitScore> | null> {
  const msg = (opts.userMessage || "").trim();
  if (!msg || !Array.isArray(opts.skills) || opts.skills.length === 0) return null;

  const safeEmbed = async (text: string): Promise<number[] | null> => {
    try {
      return await opts.embed(text);
    } catch {
      return null;
    }
  };

  const msgVec = await safeEmbed(msg.slice(0, 2000));
  if (!msgVec || msgVec.length === 0) return null;

  const out = new Map<string, SkillFitScore>();
  for (const s of opts.skills) {
    const text = skillFitText(s);
    if (!text || !s.name) continue;
    const key = cacheKey(text);
    let vec = skillVecCache.get(key) ?? null;
    if (!vec) {
      vec = await safeEmbed(text);
      if (vec && vec.length > 0) {
        if (skillVecCache.size >= CACHE_MAX) {
          const first = skillVecCache.keys().next().value;
          if (first !== undefined) skillVecCache.delete(first);
        }
        skillVecCache.set(key, vec);
      }
    }
    // ANY embedding failure fails the WHOLE pass open (null ⇒ caller renders
    // the exact untiered injection). A partial map would tag some skills and
    // leave others bare — a misleading half-signal (architect finding).
    if (!vec || vec.length === 0) return null;
    const sim = cosine(msgVec, vec);
    out.set(s.name, {
      similarity: sim,
      tier: tierFromSimilarity(sim, opts.highThreshold, opts.mediumThreshold),
    });
  }
  return out.size > 0 ? out : null;
}

/**
 * Score every skill's fit to the user message. Returns null (⇒ inject
 * untiered) on ANY failure or when the deadline expires — never throws.
 */
export async function scoreSkillFit(opts: SkillFitOptions): Promise<Map<string, SkillFitScore> | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;
  try {
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const work = scoreSkillFitInner(opts).catch(() => null);
    const result = await Promise.race([work, deadline]);
    // Swallow a late rejection from the losing branch.
    work.catch(() => {});
    return result;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Prompt preamble used whenever fit tags are present (keep wording stable). */
export const SKILL_FIT_PROMPT_RULE =
  "Each skill below is tagged with its semantic fit to the CURRENT request. " +
  "[fit: High] = likely the right procedure, follow it. " +
  "[fit: Medium] = possibly relevant, adapt it to the task. " +
  "[fit: Low] = probably NOT for this request — treat as background only; " +
  "never follow a Low-fit skill mechanically over your own task understanding. " +
  "OVERRIDE: if the user explicitly names or asks for a specific skill, use that " +
  "skill regardless of its fit tag — fit tags are relevance hints, never permissions.";
