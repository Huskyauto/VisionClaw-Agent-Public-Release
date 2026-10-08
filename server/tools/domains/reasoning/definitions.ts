/**
 * Tools-layer-split S25e — reasoning-domain tool DEFINITIONS.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * Each const below was moved VERBATIM from `server/tools.ts`, which now
 * references these consts in the exact original TOOL_DEFINITIONS array
 * positions — array order (and therefore the LLM-facing tool ordering and
 * `scripts/list-tools.ts` output) is byte-identical. The already-migrated
 * `findingsPublishDefinition` / `findingsReadDefinition` refs that sit BETWEEN
 * `attribute_failure` and `hypothesis_pin` in the facade array are untouched.
 */

import type { ToolDefinition } from "../../types";

export const attributeFailureDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "attribute_failure",
    description: "R106 N1 — Record an L0–L5 failure attribution against a scoped reference (grade_deliverable, build_html_app, commitment, subagent_chunk, etc.) so the reflexive auto-revise loop knows what to do next. STRICT-PROGRESSIVE: only attribute upward after excluding lower causes. L0=raw observation; L1=tool failure (network/syntax/perms — RETRY); L2=prerequisite failure (auth expired, dep missing — FIX_PREREQ); L3=environment (rate-limit, WAF, upstream down — BACKOFF); L4=hypothesis falsified (assumption wrong — REGENERATE_PLAN); L5=strategy (deadlock/goal drift — ESCALATE_HITL). Returns the recommended next action plus a promotion flag if ≥3 consecutive L4s have streaked into a strategic L5.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Scope kind. E.g. 'grade_deliverable', 'build_html_app', 'commitment', 'subagent_chunk', 'browser_action'." },
        scope_ref: { type: "string", description: "Stable id within scope — e.g. job id, commitment id, deliverable path, chunk id." },
        level: { type: "string", enum: ["L0", "L1", "L2", "L3", "L4", "L5"], description: "Attribution level (strict-progressive)." },
        detail: { type: "string", description: "One-line plain-language explanation of what failed and how you ruled out lower levels." },
        context: { description: "Optional structured context (object). Tool error code, status, response excerpt, etc." },
      },
      required: ["scope", "scope_ref", "level", "detail"],
    },
  },
};

export const hypothesisPinDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "hypothesis_pin",
    description: "R106 N4 — Pin a load-bearing hypothesis so it SURVIVES chat-engine context compression. Use when a long-running task depends on a working assumption you must not lose if older messages get summarized away (e.g. 'user's brand color is #FF6A00', 'we confirmed Drive folder X is the active workspace', 'we ruled out method Y after three failures'). Defaults to a 4h TTL so stale pins don't pollute future runs.",
    parameters: {
      type: "object",
      properties: {
        hypothesis: { type: "string", description: "The hypothesis/working fact in one declarative sentence (active voice, ≤300 chars)." },
        confidence: { type: "number", description: "0–1. Default 0.7." },
        ttl_minutes: { type: "number", description: "Time-to-live in minutes. Default 240 (4h). Min 1, max 1440 (24h)." },
      },
      required: ["hypothesis"],
    },
  },
};

export const hypothesisListPinnedDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "hypothesis_list_pinned",
    description: "R106 N4 — List currently-active pinned hypotheses for the calling tenant + persona (and optionally the current conversation). Read this at the start of any long task to recover context that a prior compression step might have summarized away.",
    parameters: {
      type: "object",
      properties: {
        conversation_id: { type: "number", description: "Optional. Filter to one conversation." },
        limit: { type: "number", description: "Max rows. Default 20, capped 100." },
      },
      required: [],
    },
  },
};

