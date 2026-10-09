#!/usr/bin/env -S npx tsx
/**
 * R125+52.40 (Bob 2026-06-16) — Fusion vs native MoA A/B harness.
 *
 * Compares OpenRouter Fusion (managed panel→judge→synthesize, model alias
 * `openrouter/fusion`) against our native executeMoA on the same prompts:
 *   - answer quality proxy: answer length + cross-answer embedding similarity
 *     (how far Fusion's answer diverges from our ensemble's)
 *   - latency (wall-clock per side)
 *   - κ-concordance + escalation (MoA side; Fusion is a black box here)
 *   - REAL $ cost (Fusion side, read from OpenRouter usage.cost). Our MoA runs
 *     on the free modelfarm lane by default, so its marginal $ is ~0 — that is
 *     precisely the comparison: ~free ensemble vs metered managed service.
 *
 * Fusion is METERED. By DEFAULT this script runs in DRY mode: it executes the
 * native MoA (free) and proves the Fusion backend is wired (resolves the
 * client via getClientForModel) but SKIPS the paid Fusion completion. To
 * actually call Fusion and spend money, opt in explicitly:
 *
 *   FUSION_AB_CONFIRM_SPEND=1 AB_TENANT_ID=1 AB_LIMIT=3 npx tsx scripts/fusion-vs-moa-ab.ts
 *
 * Optional env:
 *   AB_TENANT_ID            numeric tenant id (default 1)
 *   AB_POOL                 MoA pool: frontier|cheap|mixed (default frontier)
 *   AB_PROMPTS              path to JSON string[] of prompts (default built-in)
 *   AB_LIMIT                cap number of prompts (default all)
 *   AB_OUT                  CSV path (default fusion-ab-<ts>.csv)
 *   FUSION_MODEL            OpenRouter alias (default openrouter/fusion)
 *   FUSION_AB_CONFIRM_SPEND set to 1/true to actually call (and pay for) Fusion
 *
 * Exit codes:
 *   0  completed (dry or live)
 *   1  config / env / setup error
 *   2  live mode and >=50% of Fusion calls failed
 */

import * as fs from "fs";
import * as path from "path";
import { executeMoA, type ProposerPool } from "../server/moa";
import { getClientForModel } from "../server/providers";
import { recordCost } from "../server/agentic/cost-ledger";
import { generateEmbedding, cosineSimilarity } from "../server/embeddings";

// Research / expert-critique prompts — the use case Fusion is built for.
const DEFAULT_PROMPTS: string[] = [
  "What are the strongest arguments for and against using a monorepo for a 40-engineer startup shipping a web app, a mobile app, and a shared design system? Give a clear recommendation.",
  "A B2B SaaS has rising churn concentrated in month 2. Lay out the most likely root causes in priority order and the single highest-leverage experiment to run first.",
  "Compare three credible strategies for reducing LLM inference cost in production by 50% without a meaningful quality drop, and name the hidden risk in each.",
  "Evaluate whether a seed-stage company should adopt event sourcing for its core ledger. Steelman both sides and give a decision rule.",
  "What does the current research actually say about whether multi-agent LLM debate improves factual accuracy versus a single strong model with good prompting?",
  "Design a pragmatic on-call rotation + incident-response process for a 6-person backend team that has never had one. What are the two things teams most often get wrong?",
];

function readPromptsFile(p: string): string[] {
  const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!Array.isArray(parsed) || !parsed.every((s) => typeof s === "string")) {
    throw new Error(`AB_PROMPTS file ${p} must be a JSON array of strings`);
  }
  return parsed as string[];
}

