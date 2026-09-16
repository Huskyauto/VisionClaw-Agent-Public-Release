// R74.13z-quint Nugget 2: Knowledge Diversity Monitor (SIGReg-inspired)
//
// Inspired by LeWorldModel's SIGReg regularizer (Maes et al. arXiv:2603.19312v1).
// SIGReg projects high-dim embeddings onto K random univariate directions, runs
// a normality test on each 1-D distribution, and aggregates the failures —
// detecting when embeddings collapse toward a single point.
//
// Here we DON'T use it as a training-time regularizer; we use it as a passive
// nightly diagnostic over agent_knowledge per (tenant, persona). When entries
// start clustering — the silent failure mode where every "lesson" looks the
// same — we write a single line into operator-visible notifications.
//
// Two cheap statistics, no neural net:
//   1. mean_pairwise_cosine    — large = clustered
//   2. sigreg_pvalue           — Anderson-Darling-style test on K random axes
// Either crossing threshold emits an alert.

import { db } from "./db";
import { sql } from "drizzle-orm";
import { logSilentCatch } from "./lib/silent-catch";

const SIGREG_AXES = 32;
const SAMPLE_LIMIT = 200;
const MIN_ENTRIES = 50;
// Alert thresholds tuned for real-world OpenAI text-embedding-3-small stores,
// which are topical/clustered by construction (NOT isotropic Gaussian like
// LeWM trains toward). The honest collapse signal is mean pairwise cosine
// crossing a high bar — SIGReg p-values are kept as secondary diagnostics
// recorded in every snapshot for week-over-week trending, but they don't
// trigger alerts on their own (they'd cry wolf on every healthy topical
// embedding store).
const COSINE_ALERT_THRESHOLD = 0.78;
const SEVERE_COSINE_THRESHOLD = 0.88;
// Only used in the AND clause: a moderately-elevated cosine PLUS an almost-
// zero p-value = real signal that variety is collapsing relative to history.
const COSINE_WARNING_THRESHOLD = 0.65;
const SEVERE_PVALUE_THRESHOLD = 1e-15;
const PER_TENANT_PERSONA_COOLDOWN_HOURS = 23;

interface DiversitySnapshot {
  tenantId: number;
  personaId: number | null;
  sampleSize: number;
  meanPairwiseCosine: number;
  sigregPvalue: number;
  axesFailed: number;
  alertEmitted: boolean;
  detail: string;
}

function parsePgVector(s: string): number[] {
  if (!s) return [];
  const inside = s.replace(/^\[/, "").replace(/\]$/, "");
  return inside.split(",").map(Number);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}
