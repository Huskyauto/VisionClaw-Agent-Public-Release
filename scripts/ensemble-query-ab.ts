#!/usr/bin/env -S npx tsx
/**
 * R125+1 — OpenRouter ensemble_query A/B harness.
 *
 * Runs the same N prompts through 3 proposer pools (frontier / cheap / mixed)
 * and emits per-run metrics (latency, success count, κ-concordance, answer
 * length, aggregator model) + per-pool roll-up so we can decide whether to
 * flip the default away from `frontier`.
 *
 * One-line agent-runnable (no TTY, env-configured):
 *   AB_TENANT_ID=1 AB_REPEATS=1 npx tsx scripts/ensemble-query-ab.ts
 *
 * Optional env:
 *   AB_TENANT_ID  numeric tenant id to log under (default 1)
 *   AB_REPEATS    repetitions per (prompt × pool) pair (default 1)
 *   AB_PROMPTS    path to JSON file of prompts (string[]) (default: built-in)
 *   AB_POOLS      comma-separated subset of frontier,cheap,mixed (default all)
 *   AB_OUT        path to write CSV (default: ab-results-<ts>.csv)
 *
 * Exit codes:
 *   0  all runs completed (some individual proposers may have failed — see CSV)
 *   1  config / env / setup error
 *   2  >=50% of runs returned zero successful proposers (pool unusable)
 */

import * as fs from "fs";
import * as path from "path";
import { executeMoA, type ProposerPool } from "../server/moa";

const DEFAULT_PROMPTS: string[] = [
  "Compare CRDTs vs operational transformation for collaborative text editing — which is better for offline-first and why?",
  "Why does adding a database index sometimes make a query slower?",
  "Explain the difference between optimistic and pessimistic concurrency control. Give one concrete example where each is the wrong choice.",
  "I'm storing user-uploaded images for a SaaS. Compare S3 + signed URLs vs a CDN with origin pull vs a dedicated image service. Trade-offs?",
  "What's the most common reason a Kubernetes pod stays in CrashLoopBackOff, and how do you debug it without enabling debug logs?",
  "Brainstorm 5 different ways to detect prompt-injection attacks in an LLM-powered API, ranked by false-positive rate.",
  "Explain why TCP's retransmission timeout is computed from RTT variance, not just mean RTT.",
  "I have a 50GB Postgres table and need to add a NOT NULL column with a default. How do I do this with zero downtime?",
  "What are the failure modes of using vector embeddings for semantic search at scale, and how would you mitigate each?",
  "Compare event sourcing vs CDC (change data capture) for syncing a read model — which is better for compliance audit trails and why?",
];

function readPromptsFile(p: string): string[] {
  const raw = fs.readFileSync(p, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(s => typeof s === "string")) {
    throw new Error(`AB_PROMPTS file ${p} must be a JSON array of strings`);
  }
  return parsed as string[];
}

