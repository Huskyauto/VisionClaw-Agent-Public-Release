// Shared, prod-safe Isenberg / Idea Browser portfolio scoring core.
//
// Extracted from scripts/prioritize-isenberg-portfolio.ts so BOTH the one-time
// backfill script AND the daily in-process ingest task score against ONE rubric
// (no drift). This module is DB + network (Anthropic) only — NO file writes, NO
// Drive, NO subprocess — so it is safe to run on the ephemeral production FS.
//
// The build phase (file write + Auto Git Push) stays dev/workspace-only in
// server/agentic/ideabrowser-autobuild.ts; this module only sets each project's
// metadata.priority + tier:* tag, which is exactly what fetchTopCandidate reads.

import { db } from "../db";
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

// Keep model identical to the proven backfill scorer so newly-scored ideas rank
// consistently against the historically-scored portfolio.
export const SCORER_MODEL = "claude-sonnet-4-5-20250929";

// The pinned dated id above WILL eventually be retired by Anthropic. When that
// happens a raw messages.create 404s — historically swallowed by allSettled and
// surfaced only as "+0 scores". resolveScorerModel() checks the pinned id
// against the live /models list once per process and, if it's gone, falls back
// to the newest live claude-sonnet-* (loud log, never silent). If the /models
// call itself fails (network), we keep the pinned id — a retired model then
// fails LOUD downstream via the zero-score guard, never quietly.
let resolvedScorerModel: string | null = null;

export async function resolveScorerModel(client: Anthropic): Promise<string> {
  if (resolvedScorerModel) return resolvedScorerModel;
  try {
    const live = await client.models.list({ limit: 100 });
    const ids = live.data.map((m) => m.id);
    if (ids.includes(SCORER_MODEL)) {
      resolvedScorerModel = SCORER_MODEL;
    } else {
      // Newest sonnet lineage model; /v1/models returns newest-first.
      const fallback = ids.find((id) => id.includes("sonnet"));
      if (!fallback) throw new Error(`no live claude-sonnet-* model found (live ids: ${ids.slice(0, 10).join(", ")})`);
      console.warn(`[ideabrowser-score] pinned scorer model ${SCORER_MODEL} is RETIRED — falling back to newest live sonnet: ${fallback}. Scores may drift vs historical portfolio; consider a re-baseline.`);
      resolvedScorerModel = fallback;
    }
  } catch (err) {
    console.warn(`[ideabrowser-score] could not verify scorer model against live /models (${err instanceof Error ? err.message : String(err)}); using pinned ${SCORER_MODEL}`);
    resolvedScorerModel = SCORER_MODEL;
  }
  return resolvedScorerModel;
}

export interface ProjectRow {
  id: number;
  name: string;
  description: string;
  tags: string[];
}

export interface Score {
  id: number;
  vc_fit: number;
  market_signal: number;
  monetization: number;
  build_complexity: number;
  strategic_bonus: number;
  composite: number;
  tier: "S" | "A" | "B" | "C" | "Park";
  rationale: string;
  buyer_hypothesis: string;
  build_cost_estimate: string;
}

export const RUBRIC = `You are a venture-grade portfolio analyst scoring early-stage product ideas for VisionClaw.

VisionClaw context: a 16-persona AI corporate team (CEO + media + engineering + ops) that ships standalone products (e.g. [Your Product]) AND wedge SaaS (e.g. AI-Native Readiness Audit). Strengths: fast media generation (video/audio/images via Felix pipeline), agent orchestration, multi-tenant SaaS infra, automated content engines. Weaknesses: solo founder bandwidth, no enterprise sales motion, no hardware.

Active strategic wedges already in motion:
- Monetization Plays & Wedge (R125+8.9 GTM brief)
- AI-Native Readiness Audit (Idea Browser wedge — productized + waitlist live at /audit)
- Audit Monitoring $99/mo Recurring Tier (waitlist live)
- Daedalus — Agent-Owned Platform Engineering
- Built With Bob YouTube channel (wellness origin story)

For each project, return a JSON object with these fields:
- id (integer, match input)
- vc_fit (1-5): does VC's stack (AI personas, Felix media, ensemble jury, agent orchestration) give 10x advantage over a normal team? 5=clear unfair advantage, 1=our stack is irrelevant
- market_signal (1-5): clarity of pain, addressable $, urgency. Isenberg already filtered for this so default to 3. 5=screaming demand, 1=cute but no buyer
- monetization (1-5): can you name the buyer + a price in 5 min? subscription beats one-shot. 5=obvious SaaS pricing, 1=unclear who pays
- build_complexity (1-5): higher = more complex (will be inverted). 1=thin wrapper around free API, 5=hardware/regulatory/enterprise sales
- strategic_bonus (0-3): 0=standalone, 1=mild reinforcement, 2=feeds a wedge, 3=directly extends Monetization/Audit/Daedalus/BWB
- rationale (string, max 200 chars): 1-2 sentences why this score
- buyer_hypothesis (string, max 80 chars): "<buyer type> @ <price range>" or "unclear"
- build_cost_estimate (string): "S" (1-2 weeks solo), "M" (1-2 months), "L" (3+ months)

Return ONLY a JSON array, no prose. Score every input id.`;

export function computeComposite(s: Omit<Score, "composite" | "tier">): number {
  return s.vc_fit * 2 + s.market_signal + s.monetization + (6 - s.build_complexity) + s.strategic_bonus;
}

