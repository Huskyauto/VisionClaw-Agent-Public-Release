// ─────────────────────────────────────────────────────────────────────────────
// Venture Discovery Loop — orchestrator / stage state machine (2026-06-17).
//
// SAFETY RAILS (Bob's choice: "dry-run-only, owner-only, hard-capped, HITL"):
//   • DRY-RUN DEFAULT — every stage produces deterministic structured output at
//     $0 spend unless the run is explicitly created with dryRun:false.
//   • OWNER-ONLY — enforced at the route layer + the cost cap resolves to 0 for
//     non-owner tenants, so no live spend can ever occur off the owner.
//   • HARD-CAPPED — the only spending stage (live Discovery) reserves against the
//     daily cap BEFORE calling the engine and settles in place (budget.ts).
//   • HITL — a run advances exactly ONE stage per explicit owner approval
//     (approveNextStage); it never auto-runs to completion.
//
// This slice (S1) wires the Discovery stage to the real ideation engine (live)
// and a deterministic Scoring rubric; stages 3–9 emit deterministic structured
// templates (coherent rows so the loop runs end-to-end). Live persona wiring for
// those is plan.md S2.
// ─────────────────────────────────────────────────────────────────────────────

import { runIdeationSession } from "../ideation-engine";
import * as repo from "./repo";
import {
  reserveVentureBudget,
  settleVentureReservation,
  releaseVentureReservation,
  VENTURE_STAGE_ESTIMATE_USD,
} from "./budget";
import { estimateCostUsd } from "../agentic/cost-ledger";
import { ownerTenantId } from "../agentic/autonomous-budget";
import type { VentureDiscoveryRun, VentureIdea, InsertSyntheticCustomer } from "@shared/schema";

// Self-contained owner-only invariant for the SPENDING path. The route + tool
// entrypoints already gate the whole tool owner-only, and budget.ts resolves a
// non-owner cap to 0; this module-boundary assert closes the defense-in-depth
// gap (architect 2026-06-17) so even a FUTURE direct caller can never start or
// advance a LIVE ($-spending) run off a non-owner tenant. Dry-run stays tenant-
// generic by design ("dry-run works for all" — budget.ts header).
function assertOwnerForLiveRun(tenantId: number): void {
  if (tenantId !== ownerTenantId()) {
    throw new Error("venture_discovery live runs are owner-only");
  }
}

export const STAGES = [
  "discovery",
  "scoring",
  "synthetic_customers",
  "market_validation",
  "mvp_feasibility",
  "financial_model",
  "legal_risk",
  "decision_gate",
  "deliverables",
] as const;
export type Stage = (typeof STAGES)[number];

export function nextStage(stage: string): Stage | null {
  const i = STAGES.indexOf(stage as Stage);
  if (i < 0 || i >= STAGES.length - 1) return null;
  return STAGES[i + 1];
}

export interface StartRunArgs {
  tenantId: number;
  objective: string;
  dryRun?: boolean;
  createdBy?: string;
}

export async function startRun(args: StartRunArgs): Promise<VentureDiscoveryRun> {
  const dryRun = args.dryRun !== false; // default true
  if (!dryRun) assertOwnerForLiveRun(args.tenantId);
  return repo.createRun({
    tenantId: args.tenantId,
    objective: args.objective.trim(),
    status: "awaiting_approval",
    currentStage: STAGES[0],
    dryRun, // default true
    completedStages: [],
    createdBy: args.createdBy ?? null,
    lastError: null,
  } as any);
}

export interface ApproveResult {
  ok: boolean;
  run?: VentureDiscoveryRun;
  executedStage?: Stage;
  error?: string;
}

/**
 * HITL gate: execute the current stage, then advance one step. Never auto-runs
 * to completion — each call advances exactly one stage.
 */