function csvEscape(s: any): string {
  const v = String(s ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function main() {
  const tenantId = Number(process.env.AB_TENANT_ID || "1");
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    console.error(`[ab] invalid AB_TENANT_ID=${process.env.AB_TENANT_ID}`);
    process.exit(1);
  }
  const repeats = Math.max(1, Number(process.env.AB_REPEATS || "1"));
  const promptsPath = process.env.AB_PROMPTS;
  const prompts = promptsPath ? readPromptsFile(promptsPath) : DEFAULT_PROMPTS;
  if (prompts.length === 0) {
    console.error("[ab] no prompts provided");
    process.exit(1);
  }
  const poolsEnv = (process.env.AB_POOLS || "frontier,cheap,mixed")
    .split(",").map(s => s.trim()).filter(Boolean) as ProposerPool[];
  const pools: ProposerPool[] = poolsEnv.filter(p => p === "frontier" || p === "cheap" || p === "mixed");
  if (pools.length === 0) {
    console.error(`[ab] AB_POOLS invalid: ${process.env.AB_POOLS}`);
    process.exit(1);
  }
  const outPath = process.env.AB_OUT || path.join(process.cwd(), `ab-results-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);

  console.log(`[ab] tenant=${tenantId} pools=[${pools.join(",")}] prompts=${prompts.length} repeats=${repeats} (total runs=${pools.length * prompts.length * repeats})`);
  console.log(`[ab] OPENROUTER_API_KEY present: ${process.env.OPENROUTER_API_KEY ? "yes" : "NO — cheap+mixed pools will fail"}`);

  type Row = {
    pool: ProposerPool; prompt_idx: number; repeat: number;
    proposers_attempted: number; proposers_ok: number;
    aggregator: string; total_ms: number;
    concordance: number | null; should_escalate: boolean;
    answer_len: number; response_id: number | string;
    proposer_summary: string;
    error?: string;
  };
  const rows: Row[] = [];

  let runNum = 0;
  const totalRuns = pools.length * prompts.length * repeats;
  for (let pi = 0; pi < prompts.length; pi++) {
    for (const pool of pools) {
      for (let rep = 0; rep < repeats; rep++) {
        runNum++;
        const prompt = prompts[pi];
        const t0 = Date.now();
        try {
          const r = await executeMoA({
            question: prompt,
            tenantId,
            pool,
            invokedVia: "ab-harness",
          });
          const proposerSummary = r.proposers.map(p =>
            `${p.modelId}:${p.ok ? "OK" : "FAIL"}:${p.latencyMs}ms${p.error ? `(${p.error.slice(0, 60).replace(/\s+/g, " ")})` : ""}`
          ).join(" | ");
          rows.push({
            pool,
            prompt_idx: pi,
            repeat: rep,
            proposers_attempted: r.proposers.length,
            proposers_ok: r.proposers.filter(p => p.ok).length,
            aggregator: r.aggregatorModel,
            total_ms: r.totalLatencyMs,
            concordance: r.concordance,
            should_escalate: r.shouldEscalate,
            answer_len: r.aggregated.length,
            response_id: r.responseId ?? "",
            proposer_summary: proposerSummary,
          });
          console.log(`[ab] ${runNum}/${totalRuns} pool=${pool} prompt#${pi} ok=${rows[rows.length - 1].proposers_ok}/${rows[rows.length - 1].proposers_attempted} κ=${r.concordance?.toFixed(3) ?? "n/a"} ${r.totalLatencyMs}ms`);
        } catch (err) {
          const errMsg = (err as Error).message?.slice(0, 240) || "unknown";
          rows.push({
            pool, prompt_idx: pi, repeat: rep,
            proposers_attempted: 0, proposers_ok: 0,
            aggregator: "(error)", total_ms: Date.now() - t0,
            concordance: null, should_escalate: true,
            answer_len: 0, response_id: "",
            proposer_summary: "", error: errMsg,
          });
          console.warn(`[ab] ${runNum}/${totalRuns} pool=${pool} prompt#${pi} THREW: ${errMsg}`);
        }
      }
    }
  }

  // Emit CSV.
  const header = [
    "pool", "prompt_idx", "repeat",
    "proposers_attempted", "proposers_ok",
    "aggregator", "total_ms",
    "concordance", "should_escalate",
    "answer_len", "response_id", "proposer_summary", "error",
  ];
  const csv = [header.join(",")];
  for (const r of rows) {
    csv.push(header.map(h => csvEscape((r as any)[h])).join(","));
  }
  fs.writeFileSync(outPath, csv.join("\n") + "\n", "utf8");
  console.log(`[ab] wrote ${rows.length} rows → ${outPath}`);

  // Per-pool roll-up.
  console.log("\n[ab] per-pool roll-up (means; κ excludes nulls):");
  console.log("pool\truns\tok_rate\tκ_mean\tlatency_ms\tans_len\tescalate_rate");
  for (const pool of pools) {
    const r = rows.filter(x => x.pool === pool);
    if (r.length === 0) continue;
    const okRate = r.reduce((s, x) => s + (x.proposers_attempted > 0 ? x.proposers_ok / x.proposers_attempted : 0), 0) / r.length;
    const kValues = r.map(x => x.concordance).filter((k): k is number => typeof k === "number");
    const kMean = kValues.length > 0 ? kValues.reduce((s, k) => s + k, 0) / kValues.length : NaN;
    const latMean = r.reduce((s, x) => s + x.total_ms, 0) / r.length;
    const lenMean = r.reduce((s, x) => s + x.answer_len, 0) / r.length;
    const escRate = r.filter(x => x.should_escalate).length / r.length;
    console.log(`${pool}\t${r.length}\t${(okRate * 100).toFixed(1)}%\t${Number.isFinite(kMean) ? kMean.toFixed(3) : "n/a"}\t${latMean.toFixed(0)}\t${lenMean.toFixed(0)}\t${(escRate * 100).toFixed(1)}%`);
  }

  // Exit-code gate.
  const zeroOk = rows.filter(x => x.proposers_ok === 0).length;
  if (zeroOk >= rows.length / 2) {
    console.error(`[ab] FAIL: ${zeroOk}/${rows.length} runs had zero successful proposers — at least one pool is unusable`);
    process.exit(2);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("[ab] fatal:", err);
  process.exit(1);
});
