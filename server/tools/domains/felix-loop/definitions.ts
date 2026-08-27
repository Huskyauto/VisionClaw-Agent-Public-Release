/**
 * Tools-layer-split S25i — felix-loop-domain tool definitions.
 *
 * The 7 contiguous Felix autonomous-loop tools (`felix_loop_status`,
 * `list_felix_loop_runs`, `list_felix_proposals`, `approve_felix_proposal`,
 * `reject_felix_proposal`, `felix_loop_run_now`, `execute_felix_proposal`) — all
 * backed by the single `server/felix-loop` module, one thematically coherent
 * cluster. (`verify_felix_proposal_spec` already migrated in S10 → the quality
 * domain; it is NOT part of this slice and keeps its original TOOL_DEFINITIONS
 * position between `felix_loop_run_now` and `execute_felix_proposal`.)
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array; the
 * facade re-imports these const refs so the LLM-facing surface (names,
 * descriptions, parameter schemas, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const felixLoopStatusDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "felix_loop_status",
    description: "Get the current status of Felix's autonomous loop (R74.13w). Returns: current mode (dry_run vs live), live_after date, kill switch state, wake hours, monthly cap and current month spend, count of pending proposals awaiting Bob's review, and details of the last loop run. Use to answer 'how is Felix doing?' or 'is the loop running?' or 'what has Felix been thinking about?'",
    parameters: { type: "object", properties: {} },
  },
};

export const listFelixLoopRunsDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "list_felix_loop_runs",
    description: "Use when auditing what Felix has been READING (not just what he proposed), when answering \"why did Felix decide X\", or when correlating loop runs with outcomes. Returns recent runs with context summary, intent (Felix's read of the world), proposal count, tokens, and cost. Read-only.",
    parameters: { type: "object", properties: { limit: { type: "number", description: "Max rows. Default 10, max 50." } } },
  },
};

export const listFelixProposalsDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "list_felix_proposals",
    description: "Use when Bob asks \"what has Felix been thinking about\", before any approval session, or when auditing the loop. Returns Felix's drafted proposals filtered by status (pending | approved | rejected | executed | expired). In dry-run mode every Felix action lands here for explicit Bob approval — nothing fires automatically.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "approved", "rejected", "executed", "expired"], description: "Filter by status. Default 'pending'." },
        limit: { type: "number", description: "Max rows. Default 20, max 100." },
      },
    },
  },
};

export const approveFelixProposalDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "approve_felix_proposal",
    description: "Approve a Felix proposal so it moves from pending → approved. NOTE: approving does NOT automatically execute the action — execution requires a separate explicit follow-up. This is a deliberate two-step rail to prevent Felix from acting on its own. Bob-only operation.",
    parameters: { type: "object", properties: { id: { type: "number", description: "Proposal id from list_felix_proposals" } }, required: ["id"] },
  },
};

export const rejectFelixProposalDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "reject_felix_proposal",
    description: "Use when Bob explicitly rejects a Felix proposal AND can articulate why (the reason teaches Felix). Bob-only operation. Returns success. The reason is stored in the proposal row and feeds Felix's lesson loop — vague reasons (\"no\") teach nothing; specific reasons (\"wrong tenant\" / \"competing priority\") teach a lot.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Proposal id" },
        reason: { type: "string", description: "Short reason — Felix learns from this" },
      },
      required: ["id", "reason"],
    },
  },
};

export const felixLoopRunNowDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "felix_loop_run_now",
    description: "Manually trigger a Felix Loop run right now (bypasses the 4-hour interval and wake-hours gate). Useful for testing the loop end-to-end or for forcing a fresh read after a major event. Still respects kill switch and monthly cost cap. Bob-only operation.",
    parameters: { type: "object", properties: {} },
  },
};

export const executeFelixProposalDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "execute_felix_proposal",
    description: "Run an APPROVED Felix proposal through the SWD verification rail: capture pre-state from the verifier table, fire the action (LIVE MODE ONLY — currently dry-run until 2026-05-12), capture post-state, verify actual delta matches expected_count_delta. On mismatch, status flips to 'verification_failed' and Bob must manually re-approve. In dry-run mode (current), captures pre-state and proves the rail works without firing the side effect. Bob-only operation.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Felix proposal id (must already be 'approved')" },
      },
      required: ["id"],
    },
  },
};

/** All felix-loop-domain definitions, in facade splice order. */
export const felixLoopDomainDefinitions: ToolDefinition[] = [
  felixLoopStatusDefinition,
  listFelixLoopRunsDefinition,
  listFelixProposalsDefinition,
  approveFelixProposalDefinition,
  rejectFelixProposalDefinition,
  felixLoopRunNowDefinition,
  executeFelixProposalDefinition,
];