function csvEscape(s: any): string {
  const v = String(s ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function truthy(v: string | undefined): boolean {
  const s = (v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

async function embedSimilarity(a: string, b: string): Promise<number | null> {
  if (!a || !b) return null;
  try {
    const [ea, eb] = await Promise.all([
      generateEmbedding(a.slice(0, 6000)),
      generateEmbedding(b.slice(0, 6000)),
    ]);
    if (!ea || !eb) return null;
    return cosineSimilarity(ea, eb);
  } catch {
    return null;
  }
}

async function main() {
  const tenantId = Number(process.env.AB_TENANT_ID || "1");
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    console.error(`[fusion-ab] invalid AB_TENANT_ID=${process.env.AB_TENANT_ID}`);
    process.exit(1);
  }
  const poolEnv = (process.env.AB_POOL || "frontier").trim() as ProposerPool;
  const pool: ProposerPool =
    poolEnv === "frontier" || poolEnv === "cheap" || poolEnv === "mixed" ? poolEnv : "frontier";

  let prompts = process.env.AB_PROMPTS ? readPromptsFile(process.env.AB_PROMPTS) : DEFAULT_PROMPTS;
  const limit = Number(process.env.AB_LIMIT || "0");
  if (Number.isFinite(limit) && limit > 0) prompts = prompts.slice(0, limit);
  if (prompts.length === 0) {
    console.error("[fusion-ab] no prompts provided");
    process.exit(1);
  }

  const fusionModel = (process.env.FUSION_MODEL || "openrouter/fusion").trim();
  const spend = truthy(process.env.FUSION_AB_CONFIRM_SPEND);
  const outPath =
    process.env.AB_OUT ||
    path.join(process.cwd(), `fusion-ab-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);

  if (!process.env.OPENROUTER_API_KEY) {
    console.error("[fusion-ab] OPENROUTER_API_KEY is not set — required to wire/call Fusion.");
    process.exit(1);
  }

  console.log(
    `[fusion-ab] tenant=${tenantId} pool=${pool} prompts=${prompts.length} fusionModel=${fusionModel} mode=${spend ? "LIVE (will spend)" : "DRY (no Fusion spend)"}`,
  );

  // Prove the Fusion backend is wired — resolve the client (no API call). This
  // runs in both dry and live mode so a registration regression fails loudly.
  let fusionActualModelId = fusionModel;
  let fusionClient: any = null;
  try {
    const resolved = await getClientForModel(fusionModel, tenantId, { costExemptLane: true });
    fusionClient = resolved.client;
    fusionActualModelId = resolved.actualModelId;
    console.log(`[fusion-ab] wiring OK: ${fusionModel} → provider client, actualModelId=${fusionActualModelId}`);
    if (fusionActualModelId !== fusionModel) {
      console.warn(
        `[fusion-ab] WARNING: actualModelId (${fusionActualModelId}) != ${fusionModel} — Fusion may not be registered to the OpenRouter lane (check MODEL_REGISTRY).`,
      );
    }
  } catch (e) {
    console.error(`[fusion-ab] FUSION WIRING FAILED: ${(e as Error).message}`);
    process.exit(1);
  }

  type Row = {
    prompt_idx: number;
    prompt_preview: string;
    moa_pool: ProposerPool;
    moa_models: string;
    moa_latency_ms: number;
    moa_kappa: number | null;
    moa_escalate: boolean;
    moa_answer_len: number;
    fusion_latency_ms: number | string;
    fusion_answer_len: number | string;
    fusion_tokens_in: number | string;
    fusion_tokens_out: number | string;
    fusion_cost_usd: number | string;
    answer_similarity: number | string;
    fusion_error?: string;
  };
  const rows: Row[] = [];
  let fusionFails = 0;
  let fusionCalls = 0;
  let totalFusionCost = 0;

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];

    // ── Native MoA (free modelfarm lane unless ALLOW_METERED_LLM) ──
    let moaText = "";
    const row: Row = {
      prompt_idx: i,
      prompt_preview: prompt.slice(0, 80),
      moa_pool: pool,
      moa_models: "",
      moa_latency_ms: 0,
      moa_kappa: null,
      moa_escalate: false,
      moa_answer_len: 0,
      fusion_latency_ms: spend ? 0 : "skipped",
      fusion_answer_len: spend ? 0 : "skipped",
      fusion_tokens_in: spend ? 0 : "skipped",
      fusion_tokens_out: spend ? 0 : "skipped",
      fusion_cost_usd: spend ? 0 : "skipped",
      answer_similarity: "n/a",
    };
    try {
      const t0 = Date.now();
      // autoSecondOpinion:false — the harness measures the FREE MoA baseline; do
      // not let the R125+52.41 auto-Fusion hook spend on the MoA side here.
      const m = await executeMoA({ question: prompt, tenantId, pool, invokedVia: "fusion-ab", autoSecondOpinion: false });
      moaText = m.aggregated || "";
      row.moa_latency_ms = m.totalLatencyMs ?? Date.now() - t0;
      row.moa_kappa = m.concordance;
      row.moa_escalate = m.shouldEscalate;
      row.moa_answer_len = moaText.length;
      row.moa_models = m.proposers.map((p) => `${p.modelId}:${p.ok ? "ok" : "fail"}`).join(" | ");
      console.log(
        `[fusion-ab] #${i} MoA: κ=${m.concordance?.toFixed(3) ?? "n/a"} escalate=${m.shouldEscalate} ${row.moa_latency_ms}ms len=${moaText.length}`,
      );
    } catch (e) {
      row.moa_models = "(error)";
      console.warn(`[fusion-ab] #${i} MoA THREW: ${(e as Error).message?.slice(0, 200)}`);
    }

    // ── Fusion (LIVE only) ──
    if (spend && fusionClient) {
      fusionCalls++;
      const t1 = Date.now();
      try {
        const resp: any = await fusionClient.chat.completions.create({
          model: fusionActualModelId,
          messages: [{ role: "user", content: prompt }],
          // OpenRouter usage accounting → returns usage.cost (USD) for the
          // whole panel+judge+final pipeline. Cast: not in the OpenAI SDK type.
          usage: { include: true },
        } as any);
        const fusionText = resp?.choices?.[0]?.message?.content || "";
        const usage = resp?.usage || {};
        const tokensIn = Number(usage.prompt_tokens || usage.input_tokens || 0);
        const tokensOut = Number(usage.completion_tokens || usage.output_tokens || 0);
        const realCost = typeof usage.cost === "number" ? usage.cost : null;
        row.fusion_latency_ms = Date.now() - t1;
        row.fusion_answer_len = fusionText.length;
        row.fusion_tokens_in = tokensIn;
        row.fusion_tokens_out = tokensOut;
        row.fusion_cost_usd = realCost ?? "unknown";
        if (realCost != null) totalFusionCost += realCost;
        row.answer_similarity = (await embedSimilarity(moaText, fusionText)) ?? "n/a";
        // Persist the REAL spend to the ledger so it shows on dashboards. NOTE:
        // fusionClient (from getClientForModel) is already wrapped with the
        // auto cost-tracker, but that wrapper estimates via MODEL_COST_PER_1K —
        // which has NO entry for "openrouter/fusion", so it records ~$0 (tokens
        // only). This explicit row under toolName "fusion_ab" carries the
        // authoritative OpenRouter usage.cost; net ledger dollars stay correct
        // (auto ~$0 + this real cost), and the CSV/roll-up below is the source
        // of truth Bob reads for the comparison.
        await recordCost({
          tenantId,
          toolName: "fusion_ab",
          model: fusionActualModelId,
          costUsd: realCost ?? undefined,
          tokensIn,
          tokensOut,
          operation: "fusion_ab",
        });
        console.log(
          `[fusion-ab] #${i} Fusion: ${row.fusion_latency_ms}ms len=${fusionText.length} cost=${realCost != null ? `$${realCost.toFixed(4)}` : "unknown"} sim=${typeof row.answer_similarity === "number" ? row.answer_similarity.toFixed(3) : row.answer_similarity}`,
        );
      } catch (e) {
        fusionFails++;
        row.fusion_error = (e as Error).message?.slice(0, 240) || "unknown";
        row.fusion_latency_ms = Date.now() - t1;
        row.fusion_answer_len = 0;
        row.fusion_tokens_in = 0;
        row.fusion_tokens_out = 0;
        row.fusion_cost_usd = 0;
        console.warn(`[fusion-ab] #${i} Fusion THREW: ${row.fusion_error}`);
      }
    }
    rows.push(row);
  }

  // ── CSV ──
  const header = [
    "prompt_idx", "prompt_preview", "moa_pool", "moa_models", "moa_latency_ms",
    "moa_kappa", "moa_escalate", "moa_answer_len",
    "fusion_latency_ms", "fusion_answer_len", "fusion_tokens_in", "fusion_tokens_out",
    "fusion_cost_usd", "answer_similarity", "fusion_error",
  ];
  const csv = [header.join(",")];
  for (const r of rows) csv.push(header.map((h) => csvEscape((r as any)[h])).join(","));
  fs.writeFileSync(outPath, csv.join("\n") + "\n", "utf8");
  console.log(`[fusion-ab] wrote ${rows.length} rows → ${outPath}`);

  // ── Roll-up ──
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const moaLat = mean(rows.map((r) => r.moa_latency_ms).filter((n) => n > 0));
  const escRate = rows.filter((r) => r.moa_escalate).length / rows.length;
  console.log("\n[fusion-ab] roll-up:");
  console.log(`  prompts:           ${rows.length}`);
  console.log(`  MoA mean latency:  ${Number.isFinite(moaLat) ? moaLat.toFixed(0) : "n/a"}ms  (escalate rate ${(escRate * 100).toFixed(0)}%)`);
  if (spend) {
    const fLat = mean(rows.map((r) => Number(r.fusion_latency_ms)).filter((n) => Number.isFinite(n) && n > 0));
    const sims = rows.map((r) => Number(r.answer_similarity)).filter((n) => Number.isFinite(n));
    console.log(`  Fusion mean latency: ${Number.isFinite(fLat) ? fLat.toFixed(0) : "n/a"}ms  (fails ${fusionFails}/${fusionCalls})`);
    console.log(`  Fusion total cost:   $${totalFusionCost.toFixed(4)}  (~$${(totalFusionCost / Math.max(1, fusionCalls)).toFixed(4)}/prompt vs MoA ~$0 free-lane)`);
    console.log(`  MoA↔Fusion answer similarity (mean cosine): ${sims.length ? mean(sims).toFixed(3) : "n/a"}`);
  } else {
    console.log("  Fusion: SKIPPED (dry run). Re-run with FUSION_AB_CONFIRM_SPEND=1 to call Fusion and capture cost/quality.");
  }

  if (spend && fusionCalls > 0 && fusionFails >= fusionCalls / 2) {
    console.error(`[fusion-ab] FAIL: ${fusionFails}/${fusionCalls} Fusion calls failed.`);
    process.exit(2);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[fusion-ab] fatal:", err);
  process.exit(1);
});
