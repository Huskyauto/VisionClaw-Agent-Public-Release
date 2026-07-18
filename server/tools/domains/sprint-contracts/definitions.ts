/**
 * Tools-layer-split S25k — sprint-contracts-domain tool definitions.
 *
 * The 3 contiguous R115.5 "Sprint Contract" tools (`pin_done_condition`,
 * `get_done_condition`, `evaluate_against_contract`) — all backed by
 * `server/lib/sprint-contract` (pinDoneCondition / getDoneCondition /
 * evaluateAgainstContract), one thematically coherent cluster implementing the
 * pre-flight done-condition pin + evaluator-verdict pattern.
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array; the
 * facade re-imports these const refs so the LLM-facing surface (names,
 * descriptions, parameter schemas, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const pinDoneConditionDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "pin_done_condition",
    description: "R115.5 — Pin a 'done condition' contract at job kickoff BEFORE any generation begins. Per the Osmani / Anthropic harness pattern: separating generation from evaluation outperforms self-grading, and writing the acceptance criteria down up-front catches more scope drift than any prompt change. doneCondition is 1–5 plain-English lines (≥10, ≤2000 chars after trim). One OPEN contract per (refKind, refId); pinning the same content is idempotent; pinning different content errors unless force=true (which cancels the prior). Returns {ok, contract, reused?, cancelledPriorId?}. NOT destructive in the money-movement/state-mutation sense, but marked sensitive because force=true cancels an existing contract.",
    parameters: {
      type: "object",
      properties: {
        refKind: { type: "string", description: "Reference family: 'deliverable_job' | 'subagent_chunk' | 'project_task' | etc. Stable identifier the evaluator will use to look the contract up later." },
        refId: { type: "string", description: "Stable string identifier within refKind." },
        doneCondition: { type: "string", description: "1–5 line plain-English acceptance criteria. ≥10 chars, ≤2000 chars after whitespace normalization." },
        criteria: { type: "object", description: "Optional structured criteria (e.g. {minWordCount: 800, mustIncludeSection: ['intro','tldr']}). Stored but not LLM-graded." },
        force: { type: "boolean", description: "If true, cancel any existing open contract for this (refKind, refId) and pin the new one. Default false." },
      },
      required: ["refKind", "refId", "doneCondition"],
    },
  },
};

export const getDoneConditionDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "get_done_condition",
    description: "R115.5 — Look up the pinned 'done condition' for (refKind, refId) so the evaluator grades against the verbatim contract instead of a re-imagined criterion. Default status='open'. Returns {ok, contract} or {ok:false, error:'no_contract'}.",
    parameters: {
      type: "object",
      properties: {
        refKind: { type: "string", description: "Reference family used at pinning time." },
        refId: { type: "string", description: "Reference id used at pinning time." },
        status: { type: "string", description: "open|passed|failed|cancelled. Default 'open'." },
      },
      required: ["refKind", "refId"],
    },
  },
};

export const evaluateAgainstContractDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "evaluate_against_contract",
    description: "R115.5 — Record an evaluator verdict against a pinned sprint contract. The contract is looked up by (refKind, refId) with status='open'; the row's sha256 is re-checked against the stored doneCondition (tamper detection). Marks the contract 'passed' or 'failed' and writes the evaluation jsonb {verdict, scoredBy, notes, evidence, evaluatedAt, contractSha256}. Returns {ok, contract}. Read-only against the world; mutates only the contract row.",
    parameters: {
      type: "object",
      properties: {
        refKind: { type: "string", description: "Reference family used at pinning time." },
        refId: { type: "string", description: "Reference id used at pinning time." },
        evidence: { type: "string", description: "Short summary / artifact the verdict is based on (capped at 4000 chars on write)." },
        verdict: { type: "string", enum: ["passed", "failed"], description: "Final verdict for this contract." },
        scoredBy: { type: "string", description: "Who graded: 'felix' | 'architect-subagent' | 'human' | etc." },
        notes: { type: "string", description: "Optional grader notes (capped at 4000 chars on write)." },
      },
      required: ["refKind", "refId", "evidence", "verdict"],
    },
  },
};

/** All sprint-contracts-domain definitions, in facade splice order. */
export const sprintContractsDomainDefinitions: ToolDefinition[] = [
  pinDoneConditionDefinition,
  getDoneConditionDefinition,
  evaluateAgainstContractDefinition,
];
