/**
 * Tools-layer-split — research-domain tool definitions.
 *
 * Selection: the 8 plain, self-contained research-cluster switch arms —
 * `deep_research`, `parallel_research`, `research_digest`,
 * `recursive_synthesize`, `trend_research`, `findings_publish`,
 * `findings_read`, `ingest_paper`. In the legacy facade each was an individual
 * switch arm that dispatched into a single external module
 * (`./research-pipeline`, `./agentic/*`, `./research-engine`, `./recursive-llm`,
 * `./trend-research`, `./lib/parallel-findings-bus`, `./lib/paper-ingest`).
 * Trust seam is `_tenantId` only (covered by the trusted ToolContext seam;
 * deep_research + trend_research read no trust signal at all).
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes — inventory diff must stay byte-clean).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const deepResearchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "deep_research",
    description: "Conduct multi-source research on a topic. Generates diverse search queries, searches the web, fetches top sources, and synthesizes findings into a structured report with sources, confidence level, and follow-up questions. Use for thorough investigation requiring multiple perspectives, fact verification, or comprehensive analysis.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The research question to investigate" },
        depth: { type: "string", enum: ["quick", "standard", "thorough"], description: "Research depth: quick (1 search), standard (2 searches + source fetching), thorough (3 searches + deep analysis). Default: standard" },
      },
      required: ["question"],
    },
  },
};

export const parallelResearchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "parallel_research",
    description: "Research multiple topics in parallel using Perplexity and Firecrawl. Dramatically faster than researching topics one at a time. Returns a structured result per topic with answers, citations, and timing. Use when the user asks about several related topics or wants a broad survey. Results are cached for 20 minutes per query to save cost on repeat queries.",
    parameters: {
      type: "object",
      properties: {
        topics: {
          type: "array",
          items: { type: "string" },
          description: "List of 2-10 research queries to run in parallel. Each should be a focused question.",
        },
        provider: {
          type: "string",
          enum: ["perplexity", "firecrawl", "auto"],
          description: "Search provider. 'auto' picks perplexity if available, otherwise firecrawl. Default: auto",
        },
        concurrency: {
          type: "number",
          description: "Max concurrent searches (1-8, default 4). Lower if you're hitting rate limits.",
        },
      },
      required: ["topics"],
    },
  },
};

export const researchDigestDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "research_digest",
    description: "Generate a weekly research digest that consolidates all nightly research findings, code proposals, and actionable improvements into a structured brief. Writes to .local/research-digest.md and uploads to Google Drive. Use this to review what the research engine has discovered and what improvements should be implemented.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const recursiveSynthesizeDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "recursive_synthesize",
    description: "Synthesize an answer across LONG content (research dumps, many documents, long transcripts, scraped pages — anything larger than a single direct LLM call can handle reliably). Implements Algorithm 1 from the Recursive Language Models paper (Zhang/Kraska/Khattab, MIT CSAIL Jan 2026, agent_knowledge entry #2212): a small root model runs in a sandboxed REPL with the full content as a string variable and recursively calls a smaller sub-model on slices, then aggregates the results. USE WHEN: (1) you have 100K+ chars of source material, (2) a single LLM call would risk truncation / be too slow / cost too much, (3) the task is 'find the X across all of Y' or 'summarize across N documents' or 'extract every Z from this corpus'. Defaults to free modelfarm models ($0). Latency ~30-90s. Returns the final answer plus rounds/subCalls metadata. Hard caps: 8 root rounds, 50 sub-calls, 200K char sub-prompt.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The long source content. If you have multiple documents, concatenate them with clear separators like '=== DOC 1: title ===\\n...\\n=== DOC 2: title ===\\n...'.",
        },
        task: {
          type: "string",
          description: "What to extract / synthesize. Be specific. Examples: 'List every customer name mentioned, with the line number.' / 'Find the experiment with the highest score and explain why.' / 'Which of these 50 nightly research runs surfaced the same pattern more than once?'",
        },
        rootModel: {
          type: "string",
          description: "Optional override for the root model. Default 'gpt-5.5'. Avoid plain 'gpt-5' (routes to Anthropic which lacks chat.completions).",
        },
        subModel: {
          type: "string",
          description: "Optional override for the sub model. Default 'gpt-5-mini'. Should be cheaper/smaller than rootModel.",
        },
      },
      required: ["content", "task"],
    },
  },
};

export const trendResearchDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "trend_research",
    description: "Multi-source trend research tool inspired by /last30days. Searches Reddit, Hacker News, Polymarket prediction markets, and X/Twitter in parallel, then deduplicates, scores by relevance+engagement, and detects cross-platform convergence. Reddit/HN/Polymarket are free (no API keys); X search uses xAI API. Returns ranked items with engagement data, convergence themes, and a synthesis summary. Use this to research what people are actually saying, upvoting, and betting on about any topic.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The topic to research (e.g., 'AI agents', 'Claude Code vs Codex', 'agentic AI Chicago')" },
        days: { type: "number", description: "How many days back to search. Default: 30. Use 7 for very recent trends." },
        sources: { type: "array", items: { type: "string", enum: ["reddit", "hackernews", "polymarket", "x"] }, description: "Which sources to search. Default: all four." },
        depth: { type: "string", enum: ["quick", "default", "deep"], description: "Research depth. quick=fast/fewer results, deep=thorough/more results. Default: default." },
        max_results: { type: "number", description: "Maximum items to return. Default: 50." },
      },
      required: ["topic"],
    },
  },
};

export const findingsPublishDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "findings_publish",
    description: "R106 N2 / R125+15 — Share data with SIBLING in-flight subtasks (other chunks of the same chunk-and-parallel job). Two modes: (1) DISCOVERY (default, append-only) — broadcast a high-confidence find that saves sibling work (a working format, a confirmed fact, a clean asset, a safe scene-image prompt). (2) BLACKBOARD SLOT — pass slot_key to write a NAMED shared-state value with latest-wins semantics (e.g. slot_key:'outline'); siblings read the current value via findings_read. Pass claim:true with a slot_key to ATOMICALLY claim a unit of work for division-of-labor (e.g. slot_key:'section-3'); returns {won:true} for the first caller and {won:false, owner} for everyone after, so no two chunks duplicate the same work. Tenant-isolated.",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "The parallel-build job id (shared across all sibling chunks)." },
        subtask_id: { type: "string", description: "Your own chunk/subtask id — used so callers can exclude their own postings on read." },
        finding: { description: "Structured payload (object). Required for DISCOVERY and SLOT writes (it's the slot's value); NOT required when claim:true. Keep small (<2KB)." },
        confidence: { type: "number", description: "DISCOVERY mode only. 0–1. Default 0.7. Anything <0.6 is hidden from siblings (treated as scratch noise)." },
        slot_key: { type: "string", description: "BLACKBOARD mode. A stable name for a shared-state slot (e.g. 'outline', 'research', 'section-3'). Latest write wins on read. Required when claim:true." },
        claim: { type: "boolean", description: "With slot_key — atomically claim this slot for division-of-labor. Only the first caller wins; returns {won, owner}. Does not need a finding." },
      },
      required: ["job_id", "subtask_id"],
    },
  },
};

export const findingsReadDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "findings_read",
    description: "R106 N2 / R125+15 — Read what SIBLING subtasks have shared on a parallel-build job. THREE modes: (1) DISCOVERY (default) — NEW findings posted by siblings (excludes your own), cursor-paged via since_id, minConfidence 0.6 strips noise. (2) SLOT — pass slot_key to get the current latest-wins value of one named blackboard slot. (3) BOARD — pass mode:'board' to get the latest value of EVERY slot at once (great for the stitch step to assemble named parts deterministically). CALL THIS at the top of each iteration inside a chunk subagent so sibling work steers your next decision.",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "The shared parallel-build job id." },
        caller_subtask_id: { type: "string", description: "Your own chunk id — used to exclude your own postings (DISCOVERY mode)." },
        since_id: { type: "number", description: "DISCOVERY cursor — only return findings with id > since_id. Default 0." },
        min_confidence: { type: "number", description: "DISCOVERY mode. 0–1. Default 0.6." },
        limit: { type: "number", description: "DISCOVERY mode. Max rows. Default 50, capped 200." },
        slot_key: { type: "string", description: "SLOT mode — return the current value of this named blackboard slot." },
        mode: { type: "string", description: "Pass 'board' to return the latest value of every slot on the job." },
      },
      required: ["job_id"],
    },
  },
};

export const ingestPaperDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "ingest_paper",
    description: "Ingest a research paper (PDF or arXiv source tarball) into the knowledge library so future ensemble_query / search_knowledge / autoresearch can cite it. Idempotent — re-running on the same source is a no-op. Use when Bob attaches a paper in chat and wants it remembered, or when an arXiv tarball lands in attached_assets/. Accepts file_path (required, relative to project root), optional title_hint and source_url. Returns {ok, chunksWritten, chunksEmbedded, sourceLabel, warnings}.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the .pdf, .tar, or .tar.gz file (relative to project root, e.g. 'attached_assets/2604.18487v1_foo.pdf')" },
        title_hint: { type: "string", description: "Optional human-readable title; overrides title auto-detection" },
        source_url: { type: "string", description: "Optional canonical URL (e.g. arxiv abs page) for the source row" },
        image_summaries: { type: "boolean", description: "PDF only. When true, also render each page and embed a vision-LLM summary of its figures/diagrams/charts/tables into the same knowledge store (multimodal RAG). Costs one vision call per page (capped). Defaults to the INGEST_PDF_IMAGE_SUMMARIES env flag." },
      },
      required: ["file_path"],
    },
  },
};

/** Full ordered set, for any consumer that wants the domain's definitions. */
export const researchDomainDefinitions: ToolDefinition[] = [
  deepResearchDefinition,
  parallelResearchDefinition,
  researchDigestDefinition,
  recursiveSynthesizeDefinition,
  trendResearchDefinition,
  findingsPublishDefinition,
  findingsReadDefinition,
  ingestPaperDefinition,
];