function normalize(a: number[]): number[] {
  const n = norm(a);
  if (n === 0) return a.slice();
  return a.map(x => x / n);
}
function cosine(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

// Mulberry32 deterministic PRNG so successive snapshots use the same axes
// (week-over-week comparisons are apples-to-apples).
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnitVector(rng: () => number, dim: number): number[] {
  // Box-Muller for an unbiased sample on the (dim-1)-sphere.
  const v: number[] = new Array(dim);
  for (let i = 0; i < dim; i += 2) {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    v[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < dim) v[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return normalize(v);
}

// Cheap normality proxy: standardized skewness + excess-kurtosis combined into
// a Jarque-Bera-style chi-square statistic, converted to a p-value via the
// chi-square(2) survival function. Faster than full Anderson-Darling and
// captures the dominant collapse signatures (heavy single-point spikes).
function jarqueBeraPValue(xs: number[]): number {
  const n = xs.length;
  if (n < 8) return 1;
  let mean = 0;
  for (const x of xs) mean += x;
  mean /= n;
  let m2 = 0, m3 = 0, m4 = 0;
  for (const x of xs) {
    const d = x - mean;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  m2 /= n; m3 /= n; m4 /= n;
  if (m2 < 1e-20) return 0; // perfectly degenerate axis = collapsed
  const skew = m3 / Math.pow(m2, 1.5);
  const kurt = m4 / (m2 * m2) - 3;
  const jb = (n / 6) * (skew * skew + (kurt * kurt) / 4);
  // Survival function of chi-square with 2 d.o.f. is exp(-x/2).
  return Math.exp(-jb / 2);
}

function meanPairwiseCosine(vecs: number[][]): number {
  const n = vecs.length;
  if (n < 2) return 0;
  // For large n, sample pairs to keep this O(samples) instead of O(n^2).
  const MAX_PAIRS = 1500;
  const pairs: [number, number][] = [];
  if ((n * (n - 1)) / 2 <= MAX_PAIRS) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
  } else {
    while (pairs.length < MAX_PAIRS) {
      const i = Math.floor(Math.random() * n);
      const j = Math.floor(Math.random() * n);
      if (i !== j) pairs.push([i, j]);
    }
  }
  let s = 0;
  for (const [i, j] of pairs) s += cosine(vecs[i], vecs[j]);
  return s / pairs.length;
}

// SIGReg-style: project onto K axes, run normality test on each, aggregate.
// Returns geometric-mean p-value across axes + count of axes that failed at
// SEVERE_PVALUE_THRESHOLD.
function slicedNormalityCheck(vecs: number[][], dim: number): { pvalue: number; axesFailed: number } {
  if (vecs.length < 8 || dim === 0) return { pvalue: 1, axesFailed: 0 };
  const rng = mulberry32(0xc0ffee);
  let logSum = 0;
  let failed = 0;
  for (let k = 0; k < SIGREG_AXES; k++) {
    const axis = randomUnitVector(rng, dim);
    const projected = vecs.map(v => dot(v, axis));
    const p = jarqueBeraPValue(projected);
    if (p < SEVERE_PVALUE_THRESHOLD) failed++;
    logSum += Math.log(Math.max(p, 1e-12));
  }
  return { pvalue: Math.exp(logSum / SIGREG_AXES), axesFailed: failed };
}

async function loadEmbeddings(tenantId: number, personaId: number | null): Promise<number[][]> {
  const rows: any = personaId === null
    ? await db.execute(sql`
        SELECT embedding_vec FROM agent_knowledge
        WHERE tenant_id = ${tenantId} AND embedding_vec IS NOT NULL AND persona_id IS NULL
        ORDER BY id DESC LIMIT ${SAMPLE_LIMIT}
      `)
    : await db.execute(sql`
        SELECT embedding_vec FROM agent_knowledge
        WHERE tenant_id = ${tenantId} AND embedding_vec IS NOT NULL AND persona_id = ${personaId}
        ORDER BY id DESC LIMIT ${SAMPLE_LIMIT}
      `);
  return (rows.rows || [])
    .map((r: any) => parsePgVector(r.embedding_vec))
    .filter((v: number[]) => v.length > 0);
}

async function recentlySnapshotted(tenantId: number, personaId: number | null): Promise<boolean> {
  const r: any = personaId === null
    ? await db.execute(sql`
        SELECT 1 FROM knowledge_diversity_snapshots
        WHERE tenant_id = ${tenantId} AND persona_id IS NULL
          AND snapshot_at > NOW() - INTERVAL '${sql.raw(String(PER_TENANT_PERSONA_COOLDOWN_HOURS))} hours'
        LIMIT 1
      `)
    : await db.execute(sql`
        SELECT 1 FROM knowledge_diversity_snapshots
        WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
          AND snapshot_at > NOW() - INTERVAL '${sql.raw(String(PER_TENANT_PERSONA_COOLDOWN_HOURS))} hours'
        LIMIT 1
      `);
  return (r.rows?.length ?? 0) > 0;
}

export async function snapshotKnowledgeDiversity(
  tenantId: number,
  personaId: number | null,
): Promise<DiversitySnapshot | null> {
  try {
    if (await recentlySnapshotted(tenantId, personaId)) return null;
    const vecs = await loadEmbeddings(tenantId, personaId);
    if (vecs.length < MIN_ENTRIES) return null;
    const dim = vecs[0].length;
    const meanCos = meanPairwiseCosine(vecs);
    const { pvalue, axesFailed } = slicedNormalityCheck(vecs, dim);
    // Honest collapse criterion: high mean cosine alone, OR a confirmed
    // moderate-cosine + extreme-non-normality combo. Real text-embedding
    // stores cluster topically with mean_cos ~0.4-0.6, so SIGReg p-values
    // are essentially always tiny and can't trigger by themselves.
    const collapsed =
      meanCos > COSINE_ALERT_THRESHOLD ||
      (meanCos > COSINE_WARNING_THRESHOLD && pvalue < SEVERE_PVALUE_THRESHOLD);
    const severe = meanCos > SEVERE_COSINE_THRESHOLD;

    let alertEmitted = false;
    if (collapsed) {
      const personaLabel = personaId === null ? "global tenant knowledge" : `persona #${personaId}`;
      try {
        await db.execute(sql`
          INSERT INTO notifications (tenant_id, type, title, message, category, action_url, metadata)
          VALUES (
            ${tenantId},
            'warning',
            'Knowledge entries are clustering (diversity dropping)',
            ${`Recent agent_knowledge entries for ${personaLabel} are starting to look the same (mean pairwise cosine ${meanCos.toFixed(3)}, normality p ${pvalue.toExponential(2)}, ${axesFailed}/${SIGREG_AXES} axes failed). Suggested actions: prune duplicates, ingest fresh sources, or pause auto-ingestion. Sample size: ${vecs.length}.`},
            'knowledge_health',
            ${`/knowledge?tenant=${tenantId}${personaId ? `&persona=${personaId}` : ""}`},
            ${sql`${JSON.stringify({ tenant_id: tenantId, persona_id: personaId, mean_pairwise_cosine: meanCos, sigreg_pvalue: pvalue, axes_failed: axesFailed, sample_size: vecs.length })}::jsonb`}
          )
        `);
        alertEmitted = true;
      } catch (e) {
        logSilentCatch("server/knowledge-diversity-monitor.ts:notify", e);
      }
    }

    await db.execute(sql`
      INSERT INTO knowledge_diversity_snapshots
        (tenant_id, persona_id, sample_size, mean_pairwise_cosine, sigreg_pvalue, sigreg_axes_failed, alert_emitted)
      VALUES
        (${tenantId}, ${personaId}, ${vecs.length}, ${meanCos}, ${pvalue}, ${axesFailed}, ${alertEmitted})
    `);

    return {
      tenantId, personaId, sampleSize: vecs.length,
      meanPairwiseCosine: meanCos, sigregPvalue: pvalue, axesFailed, alertEmitted,
      detail: collapsed ? "alert emitted" : "healthy diversity",
    };
  } catch (e) {
    logSilentCatch("server/knowledge-diversity-monitor.ts:snapshot", e);
    return null;
  }
}

// Iterate every (tenant_id, persona_id) pair with enough entries to score.
// Called once per heartbeat day (gated by recentlySnapshotted cooldown).
export async function runKnowledgeDiversityMonitor(): Promise<{ scanned: number; snapshotsTaken: number; alertsEmitted: number }> {
  const scanned = { scanned: 0, snapshotsTaken: 0, alertsEmitted: 0 };
  try {
    const pairs: any = await db.execute(sql`
      SELECT tenant_id, persona_id, COUNT(*) AS n
      FROM agent_knowledge
      WHERE embedding_vec IS NOT NULL
      GROUP BY tenant_id, persona_id
      HAVING COUNT(*) >= ${MIN_ENTRIES}
    `);
    for (const row of (pairs.rows || [])) {
      scanned.scanned++;
      const snap = await snapshotKnowledgeDiversity(row.tenant_id, row.persona_id);
      if (snap) {
        scanned.snapshotsTaken++;
        if (snap.alertEmitted) scanned.alertsEmitted++;
      }
    }
  } catch (e) {
    logSilentCatch("server/knowledge-diversity-monitor.ts:run", e);
  }
  return scanned;
}