export function tierFor(c: number): Score["tier"] {
  if (c >= 22) return "S";
  if (c >= 18) return "A";
  if (c >= 14) return "B";
  if (c >= 10) return "C";
  return "Park";
}

export async function scoreBatch(client: Anthropic, batch: ProjectRow[]): Promise<Score[]> {
  const input = batch.map((p) => ({
    id: p.id,
    name: p.name,
    description: (p.description || "").slice(0, 500),
    tags: p.tags,
  }));
  const msg = await client.messages.create({
    model: await resolveScorerModel(client),
    max_tokens: 6000,
    system: RUBRIC,
    messages: [{ role: "user", content: `Score these ${batch.length} projects. Be concise — keep rationale ≤120 chars.\n\n${JSON.stringify(input)}` }],
  });
  const text = msg.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No JSON array in response: ${text.slice(0, 200)}`);
  const raw = JSON.parse(jsonMatch[0]);
  return raw.map((r: any) => {
    const partial = {
      id: r.id,
      vc_fit: Number(r.vc_fit),
      market_signal: Number(r.market_signal),
      monetization: Number(r.monetization),
      build_complexity: Number(r.build_complexity),
      strategic_bonus: Number(r.strategic_bonus) || 0,
      rationale: String(r.rationale || "").slice(0, 240),
      buyer_hypothesis: String(r.buyer_hypothesis || "unclear").slice(0, 100),
      build_cost_estimate: String(r.build_cost_estimate || "M"),
    };
    const composite = computeComposite(partial);
    return { ...partial, composite, tier: tierFor(composite) } as Score;
  });
}

export async function persistScores(scores: Score[], tenantId: number): Promise<void> {
  for (const s of scores) {
    const meta = {
      priority: {
        scored_at: new Date().toISOString(),
        scorer: "isenberg-portfolio-prioritization-2026-05-25",
        rubric_version: "v1",
        vc_fit: s.vc_fit,
        market_signal: s.market_signal,
        monetization: s.monetization,
        build_complexity: s.build_complexity,
        strategic_bonus: s.strategic_bonus,
        composite: s.composite,
        tier: s.tier,
        rationale: s.rationale,
        buyer_hypothesis: s.buyer_hypothesis,
        build_cost_estimate: s.build_cost_estimate,
      },
    };
    await db.execute(sql`
      UPDATE projects
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(meta)}::jsonb,
          tags = (
            SELECT ARRAY(
              SELECT DISTINCT unnest(tags || ARRAY[${'tier:' + s.tier}]::text[])
            )
          )
      WHERE id = ${s.id} AND tenant_id = ${tenantId}
    `);
  }
}

export interface ScoreRunSummary {
  scored: number;
  tiers: Record<string, number>;
  errors: string[];
}

/**
 * Prod-safe daily scorer: find unscored Isenberg/IdeaBrowser idea-stage projects
 * for a tenant and score them in-process (Anthropic → metadata.priority + tier
 * tag). Idempotent — only touches rows lacking metadata.priority unless rescore.
 * Never throws: per-batch failures are collected in `errors`.
 */
export async function scoreUnscoredIsenberg(opts: {
  tenantId: number;
  rescore?: boolean;
  batchSize?: number;
  parallel?: number;
}): Promise<ScoreRunSummary> {
  const tenantId = opts.tenantId;
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? 10, 25));
  const parallel = Math.max(1, Math.min(opts.parallel ?? 4, 6));
  const summary: ScoreRunSummary = { scored: 0, tiers: { S: 0, A: 0, B: 0, C: 0, Park: 0 }, errors: [] };

  if (!process.env.ANTHROPIC_API_KEY) {
    summary.errors.push("ANTHROPIC_API_KEY not set — cannot score");
    return summary;
  }

  let toScore: ProjectRow[] = [];
  try {
    const res: any = await db.execute(sql`
      SELECT id, name, description, tags
      FROM projects
      WHERE tenant_id = ${tenantId}
        AND ('isenberg' = ANY(tags) OR 'ideabrowser' = ANY(tags) OR 'iotd' = ANY(tags))
        AND (${opts.rescore ?? false} OR NOT (metadata ? 'priority'))
      ORDER BY id ASC
    `);
    toScore = ((res.rows || res) as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || "",
      tags: r.tags || [],
    }));
  } catch (e: any) {
    summary.errors.push(`load: ${e?.message || e}`);
    return summary;
  }

  if (toScore.length === 0) return summary;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const batches: ProjectRow[][] = [];
  for (let i = 0; i < toScore.length; i += batchSize) batches.push(toScore.slice(i, i + batchSize));

  for (let g = 0; g < batches.length; g += parallel) {
    const group = batches.slice(g, g + parallel);
    const results = await Promise.allSettled(group.map((b) => scoreBatch(client, b)));
    for (const r of results) {
      if (r.status === "fulfilled") {
        try {
          await persistScores(r.value, tenantId);
          summary.scored += r.value.length;
          for (const s of r.value) summary.tiers[s.tier] = (summary.tiers[s.tier] || 0) + 1;
        } catch (e: any) {
          summary.errors.push(`persist: ${e?.message || e}`);
        }
      } else {
        summary.errors.push(`batch: ${r.reason?.message || r.reason}`);
      }
    }
  }

  return summary;
}