export async function approveNextStage(tenantId: number, runId: number): Promise<ApproveResult> {
  const run = await repo.getRun(tenantId, runId);
  if (!run) return { ok: false, error: "run_not_found" };
  if (["completed", "killed", "failed"].includes(run.status)) {
    return { ok: false, error: `run_${run.status}`, run };
  }
  const stage = run.currentStage as Stage;
  if (run.dryRun === false) assertOwnerForLiveRun(tenantId);

  // Atomic CAS claim: transition to `running` ONLY if the row is still at the
  // exact (status, stage) we just read. Two concurrent approve calls racing the
  // same run can't both pass this — the loser gets undefined and bails, so a
  // stage is never executed twice (which would double-reserve budget + duplicate
  // ideas/scores rows).
  const claimed = await repo.claimRunForStage(tenantId, runId, run.status, stage);
  if (!claimed) {
    return { ok: false, error: "stage_conflict", run: await repo.getRun(tenantId, runId), executedStage: stage };
  }
  try {
    const outcome = await executeStage(run, stage);
    if (outcome === "budget_exceeded") {
      const updated = await repo.updateRun(tenantId, runId, {
        status: "budget_exceeded",
        lastError: "daily venture-discovery budget would be exceeded",
      });
      return { ok: false, error: "budget_exceeded", run: updated, executedStage: stage };
    }
  } catch (err) {
    const updated = await repo.updateRun(tenantId, runId, {
      status: "failed",
      lastError: (err as Error)?.message?.slice(0, 500) || "stage failed",
    });
    return { ok: false, error: "stage_failed", run: updated, executedStage: stage };
  }

  const completed = Array.isArray(run.completedStages) ? [...(run.completedStages as string[])] : [];
  if (!completed.includes(stage)) completed.push(stage);
  const next = nextStage(stage);
  const updated = await repo.updateRun(tenantId, runId, {
    status: next ? "awaiting_approval" : "completed",
    currentStage: next ?? stage,
    completedStages: completed,
    lastError: null,
  });
  return { ok: true, run: updated, executedStage: stage };
}

type StageOutcome = "done" | "budget_exceeded";

async function executeStage(run: VentureDiscoveryRun, stage: Stage): Promise<StageOutcome> {
  switch (stage) {
    case "discovery":
      return executeDiscovery(run);
    case "scoring":
      return executeScoring(run);
    case "synthetic_customers":
      return executeSyntheticCustomers(run);
    case "market_validation":
      return executeMarketValidation(run);
    case "mvp_feasibility":
      return executeMvpFeasibility(run);
    case "financial_model":
      return executeFinancialModel(run);
    case "legal_risk":
      return executeLegalRisk(run);
    case "decision_gate":
      return executeDecisionGate(run);
    case "deliverables":
      return executeDeliverables(run);
    default:
      return "done";
  }
}

