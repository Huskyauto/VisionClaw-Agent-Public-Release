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
    description: "Use the default frontier jury: owner requests are Profundo-first when enabled, with automatic free/subscription backups (including enabled Standard Compute pinned Gemini) then scoped budget-capped native APIs on faults. Standard Compute has a finite prepaid allowance. Distinct Profundo models share ONE provider; never claim provider independence. Other pools are explicit alternatives, not automatic upgrades. Compare reasoning perspectives for hard tasks; supply evidence_sources for source-bound observation, NOT truth certification. restate_gate detects ambiguity; dissent_quota may add steelmen. Other tenants retain their routing policy. Agreement is not factual proof. evidenceObservation covers only this exact answer; missing sources remain unresolved. Fetch primary sources with approved research tools first; this tool does not authenticate supplied URLs.",
    parameters: {
      type: "object",
      properties: {
        evidence_sources: {
          type: "array", maxItems: 6,
          description: "Optional actual source snapshots for source-bound observation. Never submit AI drafts or majority opinions as sources. Example: [{id:'manual',title:'Manufacturer manual',text:'Exact source passage',as_of:'2026-10-03'}]. No source URL is fetched or authenticated; unknown facts remain unresolved.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Short source ID, letters/numbers/underscore/hyphen only. Example: manual" },
              title: { type: "string", description: "Source name. Example: Manufacturer service manual" },
              text: { type: "string", description: "Actual source text, not a generated summary. Total source text limit: 24,000 characters." },
              locator: { type: "string", description: "Optional source location or record reference. Example: manual page 12. No URL is fetched." },
              as_of: { type: "string", description: "Optional source date; omit if unknown. Example: 2026-10-03" },
            },
            required: ["id", "title", "text"],
          },
        },
        question: { type: "string", description: "The single question or task to put to all proposers. Be specific and self-contained — proposers see ONLY this string, no conversation history." },
        proposer_pool: { type: "string", enum: ["premium", "frontier", "cheap", "mixed", "polarity"], description: "Default 'frontier': owner subscription-first when enabled, with bounded automatic recovery; other tenants retain their roster. Omit this field or choose 'frontier' for ordinary juries. 'premium', 'cheap', 'mixed' and 'polarity' are explicitly selected alternatives with their own existing economics and reasoning traditions, not automatic upgrades." },
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
    description: "Any owner-requested jury or independent review: actual Openference DeepSeek, direct OpenAI GPT-5.4 and direct Anthropic Sonnet 5.5 seats; topic-independent scoped paid permission, shared budget reservations and zero native paid retries. No Profundo seat. Use DIRECTLY, not orchestrate/delegate_task. For platform investigations use independent_evidence:true: three separate bounded status/session/provenance checks. For income opportunities use task_profile:income-discovery: generates six blind concepts, separately researches and cross-scores every candidate, returns ranked full report, disagreements and task-specific coverage. Proposed ideas/prices allowed; invented facts forbidden. Missing market proof means VALIDATE-FIRST. Public research has no paid fallback. Legacy issue review remains available. Analysis only: never fixes, contacts, bills, publishes or deploys.",
    parameters: {
      type: "object",
      properties: {
        task_profile: { type: "string", enum: ["issue-review", "income-discovery"], description: "income-discovery runs creative ideation, independent research, then cross-scoring and full reporting; issue-review preserves legacy behavior. Clear income jury requests are detected automatically." },
        issue_text: { type: "string", description: "The issue description (the actual thing to triage). Self-contained — proposers see ONLY this string + optional context, no conversation history. Include severity, anchor file/line refs, and current state if known." },
        context: { type: "string", description: "Optional supporting context (file paths, related decisions, prior agent notes, replit.md HARD RULEs that apply). Appended to issue_text in the prompt." },
        independent_evidence: { type: "boolean", description: "Execute a separate bounded read-only evidence pass for each juror in the trusted current conversation. Required for investigative jury requests; false is legacy text-only review." },
      },
      required: ["issue_text"],
    },
  },
};

export const secondOpinionDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "second_opinion",
    description: "Get an INDEPENDENT external cross-check. Default mode uses OpenRouter Fusion (parallel frontier panel + judge + synthesis). If Fusion is unavailable, the result can offer one server-pinned GLM 5.2 fallback. It never silently spends again after a failure; use mode `single_model_fallback` only as a separately authorized check. METERED and protected by the same dedicated daily cap. Pass `draft_answer` for an AGREE/PARTIAL/DISAGREE assessment. Do not use for routine chat or automatically repeat failed calls.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The single, self-contained question or claim to get a second opinion on. Fusion sees ONLY this (plus your optional draft) — no conversation history." },
        draft_answer: { type: "string", description: "Optional but recommended: YOUR current answer/conclusion. When provided, Fusion assesses whether it agrees, partially agrees, or disagrees and flags specific errors — turning this into a true cross-check rather than just a second answer." },
        mode: {
          type: "string",
          enum: ["fusion", "single_model_fallback"],
          description: "Defaults to fusion. Use single_model_fallback only for a separately authorized GLM 5.2 check after Fusion is unavailable; never as an automatic retry after an ambiguous timeout.",
        },
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
