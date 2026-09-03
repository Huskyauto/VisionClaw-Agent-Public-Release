// R107 — Geometry of Consolidation (Vangara & Gopinath, NeurIPS 2026 sub.,
// MIT-licensed `niashwin/geometry-of-consolidation`). Pure-math helpers
// that compute the per-cluster geometry the paper uses to decide whether
// consolidation is safe.
//
// Key inequality: when a consolidator replaces n cluster members with
// m < n representatives, identity error has a lower bound that depends
// on the mean within-cluster cosine distance d̄ and the effective
// participation-ratio dimension d_eff. Two regimes:
//
//   - TIGHT  (d̄ <  θ')  centroid-style consolidation is safe
//   - SPREAD (d̄ ≥ θ')  identity must collapse — keep members distinct
//
// We use this to gate dream-consolidation merges + dedup decisions and
// to surface "at-risk" clusters via an audit tool. Pure math; no DB.

export type Regime = "tight" | "spread" | "degenerate";

export interface ClusterGeometry {
  n: number;
  dBar: number;     // mean pairwise cosine distance (1 - cos)
  dEff: number;     // participation-ratio dimension of the centered cluster
  regime: Regime;
  thetaPrime: number;
  margin: number;   // (thetaPrime - dBar); positive => tight, negative => spread
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function l2norm(a: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

function cosineDistance(a: number[], b: number[]): number {
  const na = l2norm(a);
  const nb = l2norm(b);
  if (na === 0 || nb === 0) return 1;
  return 1 - dot(a, b) / (na * nb);
}

/**
 * Coerce a memory_entries.embedding cell (jsonb or vector text or array)
 * into number[]. Returns null if unrecoverable. Fail-soft.
 */
export function coerceEmbedding(raw: unknown): number[] | null {
  if (!raw) return null;
  let v: unknown = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); }
    catch { return null; }
  }
  if (!Array.isArray(v)) return null;
  const arr: number[] = [];
  for (const x of v) {
    const n = typeof x === "number" ? x : Number(x);
    if (!Number.isFinite(n)) return null;
    arr.push(n);
  }
  return arr.length > 0 ? arr : null;
}

/**
 * Effective participation-ratio dimension of the centered cluster.
 *
 *   d_eff = (tr C)² / ||C||_F²    where C = (1/n) X^T X  on centered X
 *
 * Computed via the Gram matrix G = X X^T (n×n) using the identity
 *   ||X^T X||_F = ||X X^T||_F
 * which makes the cost O(n² d) instead of O(d²) — important since
 * memory embeddings are 1536-dim but clusters are tiny (n ≤ ~50).
 */
function effectiveDim(centered: number[][]): number {
  const n = centered.length;
  if (n < 2) return 0;
  // Build Gram matrix entries on the fly; we only need trace(G) and ||G||_F.
  let trG = 0;
  let frob2 = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const g = dot(centered[i], centered[j]);
      if (i === j) {
        trG += g;
        frob2 += g * g;
      } else {
        frob2 += 2 * g * g; // symmetry
      }
    }
  }
  // Architect R107 review (MEDIUM): numerical-stability guard. If all
  // centered vectors collapse to a near-zero subspace, frob2 can be a
  // tiny float that explodes the ratio. A degenerate centered cluster is
  // effectively a single point, so report dim=1 instead of NaN/Inf.
  if (frob2 < 1e-12) return n >= 2 ? 1 : 0;
  return (trG * trG) / frob2;
}

/**
 * Compute geometry of a memory cluster.
 *
 * @param embeddings  Per-member raw embeddings (any of jsonb / vector / array).
 *                    Non-coercible entries are silently dropped.
 * @param theta       Similarity threshold the consolidator uses (default 0.85
 *                    matches `findSimilarMemories` and dream-consolidation).
 *                    The retrieval cap half-angle is θ' = 1 - θ.
 */
export function computeClusterGeometry(
  embeddings: unknown[],
  theta: number = 0.85,
): ClusterGeometry {
  const vecs = embeddings.map(coerceEmbedding).filter((v): v is number[] => v !== null);
  const n = vecs.length;
  const thetaPrime = Math.max(0, Math.min(1, 1 - theta));

  if (n < 2) {
    return { n, dBar: 0, dEff: 0, regime: "degenerate", thetaPrime, margin: thetaPrime };
  }

  // Mean pairwise cosine distance.
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sum += cosineDistance(vecs[i], vecs[j]);
      pairs++;
    }
  }
  const dBar = pairs > 0 ? sum / pairs : 0;

  // Center for participation-ratio dimension.
  const d = vecs[0].length;
  const mean = new Array<number>(d).fill(0);
  for (const v of vecs) for (let i = 0; i < d; i++) mean[i] += v[i];
  for (let i = 0; i < d; i++) mean[i] /= n;
  const centered = vecs.map((v) => v.map((x, i) => x - mean[i]));

  const dEff = effectiveDim(centered);

  const margin = thetaPrime - dBar;
  const regime: Regime = dBar < thetaPrime ? "tight" : "spread";

  return { n, dBar, dEff, regime, thetaPrime, margin };
}

/**
 * Pair-wise specialisation used at the dedup decision point. For a single
 * candidate pair, d̄ collapses to (1 - cos) and d_eff is undefined (only
 * one direction of variation). The regime test is still meaningful: if
 * the pair's cosine distance ≥ θ', they sit in the spread regime and
 * merging them under the centroid would force identity collapse.
 */
export function pairRegime(a: unknown, b: unknown, theta: number = 0.85): {
  regime: Regime;
  dBar: number;
  thetaPrime: number;
  margin: number;
} {
  const va = coerceEmbedding(a);
  const vb = coerceEmbedding(b);
  const thetaPrime = Math.max(0, Math.min(1, 1 - theta));
  if (!va || !vb || va.length !== vb.length) {
    return { regime: "degenerate", dBar: 0, thetaPrime, margin: thetaPrime };
  }
  const dBar = cosineDistance(va, vb);
  return {
    regime: dBar < thetaPrime ? "tight" : "spread",
    dBar,
    thetaPrime,
    margin: thetaPrime - dBar,
  };
}

/**
 * Render a one-line geometry summary for telemetry / log lines.
 */
export function describeGeometry(g: ClusterGeometry): string {
  return `[geom n=${g.n} d̄=${g.dBar.toFixed(3)} d_eff=${g.dEff.toFixed(2)} θ'=${g.thetaPrime.toFixed(3)} ${g.regime}${g.margin >= 0 ? "" : " (collapse-risk)"}]`;
}