// ── Stage 1: Opportunity Discovery ───────────────────────────────────────────
async function executeDiscovery(run: VentureDiscoveryRun): Promise<StageOutcome> {
  let ideaTexts: { title: string; targetCustomer?: string; problem?: string; solution?: string; revenueModel?: string }[] = [];

  if (!run.dryRun) {
    // LIVE: reserve budget BEFORE the paid ideation call, then settle that same
    // row in place to the REAL completion cost (not the static estimate) so
    // budget.ts's dynamic reserve-floor adapts to true drift and can never
    // under-reserve a later call. The ideation client ALSO records its own
    // provider-attributed ledger row; under the $0 modelfarm policy that row is
    // ~$0, so this venture_discovery row is the authoritative spend for the cap.
    // (Cosmetic only: if metered LLM is ever enabled, the same spend appears in
    // both the provider row and this venture row — the cap math, which sums only
    // venture_discovery% rows, is unaffected.)
    const reservation = await reserveVentureBudget(run.tenantId, VENTURE_STAGE_ESTIMATE_USD, "discovery");
    if (!reservation.ok) return "budget_exceeded";
    let realCostUsd = VENTURE_STAGE_ESTIMATE_USD;
    let tokensIn = 0;
    let tokensOut = 0;
    try {
      const result = await runIdeationSession({ idea: run.objective, phase: "full", tenantId: run.tenantId });
      if (result.usage) {
        tokensIn = result.usage.tokensIn;
        tokensOut = result.usage.tokensOut;
        // Prefer the provider-reported real cost (e.g. OpenRouter usage.cost);
        // fall back to the token-rate estimate only when it is absent. The
        // estimate has a deepseek pricing entry in cost-ledger so it is never $0
        // for non-zero token usage — the dynamic reserve floor needs real drift.
        realCostUsd = typeof result.usage.costUsd === "number" && result.usage.costUsd > 0
          ? result.usage.costUsd
          : estimateCostUsd(result.usage.model, tokensIn, tokensOut);
      }
      const flat = result.variations.flatMap((v) => v.ideas).filter(Boolean).slice(0, 10);
      ideaTexts = flat.map((t) => ({
        title: t.slice(0, 160),
        problem: result.onePager?.problemStatement,
        solution: result.onePager?.recommendedDirection,
        revenueModel: result.onePager?.mvpScope,
      }));
      // A completion came back ⇒ real spend occurred ⇒ settle the reservation in
      // place to the real cost (the estimate only stands in if usage was absent —
      // we still paid for the completion).
      await settleVentureReservation(reservation.reservationId, realCostUsd, tokensIn, tokensOut, "venture_discovery:discovery");
    } catch (err) {
      // The paid call threw before any completion ⇒ no billable spend ⇒ RELEASE
      // the reservation (cost → 0) so a transient failure can't burn a full
      // stage's daily cap for $0 of real spend. Re-throw so approveNextStage
      // marks the run failed.
      await releaseVentureReservation(reservation.reservationId);
      throw err;
    }
  }

  if (ideaTexts.length === 0) {
    // DRY-RUN (or live with empty result): deterministic structured ideas, $0.
    ideaTexts = deterministicIdeas(run.objective);
  }

  await repo.addIdeas(
    ideaTexts.map((it, i) => ({
      tenantId: run.tenantId,
      runId: run.id,
      idx: i,
      title: it.title,
      targetCustomer: it.targetCustomer ?? null,
      problem: it.problem ?? null,
      solution: it.solution ?? null,
      revenueModel: it.revenueModel ?? null,
    })) as any,
  );
  return "done";
}

function deterministicIdeas(objective: string) {
  const angles = [
    { tag: "self-serve SaaS", model: "monthly subscription" },
    { tag: "done-for-you service", model: "fixed-fee engagement" },
    { tag: "marketplace", model: "transaction take-rate" },
    { tag: "productized template/pack", model: "one-time digital purchase" },
    { tag: "API / embeddable widget", model: "usage-based metering" },
  ];
  return angles.map((a) => ({
    title: `${objective} — ${a.tag}`,
    targetCustomer: "SMB owner / operator in the target niche",
    problem: `Acute, recurring pain related to "${objective}" that current tools handle poorly.`,
    solution: `A ${a.tag} that delivers the outcome with minimal setup.`,
    revenueModel: a.model,
  }));
}

// ── Stage 2: Idea Scoring (deterministic rubric, $0) ─────────────────────────
async function executeScoring(run: VentureDiscoveryRun): Promise<StageOutcome> {
  const results = await repo.getRunResults(run.tenantId, run.id);
  const ideas = (results?.ideas ?? []) as VentureIdea[];
  const rows = ideas.map((idea) => {
    const scores = scoreIdea(idea);
    const total = Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length;
    return { idea, scores, total: Math.round(total * 100) / 100 };
  });
  rows.sort((a, b) => b.total - a.total);
  await repo.addScores(
    rows.map((r, rank) => ({
      tenantId: run.tenantId,
      runId: run.id,
      ideaId: r.idea.id,
      scores: r.scores,
      total: r.total,
      rank: rank + 1,
      recommendation: r.total >= 7 ? "build" : r.total >= 5 ? "test" : r.total >= 3 ? "revise" : "kill",
    })) as any,
  );
  return "done";
}

