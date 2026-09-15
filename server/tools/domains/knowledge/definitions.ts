/**
 * Tools-layer-split S8 — knowledge-domain tool DEFINITIONS.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * Each const below was moved VERBATIM from `server/tools.ts`, which now
 * references these consts in the exact original TOOL_DEFINITIONS array
 * positions — array order (and therefore the LLM-facing tool ordering and
 * `scripts/list-tools.ts` output) is byte-identical.
 */

import type { ToolDefinition } from "../../types";

export const searchKnowledgeDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "search_knowledge",
    description: "Use BEFORE freeform reasoning on any topic the platform might already have learned about — facts about Bob, [Your Product] operating procedures, product specs, customer history, prior decisions. Cheap hybrid (vector + keyword) search across the curated knowledge base. Returns ranked KB entries with title, snippet, and source. Try this before web_search when the answer plausibly came from prior platform work.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query to match against knowledge entries" },
      },
      required: ["query"],
    },
  },
};

export const knowledgeNavigateDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "knowledge_navigate",
    description: "WALK a long uploaded document by its heading structure (TOC-style) instead of vector search. Use for long PDFs/contracts/reports where you need a specific section by name and chunk-vector retrieval might miss cross-section context. Two modes: mode='list' returns the heading tree(s) of matching docs (use this first to see the structure); mode='read' returns the body text under a specific heading_path. Pair with search_knowledge — list first to find the right doc, then read the section. Only docs with >= 3 headings have a tree; for shorter notes, use search_knowledge.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["list", "read"], description: "list = return the heading tree(s); read = return body text under heading_path" },
        query: { type: "string", description: "Substring matched against doc_title / doc_path (case-insensitive). Used in list mode when doc_path is not given." },
        collection: { type: "string", description: "Optional doc-collection name to scope the search." },
        doc_path: { type: "string", description: "Exact doc_path (returned by list mode). Required for read mode." },
        collection_id: { type: "number", description: "Collection id (returned by list mode). Required for read mode." },
        heading_path: { type: "array", items: { type: "string" }, description: "Ordered titles to walk, e.g. ['Section 3','3.1 Revenue']. Case-insensitive substring tolerant. Required for read mode." },
        limit: { type: "number", description: "Max docs to return in list mode (1-20, default 5)." },
      },
      required: ["mode"],
    },
  },
};

export const createKnowledgeDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_knowledge",
    description: "Add a new entry to the permanent knowledge base. Use for storing reference material, guides, or important documentation.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the knowledge entry" },
        content: { type: "string", description: "The knowledge content" },
        category: { type: "string", description: "Category (e.g. 'reference', 'guide', 'skill')" },
        priority: { type: "number", description: "Priority 1-5 (5=highest)" },
      },
      required: ["title", "content", "category"],
    },
  },
};

export const storeTripleDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "store_triple",
    description: "Store a temporal knowledge triple (subject-predicate-object fact with time validity). Use for entity-relationship facts that may change over time. Examples: ('Alice', 'is CEO of', 'Acme Corp', from: '2025-01-01') or ('VisionClaw', 'runs on', 'PostgreSQL 15'). Set valid_until when a fact expires or is superseded.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "The entity the fact is about (e.g. 'Alice', 'VisionClaw', 'Felix')" },
        predicate: { type: "string", description: "The relationship or property (e.g. 'is CEO of', 'uses', 'lives in', 'has role')" },
        object: { type: "string", description: "The value or target entity (e.g. 'Acme Corp', 'PostgreSQL', 'New York')" },
        confidence: { type: "number", description: "Confidence 0.0-1.0 (default 1.0). Lower for inferred facts." },
        valid_from: { type: "string", description: "ISO date when this fact became true (default: now)" },
        valid_until: { type: "string", description: "ISO date when this fact stopped being true (null = still current)" },
        wing: { type: "string", description: "Memory Palace wing (project/domain slug)" },
        room: { type: "string", description: "Memory Palace room (topic slug)" },
      },
      required: ["subject", "predicate", "object"],
    },
  },
};

export const queryTriplesDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "query_triples",
    description: "Query temporal knowledge triples. Search by subject, predicate, and/or object. By default returns only currently-valid facts. Set include_expired=true to see historical facts. Use for answering 'what is X?', 'who does Y?', 'what changed about Z?' questions.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Filter by subject entity" },
        predicate: { type: "string", description: "Filter by relationship type" },
        object: { type: "string", description: "Filter by object/value" },
        as_of: { type: "string", description: "ISO date — return facts valid at this point in time (default: now)" },
        include_expired: { type: "boolean", description: "Include facts that are no longer valid (default: false)" },
        wing: { type: "string", description: "Filter by Memory Palace wing" },
        room: { type: "string", description: "Filter by Memory Palace room" },
      },
      required: [],
    },
  },
};

export const expireTripleDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "expire_triple",
    description: "Mark a knowledge triple as expired by setting its valid_until date. Use when a fact is no longer true (e.g. someone changed roles, a tool was replaced).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "The triple ID to expire" },
        valid_until: { type: "string", description: "ISO date when the fact stopped being true (default: now)" },
      },
      required: ["id"],
    },
  },
};

export const docSearchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "doc_search",
    description: "Search indexed document collections (like QMD). Modes: keyword (BM25-style), semantic (vector), hybrid (BM25+vector fusion, auto-reranked by Cohere when COHERE_API_KEY is set — strongly preferred). Use for notes, docs, knowledge bases, meeting transcripts, or any uploaded markdown/text/PDF. add_doc supports auto_contextualize:true for -49% top-K retrieval failure on noisy KBs (Anthropic Contextual Retrieval).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "get", "add_doc", "remove_doc", "create_collection", "delete_collection", "list_collections", "add_context", "embed", "status"], description: "Action to perform" },
        query: { type: "string", description: "Search query (for 'search' action)" },
        mode: { type: "string", enum: ["keyword", "semantic", "hybrid"], description: "Search mode. keyword: fast BM25-style (default). semantic: vector similarity (requires embeddings). hybrid: combined keyword+vector." },
        collection: { type: "string", description: "Collection name to scope search or operations to" },
        collectionId: { type: "number", description: "Collection ID (for add_doc, remove_doc, add_context, embed, delete_collection)" },
        docPath: { type: "string", description: "Document path/name identifier (for add_doc, remove_doc, get)" },
        content: { type: "string", description: "Document content to index (for add_doc)" },
        context: { type: "string", description: "Contextual description attached to chunks (for add_context, add_doc). Helps search relevance." },
        auto_contextualize: { type: "boolean", description: "(R98.27, add_doc only) When true, run an LLM (gpt-5-mini) per chunk to generate a 1-2 sentence situating prefix per Anthropic Contextual Retrieval. Stored in chunk.context and picked up by hybrid search. Default false. Adds ~$0.0001/chunk and a few seconds of latency for large docs; reduces top-20 retrieval failure ~49% on noisy KBs." },
        name: { type: "string", description: "Collection name (for create_collection)" },
        description: { type: "string", description: "Collection description (for create_collection)" },
        topK: { type: "number", description: "Max results to return (default: 10)" },
        minScore: { type: "number", description: "Minimum similarity score threshold (default: 0.1)" },
      },
      required: ["action"],
    },
  },
};

/** All knowledge-domain definitions in original TOOL_DEFINITIONS order. */
export const knowledgeDomainDefinitions: ToolDefinition[] = [
  searchKnowledgeDefinition,
  knowledgeNavigateDefinition,
  createKnowledgeDefinition,
  storeTripleDefinition,
  queryTriplesDefinition,
  expireTripleDefinition,
  docSearchDefinition,
];
