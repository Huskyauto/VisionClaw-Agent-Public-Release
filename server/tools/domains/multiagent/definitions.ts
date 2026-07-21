/**
 * Tools-layer-split S19 — multiagent-domain tool definitions.
 *
 * Selection: the 3 Mixture-of-Agents / multi-model tools that cluster
 * contiguously in both the legacy TOOL_DEFINITIONS array and the legacy switch —
 * `ensemble_query`, `jury_triage`, `second_opinion`. In the facade each was an
 * individual switch arm that read `params._tenantId` (fail-closed guard) +
 * `params._invokedVia` and dispatched into `./moa` / `./lib/jury-triage` /
 * `./second-opinion`. The sole authz/trust channel is `_tenantId` (covered by
 * the trusted ToolContext seam); `_invokedVia` is a telemetry label NOT in the
 * dispatcher's TRUST_SIGNAL_KEYS strip list, so it survives on `params` exactly
 * as before. The owner metered-override (`params._tenantId === ADMIN_TENANT_ID`)
 * maps to `ctx.tenantId === ADMIN_TENANT_ID` — behavior-identical because the
 * dispatcher stamps `ctx.tenantId` from the platform's own `_tenantId`.
 *
 * Adjacent multiagent-flavoured tools stay legacy per the smallest-safe-batch
 * precedent: `delegate_task` and `debate` are scattered (not contiguous with
 * this cluster) and spawn subagents / carry heavier trust seams — they migrate
 * with the agentic/multiagent stragglers later.
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes — inventory diff must stay byte-clean).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const ensembleQueryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "ensemble_query",
    description: "Mixture-of-Agents (MoA): when you face a hard reasoning, factual, or judgment question and want the most reliable answer, run the same question through diverse frontier models in parallel (Claude Opus 4.8, GPT-5.5, Gemini 3.5 Flash) and have a strong aggregator (Claude Opus 4.8, fallback GPT-5.5) synthesize the best combined answer. Use SPARINGLY — costs ~5x a normal call. Best for: ambiguous research questions, multi-step reasoning where you're unsure, factual claims you want cross-checked, code or design decisions with multiple valid approaches. Do NOT use for: simple chat, tool routing, anything where one good answer is obviously enough. R125+1 — `proposer_pool` selects the proposer set: 'frontier' (default), 'cheap' (5 lineage-diverse OpenRouter), 'mixed' (3 frontier + 3 cheap), or R125+13.18 'polarity' (4 frontier models, each running a DIFFERENT reasoning-tradition system prompt — Munger inversion / Taleb tail-risk / Kahneman bias-audit / Meadows systems-loops — forces genuinely different reasoning paths). R125+13.18 — `restate_gate` runs a fast pre-round where each proposer reframes the question; if restatements diverge, response sets `questionAmbiguous=true`. `dissent_quota` watches κ and, if proposers agree above 70%, spawns 2 extra steelman proposers to argue the opposing view (anti-groupthink).",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The single question or task to put to all proposers. Be specific and self-contained — proposers see ONLY this string, no conversation history." },
        proposer_pool: { type: "string", enum: ["frontier", "cheap", "mixed", "polarity"], description: "R125+1 / R125+13.18 — optional. 'frontier' (default) uses 3 top-tier proposers; 'cheap' uses 5 lineage-diverse OpenRouter cheap models; 'mixed' uses 3 frontier + 3 cheap; 'polarity' uses 4 frontier models each running a different reasoning-tradition system prompt (Munger inversion / Taleb tail-risk / Kahneman bias-audit / Meadows systems-loops). Use polarity for strategic decisions where you want maximally different reasoning paths." },
        restate_gate: { type: "boolean", description: "R125+13.18 — optional, default false. Runs a fast pre-deliberation round where each proposer reframes the question in one sentence; we embed the restatements and check pairwise cosine. If they diverge (cosine < 0.6), the response surfaces questionAmbiguous=true — the question itself was the problem. Adds ~one fast proposer round of cost. Use for high-stakes asks where 'maybe the question is vague' is a real risk." },
        dissent_quota: { type: "boolean", description: "R125+13.18 — optional, default false. After the main proposer round, if κ-concordance is above 0.70 (groupthink suspected), spawn 2 extra steelman proposers with a system prompt that forces them to argue the strongest OPPOSING case against the emergent consensus. Anti-groupthink. Steelmen are included in the aggregator's synthesis and the final κ. Adds ~2 proposer-call cost ONLY when triggered." },
      },
      required: ["question"],
    },
  },
};

export const juryTriageDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "jury_triage",
    description: "R125+3.6 — Multi-model jury triage for an open issue/finding. Runs the issue through 3 frontier proposers (ensemble_query frontier pool) asking for FIX/ACCEPT/REJECT verdict + rationale; computes 2-of-3 majority. Use when you face a decision you don't want to single-handedly classify — code-review finding (especially borderline HIGH/MEDIUM), defense-in-depth gap, CI failure with no auto-fix rule, bug-vs-feature call, ambiguous architect verdict. Returns { verdict, votes[], majority, concordance, shouldEscalate, fixProposal? }. AUTO-APPLY POLICY (Bob 2026-05-23 R125+3.6): ACCEPT/REJECT verdicts are safe to act on directly; FIX verdicts should be queued for an implementer (the fixProposal is NL text, not executable code); ESCALATE (no 2/3 majority) should trigger owner-notification. Cost: ~5x normal call (same as ensemble_query frontier pool). Trusted-only.",
    parameters: {
      type: "object",
      properties: {
        issue_text: { type: "string", description: "The issue description (the actual thing to triage). Self-contained — proposers see ONLY this string + optional context, no conversation history. Include severity, anchor file/line refs, and current state if known." },
        context: { type: "string", description: "Optional supporting context (file paths, related decisions, prior agent notes, replit.md HARD RULEs that apply). Appended to issue_text in the prompt." },
      },
      required: ["issue_text"],
    },
  },
};

export const secondOpinionDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "second_opinion",
    description: "R125+52.41 — Get an INDEPENDENT second opinion / cross-check from OpenRouter Fusion (a managed panel of frontier models that answer in parallel → a judge compares them → a final model synthesizes, with built-in web search). Use when YOUR current answer feels shaky, unsubstantiated, or high-stakes and you want a lineage-diverse OUTSIDE check before committing or before bugging the human — e.g. a factual claim you can't fully verify, a judgment call with real consequences, or a research question where being wrong is expensive. Pass your DRAFT answer in `draft_answer` and Fusion will both answer independently AND tell you whether it AGREES / PARTIALLY agrees / DISAGREES with your draft and why. METERED (real $ per call) and budget-capped (~$25/day); it auto-declines when the daily cap is hit (returns ok:false, skipped:'budget'). Reach for ensemble_query for IN-HOUSE multi-model reasoning; reach for second_opinion specifically when you want an EXTERNAL independent cross-check. The platform ALSO fires this automatically when our own ensemble comes back low-confidence, so a low-κ answer may already carry a Fusion cross-check. Do NOT use for routine chat or when one good answer is obviously enough. Returns { ok, answer, agreement, model, costUsd, budget }.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The single, self-contained question or claim to get a second opinion on. Fusion sees ONLY this (plus your optional draft) — no conversation history." },
        draft_answer: { type: "string", description: "Optional but recommended: YOUR current answer/conclusion. When provided, Fusion assesses whether it agrees, partially agrees, or disagrees and flags specific errors — turning this into a true cross-check rather than just a second answer." },
      },
      required: ["question"],
    },
  },
};

/** Full ordered set, for any consumer that wants the domain's definitions. */
export const multiagentDomainDefinitions: ToolDefinition[] = [
  ensembleQueryDefinition,
  juryTriageDefinition,
  secondOpinionDefinition,
];