function scoreIdea(idea: VentureIdea): Record<string, number> {
  // Deterministic heuristic rubric (1–10). Replaced by persona scoring in S2.
  const txt = `${idea.title} ${idea.problem ?? ""} ${idea.solution ?? ""} ${idea.revenueModel ?? ""}`.toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => txt.includes(k)) ? 8 : 5;
  return {
    painSeverity: has("pain", "acute", "recurring"),
    willingnessToPay: has("subscription", "fee", "purchase", "metering"),
    marketSize: has("smb", "marketplace", "api"),
    easeOfMvp: has("template", "widget", "self-serve") + 1,
    competition: 6,
    speedToRevenue: has("one-time", "fixed-fee", "self-serve"),
    grossMargin: has("saas", "subscription", "digital", "api"),
    founderFit: 7,
    risk: 6,
  };
}

// ── Stages 3–9: deterministic structured templates ($0) for the top ideas ────
async function topIdeaIds(run: VentureDiscoveryRun, n: number): Promise<VentureIdea[]> {
  const results = await repo.getRunResults(run.tenantId, run.id);
  const scores = results?.scores ?? [];
  const ideas = (results?.ideas ?? []) as VentureIdea[];
  if (scores.length) {
    const ranked = [...scores].sort((a: any, b: any) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, n);
    const byId = new Map(ideas.map((i) => [i.id, i]));
    return ranked.map((s: any) => byId.get(s.ideaId)).filter(Boolean) as VentureIdea[];
  }
  return ideas.slice(0, n);
}

// ── Stage 3: Synthetic Customers ─────────────────────────────────────────────
// The one net-new primitive of the loop (Bob's thin-MVP slice, 2026-06-17):
// deep-interview.ts extracts requirements from the REAL user; this stage does the
// opposite — it fabricates a DIVERSE panel of "ghost" customers (pain points,
// current workaround, buying trigger, objections, budget, decision criteria +
// a per-persona demandConfidence 0–100) for the top-scored ideas.
//   • DRY-RUN (default): deterministic templated panel, $0.
//   • LIVE (owner, dryRun:false): reserve budget BEFORE the paid call, LLM-
//     generate the panel, settle that same row in place to the REAL cost
//     (mirrors executeDiscovery). Falls back to the deterministic panel on any
//     LLM/parse failure so the loop never stalls (the reservation still settles).
async function executeSyntheticCustomers(run: VentureDiscoveryRun): Promise<StageOutcome> {
  const ideas = await topIdeaIds(run, 3);
  if (ideas.length === 0) return "done";

  let rows: InsertSyntheticCustomer[] = [];

  if (!run.dryRun) {
    const reservation = await reserveVentureBudget(run.tenantId, VENTURE_STAGE_ESTIMATE_USD, "synthetic_customers");
    if (!reservation.ok) return "budget_exceeded";
    const llm = await llmSyntheticCustomers(run, ideas);
    if (llm) {
      // A completion came back (rows may still be empty if the JSON was unusable)
      // ⇒ real spend occurred ⇒ settle to the real cost.
      const tokensIn = llm.tokensIn;
      const tokensOut = llm.tokensOut;
      const realCostUsd = llm.costUsd > 0 ? llm.costUsd : estimateCostUsd(llm.model, tokensIn, tokensOut);
      await settleVentureReservation(reservation.reservationId, realCostUsd, tokensIn, tokensOut, "venture_discovery:synthetic_customers");
      if (llm.rows.length) rows = llm.rows;
    } else {
      // No completion (the paid call threw before responding) ⇒ no billable spend
      // ⇒ RELEASE so a transient failure + deterministic fallback can't burn the
      // daily cap for $0 of real spend.
      await releaseVentureReservation(reservation.reservationId);
    }
  }

  if (rows.length === 0) {
    // DRY-RUN (or live with empty/failed result): deterministic panel, $0.
    rows = deterministicCustomers(run, ideas);
  }

  await repo.addSyntheticCustomers(rows as any);
  return "done";
}

