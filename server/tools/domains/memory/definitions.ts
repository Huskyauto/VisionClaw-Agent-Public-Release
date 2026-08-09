/**
 * Tools-layer-split S7 — memory-domain tool DEFINITIONS.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * Each const below was moved VERBATIM from `server/tools.ts`, which now
 * references these consts in the exact original TOOL_DEFINITIONS array
 * positions — array order (and therefore the LLM-facing tool ordering and
 * `scripts/list-tools.ts` output) is byte-identical.
 */

import type { ToolDefinition } from "../../types";

export const searchMemoryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "search_memory",
    description: "Search the agent's Memory Palace for facts about the user. Supports hierarchical search by wing (project/domain) and room (topic). Use when the user asks 'do you remember...' or when you need to recall stored information. Filter by wing to search within a specific project or domain.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query - keywords or phrase to match against stored memories" },
        wing: { type: "string", description: "Optional: filter by wing (project/domain slug, e.g. 'visionclaw', 'personal', 'marketing')" },
        room: { type: "string", description: "Optional: filter by room (topic within a wing, e.g. 'architecture', 'team', 'goals')" },
      },
      required: ["query"],
    },
  },
};

export const createMemoryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_memory",
    description: "Store a new fact in the Memory Palace. Automatically checks for duplicates and resolves contradictions. Use for important preferences, personal details, or things the user asks you to remember. Assign a wing (project/domain) and room (topic) for hierarchical organization. R98.19: optionally pass `confidence` (0..1) — defaults to 1.0 for explicit user records; lower it (e.g. 0.8) when YOU are inferring rather than directly told. Facts are RANKED by confidence at recall time, so a low-confidence guess won't beat a high-confidence stated fact.",
    parameters: {
      type: "object",
      properties: {
        fact: { type: "string", description: "The fact to remember (concise, specific, third-person)" },
        category: { type: "string", enum: ["identity", "preference", "relationship", "goal", "context", "skill", "milestone", "status"], description: "Category of the memory" },
        wing: { type: "string", description: "Wing: project or domain slug (e.g. 'main-project', 'personal', 'marketing')" },
        room: { type: "string", description: "Room: topic within the wing (e.g. 'architecture', 'team', 'preferences', 'goals')" },
        confidence: { type: "number", minimum: 0, maximum: 1, description: "R98.19: how sure you are this is a durable, generalizable fact (0..1). Default 1.0 for explicit user records. Lower for inferences." },
      },
      required: ["fact", "category"],
    },
  },
};

export const rememberForThisSessionDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "remember_for_this_session",
    description: "R112.15: Pin a fact to THIS conversation's L2 session memory. Use when something important was just established that you'll need later in this same conversation but isn't durable enough to belong in persona-lifetime memory (which is what `create_memory` is for). Examples: 'user is in Tucson next week', 'we agreed to use Fish voice X', 'channel is named Built With Bob not VCA'. Will survive context-window truncation. Auto-promotes to persona memory if referenced 3+ times across turns.",
    parameters: {
      type: "object",
      properties: {
        fact: { type: "string", description: "Third-person, concrete, ≤280 chars (e.g. 'Bob's channel is named Built With Bob')" },
        kind: { type: "string", enum: ["entity", "preference", "constraint", "task_state", "other"], description: "entity=named thing | preference=how user wants something | constraint=rule/schedule/requirement | task_state=progress or decision | other" },
      },
      required: ["fact", "kind"],
    },
  },
};

export const updateMemoryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "update_memory",
    description: "Update an existing memory entry — change the fact text, category, or archive it. Use when information about the user changes or becomes outdated.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "ID of the memory entry to update" },
        fact: { type: "string", description: "Updated fact text (optional — omit to keep current)" },
        category: { type: "string", enum: ["preference", "relationship", "milestone", "status"], description: "Updated category (optional)" },
        status: { type: "string", enum: ["active", "archived"], description: "Set to 'archived' to retire outdated memories" },
      },
      required: ["id"],
    },
  },
};

export const recallContextDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "recall_context",
    description: "Recall earlier conversation history that was compacted (summarized) to save context space. Use this when you need to remember details from earlier in a conversation or from OTHER conversations in the same project. Search by keyword to find specific topics. This is your long-term conversation memory — it works ACROSS conversations within the same project. R75: optional `level` enables GraphRAG dual-level retrieval — 'global' returns community summaries, 'causal' returns cause→effect chains, 'auto' picks based on the question phrasing. Omit `level` for the original local recall behavior (back-compat).",
    parameters: {
      type: "object",
      properties: {
        conversationId: { type: "number", description: "The conversation ID to recall from. Use the current conversation ID, or omit to search across the entire project." },
        query: { type: "string", description: "Optional keyword to search for in archived messages (e.g. 'pdf', 'email', 'logo', a customer name). Omit to get the most recent archives." },
        limit: { type: "number", description: "Max number of archive chunks to return (default 3)" },
        projectWide: { type: "boolean", description: "If true, search across ALL conversations in the current project, not just the specified one. Default: false." },
        level: { type: "string", enum: ["local", "global", "causal", "auto"], description: "GraphRAG level. 'local' = original archive search (default if omitted). 'global' = community summaries. 'causal' = cause→effect chains. 'auto' = heuristic routing based on the query." },
        direction: { type: "string", enum: ["forward", "backward", "both"], description: "Used when level='causal'. forward=what does X cause, backward=what causes X, both=default." },
      },
      required: [],
    },
  },
};

