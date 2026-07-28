// R74.13z-quint Nugget 1: Surprise Score on Felix Proposals
//
// Inspired by LeWorldModel (Maes et al. arXiv:2603.19312v1, Mila/NYU Mar 2026).
// Their core insight: prediction error in latent space = a learned anomaly
// detector. We reuse the same idea over felix_proposals: for every executed
// step, we compare the embedding of its actual outcome against the *averaged*
// outcome of the K nearest historical steps with the same kind. High distance
// = "surprise" — the verifier flags it for human review even if the
// expected_post_state contract technically passed.
//
// kNN-in-embedding-space is a non-parametric stand-in for the JEPA predictor.
// No training is required; the model "learns" by accumulating completed
// proposals. Scales linearly with corpus size (HNSW index keeps lookup cheap).
//
// Three bands: green (low), yellow (medium), red (high). Bands are the only
// signal personas / Bob actually need to read — raw scores stay internal.

import { db } from "./db";
import { sql } from "drizzle-orm";
import { generateEmbedding } from "./embeddings";
import { logSilentCatch } from "./lib/silent-catch";

// Spec: kNN over the last 200 outcomes of the same kind. HNSW index keeps
// this O(log N), so 200 is just as cheap as 5 in practice.
const KNN_NEIGHBORS = 200;
const MIN_NEIGHBORS_FOR_SCORE = 3;

// Bands tuned around cosine *distance* (1 - cosine_similarity). Distance 0 =
// identical, 1 = orthogonal, 2 = opposite. Real outcome embeddings cluster
// tightly within a kind, so even small distances mean something.
const BAND_GREEN_MAX = 0.18;
const BAND_YELLOW_MAX = 0.38;

export type SurpriseBand = "green" | "yellow" | "red" | "no_history" | "error";

export interface SurpriseResult {
  proposalId: number;
  score: number | null;
  band: SurpriseBand;
  neighborsUsed: number;
  detail: string;
}