function deterministicCustomers(run: VentureDiscoveryRun, ideas: VentureIdea[]): InsertSyntheticCustomer[] {
  const rows: InsertSyntheticCustomer[] = [];
  for (const idea of ideas) {
    for (let i = 0; i < 3; i++) {
      rows.push({
        tenantId: run.tenantId,
        runId: run.id,
        ideaId: idea.id,
        name: `Persona ${i + 1} for "${idea.title.slice(0, 40)}"`,
        role: ["Founder/Owner", "Operations Lead", "Marketing Lead"][i],
        industry: idea.targetCustomer ?? "SMB",
        businessSize: ["1–5 employees", "6–25 employees", "26–100 employees"][i],
        profile: {
          painPoints: [idea.problem ?? "Recurring operational pain"],
          currentWorkaround: "Manual spreadsheets / disconnected tools",
          buyingTrigger: "A visible failure or a deadline that the workaround can't meet",
          objections: ["Switching cost", "Trust / data security", "Price vs. current free option"],
          budgetRange: ["$0–50/mo", "$50–250/mo", "$250–1k/mo"][i],
          decisionCriteria: ["Time saved", "Ease of setup", "ROI clarity"],
          demandConfidence: 50,
        },
      } as InsertSyntheticCustomer);
    }
  }
  return rows;
}

