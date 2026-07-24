/**
 * Simulation Sandbox — output grading (Slice S3).
 * Contract: data/feature-contracts/simulation-sandbox/spec.md
 *
 * Similarity grade for model-swap replay: embedding cosine between the
 * historical baseline output and the simulated output ($0 modelfarm
 * embedding lane). Quality grading fails OPEN — a grading failure returns
 * null and is counted as ungraded, never invented and never fatal to the
 * run (safety fails closed; quality fails open).
 */
import { generateEmbedding, cosineSimilarity } from "../../embeddings";

/** Cosine similarity in [0,1]-ish range, or null when grading was impossible. */
export async function gradeSimilarity(baseline: string, simulated: string): Promise<number | null> {
  const a = String(baseline || "").trim();
  const b = String(simulated || "").trim();
  if (!a || !b) return null;
  try {
    const [ea, eb] = await Promise.all([generateEmbedding(a), generateEmbedding(b)]);
    if (!ea || !eb || ea.length !== eb.length) return null;
    const sim = cosineSimilarity(ea, eb);
    return Number.isFinite(sim) ? Math.round(sim * 10000) / 10000 : null;
  } catch (err: any) {
    // Fail-open by design (quality signal), but never silently: an embedding
    // outage turning every item ungraded must be visible in the logs, and the
    // report layer now refuses a confident verdict when graded === 0.
    console.warn(`[sandbox-grade] similarity grading failed (item ungraded): ${err?.message || err}`);
    return null;
  }
}

export interface SimilarityStats {
  graded: number;
  ungraded: number;
  mean: number | null;
  min: number | null;
  /** Items below the drift threshold (0.75) — flagged for eyeballs. */
  belowThreshold: number;
}

export const SIMILARITY_DRIFT_THRESHOLD = 0.75;

/** Pure: aggregate per-item similarity scores. */
export function summarizeSimilarity(scores: Array<number | null>): SimilarityStats {
  const graded = scores.filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  const ungraded = scores.length - graded.length;
  if (graded.length === 0) return { graded: 0, ungraded, mean: null, min: null, belowThreshold: 0 };
  const mean = graded.reduce((a, b) => a + b, 0) / graded.length;
  return {
    graded: graded.length,
    ungraded,
    mean: Math.round(mean * 10000) / 10000,
    min: Math.min(...graded),
    belowThreshold: graded.filter((s) => s < SIMILARITY_DRIFT_THRESHOLD).length,
  };
}