export const graphMemoryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "graph_memory",
    description: "Structured graph-based memory system with trigger conditions, rollback, and identity persistence. Unlike flat vector embeddings, graph memory organizes knowledge in hierarchical nodes with parent-child relationships, cross-references, and conditional triggers ('when X happens, recall Y'). Supports versioned memory with rollback to any previous state. Inspired by Nocturne Memory. Use for storing persona identity traits, complex multi-step knowledge, conditional recall rules, or any memory that benefits from structure over similarity search.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["store", "recall", "search", "list_triggers", "rollback", "link", "tree"], description: "Memory operation to perform" },
        path: { type: "string", description: "Hierarchical path for the memory node. e.g. 'identity/core_values', 'projects/visionclaw/architecture', 'triggers/daily_checkin'" },
        content: { type: "string", description: "Content to store at this memory node (for 'store' action)" },
        trigger_condition: { type: "string", description: "Optional: condition that should cause this memory to be automatically recalled. e.g. 'when discussing security', 'when user mentions budget', 'on session start'" },
        query: { type: "string", description: "Search query for 'recall' or 'search' actions" },
        link_to: { type: "string", description: "Path to create a cross-reference link to (for 'link' action)" },
        version: { type: "number", description: "Version number to rollback to (for 'rollback' action)" },
        persona_id: { type: "number", description: "Scope memory to a specific persona. Omit for global memory." },
      },
      required: ["action"],
    },
  },
};

export const getUnifiedMemoryContextDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "get_unified_memory_context",
    description: "R122 — Single read surface across 11 memory-adjacent tables (memory_entries, agent_knowledge, conversation_facts, mind_tickets, procedure_edits, agent_runs, agent_trace_spans, graph_memory, knowledge_triples, mind_events, conversations). Read-only. Tenant-isolated via R120 withTenantTx. Call this BEFORE asking the user 'where did I put X?' or 'have we discussed Y before?' — it returns a normalized, sorted-by-recency timeline + per-source totals + per-source filtered counts. Use `query` for keyword search (ILIKE across each source's primary text columns), `sources` to scope to one or two surfaces, `sinceDays` to narrow the time window, `limit` for the merged-cap. Empty query returns the recent-activity dashboard view.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional keyword (case-insensitive ILIKE across each source's primary text). Omit for recent-activity view." },
        sources: { type: "array", items: { type: "string", enum: ["memory_entries", "agent_knowledge", "conversation_facts", "mind_tickets", "procedure_edits", "agent_runs", "agent_trace_spans", "graph_memory", "knowledge_triples", "mind_events", "conversations"] }, description: "Optional: restrict to these sources. Default: all 11." },
        sinceDays: { type: "number", minimum: 1, maximum: 3650, description: "Time window in days. Default 90." },
        limit: { type: "number", minimum: 1, maximum: 500, description: "Max merged items returned. Default 100. Per-source cap is 50." },
      },
    },
  },
};

export const memoryGeometryScanDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "memory_geometry_scan",
    description: "R107 — Geometry of Consolidation audit (Vangara & Gopinath 2026, MIT). Samples the tenant's active memory embeddings (optionally filtered by persona / wing / category), computes per-cluster geometry (mean within-cluster cosine distance d̄, participation-ratio dimension d_eff) and reports clusters in the SPREAD regime (d̄ ≥ 1−θ) — those are at risk of silent identity collapse if dedup/dream-consolidation merges them under a centroid. Persists each scan to memory_geometry_audits for trend analysis. Use BEFORE asking the user 'why does memory keep losing distinctions about X?' — the answer is usually a spread cluster you can now name.",
    parameters: {
      type: "object",
      properties: {
        persona_id: { type: "number", description: "Optional: scope to one persona's memories." },
        wing: { type: "string", description: "Optional: filter by wing (e.g. 'visionclaw', 'personal')." },
        category: { type: "string", description: "Optional: filter by category." },
        theta: { type: "number", minimum: 0, maximum: 1, description: "Consolidator similarity threshold (default 0.85 — matches dedup). θ' = 1 − θ is the spread cutoff." },
        limit: { type: "number", minimum: 5, maximum: 500, description: "Max memories to load (default 100)." },
      },
    },
  },
};

/** All memory-domain definitions in original facade order. */
export const memoryDomainDefinitions: ToolDefinition[] = [
  searchMemoryDefinition,
  createMemoryDefinition,
  rememberForThisSessionDefinition,
  updateMemoryDefinition,
  recallContextDefinition,
  graphMemoryDefinition,
  getUnifiedMemoryContextDefinition,
  memoryGeometryScanDefinition,
];