interface LlmCustomersResult {
  rows: InsertSyntheticCustomer[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string;
}

// LIVE-only: one LLM call generates a diverse 3-persona panel per top idea.
// Returns null ONLY when the paid call throws before any completion (no billable
// spend ⇒ caller RELEASES the reservation). When a completion DID come back but
// its JSON is unusable, returns a result with empty `rows` + the real usage so
// the caller settles the true cost (the spend happened) and falls back to the
// deterministic panel.
async function llmSyntheticCustomers(
  run: VentureDiscoveryRun,
  ideas: VentureIdea[],
): Promise<LlmCustomersResult | null> {
  // Mirror the proven ideation-engine call (server/ideation-engine.ts): the same
  // openrouter model, max_completion_tokens (NOT max_tokens — newer models reject
  // it), a temperature, and NO response_format (extract the JSON object by regex
  // from the content). Raw-client callsites are NOT param-adapted, so matching the
  // working path verbatim avoids a silent 400 → null → deterministic fallback.
  const MODEL = "deepseek/deepseek-v3.2";
  try {
    const { getClientForModel } = await import("../providers");
    // Use the RETURNED actualModelId as the model param: the $0 policy may swap
    // the client to the free modelfarm lane, and sending the original openrouter
    // id to that endpoint 400s ("model not supported"). See memory: modelfarm-
    // zero-cost-routing / model-lookup-fail-open-default.
    const { client, actualModelId } = await getClientForModel(MODEL, run.tenantId, {});

    const ideaBlock = ideas
      .map((idea, i) => `Idea ${i} — "${idea.title}"\n  target: ${idea.targetCustomer ?? "(unspecified)"}\n  problem: ${idea.problem ?? "(unspecified)"}\n  solution: ${idea.solution ?? "(unspecified)"}\n  revenueModel: ${idea.revenueModel ?? "(unspecified)"}`)
      .join("\n\n");

    const c = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        {
          role: "system",
          content:
            "You are a B2B market-research simulator. For each business idea you fabricate a DIVERSE panel of 3 realistic synthetic prospects (ghost customers). Make them differ in industry, company size, role/seniority, and skepticism — include at least one near-certain 'no'. Objections must be the REAL reasons a busy buyer hesitates (price, switching cost, trust, 'I already use X', not-a-priority), never strawmen. demandConfidence is 0–100 = your honest estimate of THAT persona's genuine willingness to pay; be a skeptic (most land 30–65; reserve 75+ for an obvious, urgent, budgeted pain). Respond with ONLY a single valid JSON object, no prose.",
        },
        {
          role: "user",
          content: `Overall objective: ${run.objective}\n\n${ideaBlock}\n\nReturn JSON of EXACTLY this shape:\n{\n  "panels": [\n    { "ideaIndex": 0, "personas": [\n      { "name": "string", "role": "string", "industry": "string", "businessSize": "string", "painPoints": ["string"], "currentWorkaround": "string", "buyingTrigger": "string", "objections": ["string"], "budgetRange": "string", "decisionCriteria": ["string"], "demandConfidence": 0 }\n    ] }\n  ]\n}\nEvery idea index ${ideas.map((_, i) => i).join(", ")} must appear with exactly 3 personas.`,
        },
      ],
      max_completion_tokens: 4096,
      temperature: 0.8,
    });

    // A completion came back ⇒ spend occurred. Capture usage NOW so every
    // post-completion bail (no JSON / parse error / empty panel) still settles
    // the real cost rather than masquerading as a no-spend null.
    const usage = {
      tokensIn: c.usage?.prompt_tokens ?? 0,
      tokensOut: c.usage?.completion_tokens ?? 0,
      costUsd: typeof (c as any).usage?.cost === "number" ? (c as any).usage.cost : 0,
      model: actualModelId,
    };

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { rows: [], ...usage };
    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return { rows: [], ...usage };
    }
    const panels = Array.isArray(parsed?.panels) ? parsed.panels : [];
    if (panels.length === 0) return { rows: [], ...usage };

    const asStrings = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x)).filter((s) => s.trim().length > 0) : [];
    const clampConf = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50;
    };

    const rows: InsertSyntheticCustomer[] = [];
    for (const panel of panels) {
      const idx = Number(panel?.ideaIndex);
      const idea = Number.isInteger(idx) ? ideas[idx] : undefined;
      if (!idea) continue;
      const personas = Array.isArray(panel?.personas) ? panel.personas.slice(0, 3) : [];
      for (const p of personas) {
        rows.push({
          tenantId: run.tenantId,
          runId: run.id,
          ideaId: idea.id,
          name: String(p?.name || "Unnamed Prospect").slice(0, 200),
          role: String(p?.role || "Unknown").slice(0, 200),
          industry: String(p?.industry || idea.targetCustomer || "SMB").slice(0, 200),
          businessSize: String(p?.businessSize || p?.business_size || "Unknown").slice(0, 200),
          profile: {
            painPoints: asStrings(p?.painPoints ?? p?.pain_points),
            currentWorkaround: String(p?.currentWorkaround || p?.current_workaround || ""),
            buyingTrigger: String(p?.buyingTrigger || p?.buying_trigger || ""),
            objections: asStrings(p?.objections),
            budgetRange: String(p?.budgetRange || p?.budget_range || ""),
            decisionCriteria: asStrings(p?.decisionCriteria ?? p?.decision_criteria),
            demandConfidence: clampConf(p?.demandConfidence ?? p?.demand_confidence),
          },
        } as InsertSyntheticCustomer);
      }
    }
    // rows may be empty (every panel idea index was invalid) — still a completion,
    // so return usage (caller settles real cost + falls back to deterministic).
    return { rows, ...usage };
  } catch (err) {
    console.error(`[venture:synthetic] LLM failed: ${(err as Error)?.message}`);
    return null;
  }
}