export const planGraphEditDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "plan_graph_edit",
    description: "R106 N5 — Apply a batch of structured edit operations to a Plan-on-Graph DAG. Three op kinds: ADD_NODE (create a planning node with optional dependsOn[]), UPDATE_NODE (change label/status/deps/metadata), DEPRECATE_NODE (mark dead with a reason). After the batch, the graph is cycle-checked — a detected cycle is REPORTED back so you can reverse the offending edge. Use this INSTEAD of free-text task lists when an orchestration could benefit from explicit DAG structure (chunk-and-parallel jobs, multi-step deliverables, plans with conditional branches).",
    parameters: {
      type: "object",
      properties: {
        plan_id: { type: "string", description: "Stable plan identifier (e.g. project-prefixed: 'video-launch-2026-05'). Same plan_id across edits accumulates the same DAG." },
        ops: {
          type: "array",
          description: "Ordered list of edit ops to apply.",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["ADD_NODE", "UPDATE_NODE", "DEPRECATE_NODE"] },
              nodeId: { type: "string", description: "Node id within plan (your choice; must be stable)." },
              label: { type: "string", description: "Human label (ADD/UPDATE)." },
              status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "deprecated"], description: "Defaults to pending on ADD." },
              dependsOn: { type: "array", items: { type: "string" }, description: "Sibling nodeId list (must already exist before this edge resolves)." },
              metadata: { description: "Optional structured metadata (object)." },
              reason: { type: "string", description: "Why a DEPRECATE_NODE is being marked dead (kept in metadata)." },
              maxSteps: { type: "number", description: "R108-A — Adaptive per-node step budget (executor reflexive cap). Integer 1–200, clamped server-side. Default = orchestrator default. Set HIGHER for hard nodes (multi-stage retry, blind exploration, batch grade-then-revise, anything where you've previously needed several reflection turns). Set LOWER for easy / mechanical nodes (single fetch, single render, deterministic transform). Omit (or null) to inherit the orchestrator default. Applies on ADD_NODE and UPDATE_NODE." },
            },
            required: ["op", "nodeId"],
          },
        },
      },
      required: ["plan_id", "ops"],
    },
  },
};

export const planGraphQueryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "plan_graph_query",
    description: "R106 N5 — Query a Plan-on-Graph by plan_id. Returns ALL nodes plus the topological partition: ready[] (deps satisfied — fire these in parallel NOW), blocked[] (waiting on incomplete deps), completed[], failed[]. Use BEFORE firing the next batch of subagents so you parallelize maximally instead of going one node at a time.",
    parameters: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
      },
      required: ["plan_id"],
    },
  },
};

export const hypothesisAttachEvidenceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "hypothesis_attach_evidence",
    description: "R108 B — Attach a piece of evidence to a pinned hypothesis (Causal Graph Reasoning, LuaN1aoAgent cherry-pick). Use to GROUND a load-bearing claim instead of asserting it: a memory entry id, finding id, tool-result snippet, or short free-text observation. Each edge carries its own confidence score. The top-3 evidence edges per pinned hypothesis are auto-rendered under the hypothesis in the system-prompt block so the executor sees the grounding without an extra fetch.",
    parameters: {
      type: "object",
      properties: {
        hypothesis_id: { type: "number", description: "id of the pinned hypothesis to attach evidence to (returned by hypothesis_pin)." },
        evidence_kind: { type: "string", enum: ["memory_entry", "finding", "tool_result", "free_text"], description: "What kind of artifact backs this hypothesis." },
        evidence_ref: { type: "string", description: "The reference: memory entry id (as string), finding id, a sanitized snippet of the tool result, or a one-sentence free-text observation. ≤240 chars after sanitization." },
        confidence: { type: "number", description: "0–1. Default 0.6. Per-edge confidence — independent from the hypothesis's own confidence." },
        note: { type: "string", description: "Optional one-sentence note explaining why this evidence supports the hypothesis." },
      },
      required: ["hypothesis_id", "evidence_kind", "evidence_ref"],
    },
  },
};

export const hypothesisEvidenceChainDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "hypothesis_evidence_chain",
    description: "R108 B — Read the full evidence chain attached to a single pinned hypothesis, ordered by confidence DESC. Use BEFORE making a decision that depends on a pinned hypothesis to verify the grounding is still strong (e.g. evidence not stale, ref still resolvable, confidence didn't degrade).",
    parameters: {
      type: "object",
      properties: {
        hypothesis_id: { type: "number", description: "id of the pinned hypothesis to read evidence for." },
        limit: { type: "number", description: "Max edges to return. Default 25, capped 100." },
      },
      required: ["hypothesis_id"],
    },
  },
};

export const reasoningDomainDefinitions: ToolDefinition[] = [
  attributeFailureDefinition,
  hypothesisPinDefinition,
  hypothesisListPinnedDefinition,
  planGraphEditDefinition,
  planGraphQueryDefinition,
  hypothesisAttachEvidenceDefinition,
  hypothesisEvidenceChainDefinition,
];
