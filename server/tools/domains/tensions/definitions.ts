/**
 * Tools-layer-split S25j — tensions-domain tool definitions.
 *
 * The 6 contiguous DreamGraph "Tensions + ADRs" tools (`create_tension`,
 * `list_open_tensions`, `resolve_tension`, `create_adr`, `list_adrs`,
 * `supersede_adr`) — all backed by `storage` methods (createTension /
 * listTensions / resolveTension / createAdr / listAdrs / supersedeAdr), one
 * thematically coherent cluster (R74.13z-quint+2).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array; the
 * facade re-imports these const refs so the LLM-facing surface (names,
 * descriptions, parameter schemas, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const createTensionDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "create_tension",
    description: "Record a TENSION — a structured 'predicted ≠ actual' conflict so the next persona can pick up where you stopped instead of relearning the wall. Use whenever a result contradicts your assumption: a bug that violates your model, a customer answer that breaks an ICP, a metric that won't move regardless of intervention. Tensions are visible to every persona via list_open_tensions and rendered on /graph-explorer. Auto-created already for red surprise scores; only file manually for things the surprise scorer can't see (qualitative conflicts, customer feedback, doctrine breakdowns).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "One-line summary, e.g. 'Apollo's cold-email ICP excludes our biggest converter segment'" },
        predicted_state: { type: "object", description: "What you expected, as structured data. Include description + supporting numbers/IDs." },
        actual_state: { type: "object", description: "What actually happened, as structured data. Include description + supporting numbers/IDs." },
        evidence: { type: "array", description: "Array of evidence pointers: URLs, table+ID references, sample data. Each item: { type, id?, url?, note? }", items: { type: "object" } },
        owner_persona_id: { type: "number", description: "Optional persona ID who owns following up on this tension" },
      },
      required: ["title", "predicted_state", "actual_state"],
    },
  },
};

export const listOpenTensionsDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "list_open_tensions",
    description: "Use BEFORE reasoning on any hard problem so you don't re-litigate a known conflict. A \"tension\" is a documented gap between expectation and reality (e.g. \"user thinks X should auto-publish, code requires manual approval\"). Returns unresolved tensions in this tenant with title, description, and severity. Treat each open tension as constraint on your plan.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "Default 'open'. Values: open|investigating|resolved|superseded|wontfix" },
        source_kind: { type: "string", description: "Optional filter by origin (surprise, manual, plan_failure, etc.)" },
        owner_persona_id: { type: "number", description: "Optional filter by owner persona id" },
        limit: { type: "number", description: "Default 100, max 500" },
      },
    },
  },
};

export const resolveTensionDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "resolve_tension",
    description: "Mark a TENSION as resolved with the fix and supporting evidence. Future personas reading list_resolved_tensions (or the graph explorer) will learn from your resolution. ALWAYS include resolution_evidence — at minimum a paragraph in the evidence object explaining what worked.",
    parameters: {
      type: "object",
      properties: {
        tension_id: { type: "number", description: "The tension row id to resolve" },
        resolution: { type: "string", description: "What was the fix, in 1-3 sentences. The next persona reads this." },
        resolution_evidence: { type: "object", description: "Optional structured evidence: { commit_sha?, pr_url?, knowledge_id?, metrics?, before_after? }" },
      },
      required: ["tension_id", "resolution"],
    },
  },
};

export const createAdrDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "create_adr",
    description: "Record an ARCHITECTURE DECISION RECORD (ADR). Use whenever you make a structural choice the rest of the system has to live with: picked one library/approach over another, chose a data shape, ruled out a strategy, set a constraint. ADRs are queryable by every persona via list_adrs and rendered on /graph-explorer with supersession chains. The platform forgets oral tradition — every 'we tried that already and it doesn't work' lives in an ADR or it dies with the persona that learned it.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "One-line decision summary, e.g. 'Use pgvector for semantic search instead of a separate vector DB'" },
        context: { type: "string", description: "Why we had to choose. The forces and constraints in play." },
        decision: { type: "string", description: "What we did, plainly stated." },
        consequences: { type: "string", description: "What this enables AND what it locks out. Both sides — future personas need to know the trade-offs." },
        tags: { type: "array", description: "Optional labels: ['data', 'security', 'cost', 'ux']", items: { type: "string" } },
        status: { type: "string", description: "Default 'accepted'. Values: proposed|accepted|deprecated|superseded" },
        author_persona_id: { type: "number", description: "Optional persona id who authored the ADR" },
      },
      required: ["title", "context", "decision", "consequences"],
    },
  },
};

export const listAdrsDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "list_adrs",
    description: "List ARCHITECTURE DECISION RECORDS for this tenant. CALL THIS BEFORE designing anything new so you don't relitigate settled choices. Filter by status (accepted|deprecated|superseded) or tag.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "Default returns all. Values: proposed|accepted|deprecated|superseded" },
        tag: { type: "string", description: "Optional tag filter, e.g. 'data', 'security'" },
        limit: { type: "number", description: "Default 100, max 500" },
      },
    },
  },
};

export const supersedeAdrDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "supersede_adr",
    description: "Mark an OLD ADR as superseded by a NEW ADR with the reason for the change. Both ADRs must already exist (create_adr the new one first). Builds the supersession chain visible in /graph-explorer.",
    parameters: {
      type: "object",
      properties: {
        old_adr_id: { type: "number", description: "The ADR being replaced" },
        new_adr_id: { type: "number", description: "The ADR replacing it (must already exist via create_adr)" },
        reason: { type: "string", description: "Why we're moving from old to new — the lesson learned" },
      },
      required: ["old_adr_id", "new_adr_id", "reason"],
    },
  },
};

/** All tensions-domain definitions, in facade splice order. */
export const tensionsDomainDefinitions: ToolDefinition[] = [
  createTensionDefinition,
  listOpenTensionsDefinition,
  resolveTensionDefinition,
  createAdrDefinition,
  listAdrsDefinition,
  supersedeAdrDefinition,
];