async function executeMarketValidation(run: VentureDiscoveryRun): Promise<StageOutcome> {
  const ideas = await topIdeaIds(run, 3);
  await repo.addValidationRuns(
    ideas.map((idea) => ({
      tenantId: run.tenantId,
      runId: run.id,
      ideaId: idea.id,
      icpProfile: `SMB operators experiencing: ${idea.problem ?? "the target pain"}`,
      offerStatement: `We help ${idea.targetCustomer ?? "SMBs"} achieve the outcome via ${idea.solution ?? "our solution"}.`,
      landingHeadline: `Stop wrestling with ${idea.title.slice(0, 50)} — get the outcome in days, not months.`,
      coldOutreach: `Quick question — how are you currently handling ${idea.problem ?? "this"}? We built something that removes the manual work.`,
      surveyQuestions: [
        "How do you handle this today?",
        "How much time/money does it cost you per month?",
        "What have you tried that didn't work?",
        "What would an ideal solution do?",
        "What would you pay for that?",
      ],
      discoveryCallScript: "Open → confirm pain → quantify cost → present outcome → handle objection → propose next step.",
      recommendedChannel: "Targeted cold email + niche community engagement",
    })) as any,
  );
  return "done";
}

async function executeMvpFeasibility(run: VentureDiscoveryRun): Promise<StageOutcome> {
  const ideas = await topIdeaIds(run, 3);
  await repo.addMvpBriefs(
    ideas.map((idea) => ({
      tenantId: run.tenantId,
      runId: run.id,
      ideaId: idea.id,
      scope: `Minimal version of "${idea.title.slice(0, 60)}" that delivers the core outcome only.`,
      integrations: ["Auth", "Payments (Stripe)", "Email"],
      components: ["Landing + capture", "Core workflow screen", "Admin/results view"],
      difficulty: "moderate",
      fastestPath: "Reuse existing VisionClaw stack (React + Express + Drizzle); ship a single-flow MVP.",
      risks: ["Scope creep", "Demand uncertainty until validated", "Fulfillment capacity"],
    })) as any,
  );
  return "done";
}

async function executeFinancialModel(run: VentureDiscoveryRun): Promise<StageOutcome> {
  const ideas = await topIdeaIds(run, 3);
  await repo.addFinancialModels(
    ideas.map((idea) => ({
      tenantId: run.tenantId,
      runId: run.id,
      ideaId: idea.id,
      pricingOptions: [
        { tier: "Starter", priceUsd: 29 },
        { tier: "Pro", priceUsd: 99 },
        { tier: "Done-for-you", priceUsd: 497 },
      ],
      startupCostUsd: 0,
      monthlyOpexUsd: 50,
      revenueScenarios: [
        { name: "conservative", customers: 10, mrrUsd: 290 },
        { name: "base", customers: 50, mrrUsd: 2450 },
        { name: "optimistic", customers: 150, mrrUsd: 8850 },
      ],
      breakEvenNote: "Break-even at ~2 paying customers given near-zero fixed cost on existing infra.",
      cashPlan90d: "Month 1: validate + first sales. Month 2: deliver + iterate. Month 3: scale the winning channel.",
    })) as any,
  );
  return "done";
}

async function executeLegalRisk(run: VentureDiscoveryRun): Promise<StageOutcome> {
  const ideas = await topIdeaIds(run, 3);
  await repo.addLegalRiskReviews(
    ideas.map((idea) => ({
      tenantId: run.tenantId,
      runId: run.id,
      ideaId: idea.id,
      complianceRisk: "Low–moderate; depends on data handled.",
      privacyRisk: "Collect only what's needed; publish a privacy policy; honor deletion requests.",
      ipRisk: "Use original branding; verify no trademark conflict before launch.",
      disclaimers: ["No guaranteed-results claims", "Service-as-is terms", "Clear refund policy"],
      regulatedConcerns: "Avoid regulated verticals (health/finance advice) unless properly licensed.",
      goNoGo: "conditional",
    })) as any,
  );
  return "done";
}