// Build a stable string from the proposal's static inputs (kind + target +
// args). We deliberately exclude ephemeral fields so neighbor lookup matches
// on intent, not on ID/timestamps.
function buildArgsBlob(p: {
  kind: string;
  target: string | null;
  target_args: any;
  summary?: string;
}): string {
  const args = (() => {
    try {
      const j = typeof p.target_args === "string" ? p.target_args : JSON.stringify(p.target_args ?? {});
      return j.slice(0, 500);
    } catch {
      return "";
    }
  })();
  const parts = [
    `kind=${p.kind}`,
    p.target ? `target=${p.target.slice(0, 120)}` : "",
    `args=${args}`,
    p.summary ? `summary=${p.summary.slice(0, 200)}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

function buildOutcomeBlob(execResult: string | null): string {
  if (!execResult) return "no_outcome";
  return execResult.slice(0, 800);
}

// pgvector wants the embedding as a "[0.1,0.2,...]" string literal.
function toPgVector(arr: number[]): string {
  return `[${arr.join(",")}]`;
}

// Stamp args_embedding at proposal-create time so future neighbor searches
// can find this row. Best-effort; if embedding fails we just skip.
export async function stampArgsEmbedding(proposalId: number, p: {
  kind: string;
  target: string | null;
  target_args: any;
  summary?: string;
}): Promise<void> {
  try {
    const blob = buildArgsBlob(p);
    const emb = await generateEmbedding(blob);
    if (!emb || emb.length !== 1536) return;
    const vec = toPgVector(emb);
    await db.execute(sql`
      UPDATE felix_proposals
      SET args_embedding = ${vec}::vector
      WHERE id = ${proposalId} AND args_embedding IS NULL
    `);
  } catch (e) {
    logSilentCatch("server/surprise-scorer.ts:stampArgsEmbedding", e);
  }
}

// Called from the felix-loop after a proposal lands in 'executed' or
// 'verification_failed'. Embeds the outcome, runs kNN over historical
// completed proposals of the same kind, computes cosine distance to the
// neighbor centroid, writes score + band onto the row.
export async function scoreProposalSurprise(proposalId: number, tenantId: number = 1): Promise<SurpriseResult> {
  try {
    const r: any = await db.execute(sql`
      SELECT id, kind, target, target_args, summary, execution_result, args_embedding
      FROM felix_proposals
      WHERE id = ${proposalId} AND tenant_id = ${tenantId}
    `);
    const p = r.rows?.[0];
    if (!p) {
      return { proposalId, score: null, band: "no_history", neighborsUsed: 0, detail: "proposal not found" };
    }

    // Stamp args embedding lazily if it wasn't set at create-time (back-fill).
    if (!p.args_embedding) {
      await stampArgsEmbedding(proposalId, p);
    }

    // Embed the actual outcome. A null/invalid return = embedding service
    // outage (silent), NOT lack of history. Stamp 'error' so it surfaces.
    const outcomeBlob = buildOutcomeBlob(p.execution_result);
    const outcomeEmb = await generateEmbedding(outcomeBlob);
    if (!outcomeEmb || outcomeEmb.length !== 1536) {
      try {
        await db.execute(sql`
          UPDATE felix_proposals SET surprise_band = 'error'
          WHERE id = ${proposalId} AND tenant_id = ${tenantId}
        `);
      } catch (e) { logSilentCatch("server/surprise-scorer.ts:scoreProposalSurprise:embed-null-stamp", e); }
      return { proposalId, score: null, band: "error", neighborsUsed: 0, detail: "embedding service returned null/invalid — stamped 'error' band (not 'no_history') to keep outage visible" };
    }
    const outcomeVec = toPgVector(outcomeEmb);

    await db.execute(sql`
      UPDATE felix_proposals
      SET actual_outcome_embedding = ${outcomeVec}::vector
      WHERE id = ${proposalId}
    `);

    // kNN: nearest historical proposals of the same kind that have BOTH an
    // args embedding AND a recorded outcome embedding. Exclude self.
    // Re-fetch the args embedding because we may have just stamped it.
    const argsRow: any = await db.execute(sql`
      SELECT args_embedding FROM felix_proposals WHERE id = ${proposalId}
    `);
    const argsEmbStr = argsRow.rows?.[0]?.args_embedding;
    if (!argsEmbStr) {
      // Args embedding still missing after re-stamp attempt — embedding
      // service is degraded. Stamp 'error', not 'no_history'.
      try {
        await db.execute(sql`
          UPDATE felix_proposals SET surprise_band = 'error'
          WHERE id = ${proposalId} AND tenant_id = ${tenantId}
        `);
      } catch (e) { logSilentCatch("server/surprise-scorer.ts:scoreProposalSurprise:args-null-stamp", e); }
      return { proposalId, score: null, band: "error", neighborsUsed: 0, detail: "args embedding still unavailable after lazy stamp — embedding service degraded" };
    }

    const neighbors: any = await db.execute(sql`
      SELECT id,
             actual_outcome_embedding,
             1 - (args_embedding <=> ${argsEmbStr}::vector) AS args_sim
      FROM felix_proposals
      WHERE tenant_id = ${tenantId}
        AND kind = ${p.kind}
        AND id <> ${proposalId}
        AND args_embedding IS NOT NULL
        AND actual_outcome_embedding IS NOT NULL
      ORDER BY args_embedding <=> ${argsEmbStr}::vector
      LIMIT ${KNN_NEIGHBORS}
    `);
    const nRows = neighbors.rows || [];
    if (nRows.length < MIN_NEIGHBORS_FOR_SCORE) {
      // Not enough history to score — record band='no_history' so the UI shows
      // a neutral chip instead of misleading green.
      await db.execute(sql`
        UPDATE felix_proposals
        SET surprise_band = 'no_history'
        WHERE id = ${proposalId}
      `);
      return {
        proposalId,
        score: null,
        band: "no_history",
        neighborsUsed: nRows.length,
        detail: `only ${nRows.length} historical neighbors (need ${MIN_NEIGHBORS_FOR_SCORE}); not enough to score`,
      };
    }

    // Compute cosine distance from this outcome to each neighbor outcome,
    // average. Lower mean distance = closer to historical pattern = less
    // surprising. Neighbor IDs are DB-derived (never user input) but we
    // parameterize anyway for consistency with Bob's hard rule.
    const neighborIds: number[] = nRows.map((n: any) => Number(n.id)).filter(Number.isFinite);
    const distRow: any = await db.execute(sql`
      SELECT AVG(actual_outcome_embedding <=> ${outcomeVec}::vector) AS mean_dist
      FROM felix_proposals
      WHERE id = ANY(${neighborIds}::int[])
    `);
    const meanDist: number = Number(distRow.rows?.[0]?.mean_dist ?? 0);

    let band: SurpriseBand;
    if (meanDist < BAND_GREEN_MAX) band = "green";
    else if (meanDist < BAND_YELLOW_MAX) band = "yellow";
    else band = "red";

    await db.execute(sql`
      UPDATE felix_proposals
      SET surprise_score = ${meanDist}, surprise_band = ${band}
      WHERE id = ${proposalId}
    `);

    // Red surprises emit a notification so they don't sit unread in the
    // proposal row alone. Bob sees one line: "Step X had a high surprise — review".
    // Cooldown: skip if we already alerted on the same (tenant,kind) in the
    // last 15 minutes — prevents notification floods on cascading anomalies
    // (e.g. an embedding model brown-out flipping many proposals red at once).
    if (band === "red") {
      try {
        const recentAlert: any = await db.execute(sql`
          SELECT 1 FROM notifications
          WHERE tenant_id = ${tenantId}
            AND category = 'felix_loop'
            AND metadata->>'kind' = ${p.kind}
            AND created_at > NOW() - INTERVAL '15 minutes'
          LIMIT 1
        `);
        if ((recentAlert.rows || []).length === 0) {
          await db.execute(sql`
            INSERT INTO notifications (tenant_id, type, title, message, category, action_url, metadata)
            VALUES (
              ${tenantId},
              'warning',
              'High-surprise plan step (review recommended)',
              ${`Felix proposal #${proposalId} (${p.kind}) finished with surprise score ${meanDist.toFixed(3)} — its actual outcome diverged sharply from ${nRows.length} similar historical steps. Open the proposal to confirm.`},
              'felix_loop',
              ${`/agent-board?proposal=${proposalId}`},
              ${sql`${JSON.stringify({ proposal_id: proposalId, kind: p.kind, surprise_score: meanDist, neighbors: nRows.length })}::jsonb`}
            )
          `);
        }
      } catch (e) {
        logSilentCatch("server/surprise-scorer.ts:notify", e);
      }

      // R74.13z-quint+2 — auto-create a TENSION row so the conflict between
      // Felix's expected outcome and the actual one becomes a queryable graph
      // entity. Personas can call list_open_tensions to learn from prior red
      // surprises before re-attempting similar plans. Same 15-min cooldown
      // (this kind, this tenant) so an embedding brown-out doesn't flood the
      // tensions list. Failures here are swallowed — the surprise score and
      // notification are already recorded; missing the tension row must NOT
      // break the scorer.
      try {
        const recentTension: any = await db.execute(sql`
          SELECT 1 FROM tensions
          WHERE tenant_id = ${tenantId}
            AND source_kind = 'surprise'
            AND evidence::text LIKE ${'%"kind":"' + p.kind + '"%'}
            AND created_at > NOW() - INTERVAL '15 minutes'
          LIMIT 1
        `);
        if ((recentTension.rows || []).length === 0) {
          await db.execute(sql`
            INSERT INTO tensions (tenant_id, title, predicted_state, actual_state, evidence, source_kind, source_id, status)
            VALUES (
              ${tenantId},
              ${`High-surprise outcome for ${p.kind} step (proposal #${proposalId})`},
              ${sql`${JSON.stringify({ description: `Felix expected outcome similar to ${nRows.length} historical ${p.kind} steps`, neighbor_count: nRows.length })}::jsonb`},
              ${sql`${JSON.stringify({ description: `Outcome diverged sharply from neighbors (cosine distance ${meanDist.toFixed(3)})`, surprise_score: meanDist, kind: p.kind })}::jsonb`},
              ${sql`${JSON.stringify([{ type: "felix_proposal", id: proposalId, action_url: `/agent-board?proposal=${proposalId}` }])}::jsonb`},
              'surprise',
              ${proposalId},
              'open'
            )
          `);
        }
      } catch (e) {
        logSilentCatch("server/surprise-scorer.ts:auto-tension", e);
      }
    }

    return {
      proposalId,
      score: meanDist,
      band,
      neighborsUsed: nRows.length,
      detail: `mean cosine distance to ${nRows.length} nearest neighbors of kind '${p.kind}': ${meanDist.toFixed(3)} (${band})`,
    };
  } catch (e: any) {
    // EXPLICIT ERROR STATE — do not mask infra/embedding outages as
    // "no_history" (which would hide them as a healthy neutral signal). Try
    // to stamp the row's surprise_band so the UI shows the failure too.
    logSilentCatch("server/surprise-scorer.ts:scoreProposalSurprise", e);
    try {
      await db.execute(sql`
        UPDATE felix_proposals
        SET surprise_band = 'error'
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}
      `);
    } catch (e2) {
      logSilentCatch("server/surprise-scorer.ts:scoreProposalSurprise:band-stamp", e2);
    }
    return { proposalId, score: null, band: "error", neighborsUsed: 0, detail: `ERROR: scoring failed (${e?.message || e}); not 'no_history' — investigate embedding/db` };
  }
}

// Read-only stats for the agent board UI / personas / Bob. Includes error
// band so embedding/db outages stay visible (don't get masked as no_history).
export async function getSurpriseStats(tenantId: number = 1): Promise<{
  total: number;
  byBand: Record<SurpriseBand, number>;
  recentRedIds: number[];
  recentErrorIds: number[];
}> {
  try {
    const r: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE surprise_band IS NOT NULL) AS total,
        COUNT(*) FILTER (WHERE surprise_band = 'green') AS green,
        COUNT(*) FILTER (WHERE surprise_band = 'yellow') AS yellow,
        COUNT(*) FILTER (WHERE surprise_band = 'red') AS red,
        COUNT(*) FILTER (WHERE surprise_band = 'no_history') AS no_history,
        COUNT(*) FILTER (WHERE surprise_band = 'error') AS error
      FROM felix_proposals
      WHERE tenant_id = ${tenantId}
    `);
    const row = r.rows?.[0] || {};
    const reds: any = await db.execute(sql`
      SELECT id FROM felix_proposals
      WHERE tenant_id = ${tenantId} AND surprise_band = 'red'
      ORDER BY executed_at DESC NULLS LAST LIMIT 10
    `);
    const errs: any = await db.execute(sql`
      SELECT id FROM felix_proposals
      WHERE tenant_id = ${tenantId} AND surprise_band = 'error'
      ORDER BY executed_at DESC NULLS LAST LIMIT 10
    `);
    return {
      total: Number(row.total || 0),
      byBand: {
        green: Number(row.green || 0),
        yellow: Number(row.yellow || 0),
        red: Number(row.red || 0),
        no_history: Number(row.no_history || 0),
        error: Number(row.error || 0),
      },
      recentRedIds: (reds.rows || []).map((x: any) => x.id),
      recentErrorIds: (errs.rows || []).map((x: any) => x.id),
    };
  } catch (e) {
    logSilentCatch("server/surprise-scorer.ts:getSurpriseStats", e);
    return { total: 0, byBand: { green: 0, yellow: 0, red: 0, no_history: 0, error: 0 }, recentRedIds: [], recentErrorIds: [] };
  }
}