async function executeDecisionGate(run: VentureDiscoveryRun): Promise<StageOutcome> {
  const results = await repo.getRunResults(run.tenantId, run.id);
  const topScore = [...(results?.scores ?? [])].sort((a: any, b: any) => (a.rank ?? 99) - (b.rank ?? 99))[0];
  const ideas = (results?.ideas ?? []) as VentureIdea[];
  const topIdea = ideas.find((i) => i.id === topScore?.ideaId) ?? ideas[0];

  // Quality gate (GPT-5.5 spec): BUILD only if all upstream stages produced output.
  const gatesPassed =
    (results?.syntheticCustomers?.length ?? 0) >= 3 &&
    (results?.financialModels?.length ?? 0) >= 1 &&
    (results?.legalRiskReviews?.length ?? 0) >= 1 &&
    (results?.mvpBriefs?.length ?? 0) >= 1;

  const rec = topScore?.recommendation ?? "test";
  const decision = gatesPassed ? (rec === "build" ? "build" : rec) : "test";

  await repo.addVentureDecision({
    tenantId: run.tenantId,
    runId: run.id,
    ideaId: topIdea?.id ?? null,
    decision,
    executiveSummary: `Top idea: "${topIdea?.title ?? "n/a"}" (score ${topScore?.total ?? "n/a"}). Quality gates ${gatesPassed ? "PASSED" : "INCOMPLETE"} → decision: ${decision.toUpperCase()}.`,
    actionPlan7d: [
      "Day 1–2: finalize offer + landing",
      "Day 3–5: run validation outreach to 20 prospects",
      "Day 6–7: review signal, decide build vs. iterate",
    ],
    assignedAgents: ["Apollo (outreach)", "Forge (MVP)", "Cassandra (pricing)", "Scribe (assets)", "Proof (QA)"],
    requiredDeliverables: ["Landing page", "Outreach sequence", "MVP scope doc", "Pricing sheet"],
  } as any);
  return "done";
}

async function executeDeliverables(run: VentureDiscoveryRun): Promise<StageOutcome> {
  const results = await repo.getRunResults(run.tenantId, run.id);
  const md = renderMarkdown(results);
  await repo.addArtifact({
    tenantId: run.tenantId,
    runId: run.id,
    ideaId: null,
    kind: "markdown",
    title: `Venture Discovery Report — run ${run.id}`,
    content: md,
  } as any);
  await repo.addArtifact({
    tenantId: run.tenantId,
    runId: run.id,
    ideaId: null,
    kind: "json",
    title: `Venture Discovery Results — run ${run.id}`,
    content: JSON.stringify(results, null, 2),
  } as any);
  return "done";
}

export function renderMarkdown(results: any): string {
  if (!results) return "# Venture Discovery Report\n\n(no data)";
  const { run, ideas, scores, decisions } = results;
  const topDecision = decisions?.[0];
  const lines: string[] = [];
  lines.push(`# Venture Discovery Report — run ${run.id}`);
  lines.push("");
  lines.push(`**Objective:** ${run.objective}`);
  lines.push(`**Mode:** ${run.dryRun ? "dry-run (no spend)" : "live"}`);
  lines.push(`**Status:** ${run.status}`);
  lines.push("");
  if (topDecision) {
    lines.push(`## Decision: ${String(topDecision.decision || "").toUpperCase()}`);
    lines.push(topDecision.executiveSummary || "");
    lines.push("");
  }
  lines.push(`## Ranked Ideas (${scores?.length ?? 0})`);
  const byId = new Map((ideas ?? []).map((i: any) => [i.id, i]));
  for (const s of [...(scores ?? [])].sort((a: any, b: any) => (a.rank ?? 99) - (b.rank ?? 99))) {
    const idea: any = byId.get(s.ideaId);
    lines.push(`- **#${s.rank} (${s.total}) — ${idea?.title ?? "idea"}** → ${s.recommendation}`);
  }
  return lines.join("\n");
}
