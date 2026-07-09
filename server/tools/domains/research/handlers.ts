/**
 * Tools-layer-split — research-domain migrated handlers.
 *
 * Selection: the 8 plain, self-contained research-cluster tools —
 * `deep_research`, `parallel_research`, `research_digest`,
 * `recursive_synthesize`, `trend_research`, `findings_publish`,
 * `findings_read`, `ingest_paper`.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, no added gate). The ONLY edits are
 * the trusted-context seams: `params._tenantId`→`ctx.tenantId` (the dispatcher
 * strips + re-stamps it from the trusted context). deep_research and
 * trend_research read no trust signal at all. No `_personaId` /
 * `_conversationId` / `_projectDriveFolderId` reads in this domain.
 *
 * Every external dependency is pulled via a call-time dynamic `import(...)`
 * inside the handler — NOT a top-level static import — so the domain module
 * statically imports only within server/tools/ and cannot recurse back into the
 * app graph (acyclicity invariant, plan.md S2; same seam S8–S23 used). In the
 * legacy facade `deep_research` used `deepResearch` from a tools.ts TOP-LEVEL
 * static import of `./research-pipeline`; here it is dynamic-imported from
 * `../../../research-pipeline` (behavior-identical). No tools.ts module-scope
 * helpers moved.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  deepResearchDefinition,
  parallelResearchDefinition,
  researchDigestDefinition,
  recursiveSynthesizeDefinition,
  trendResearchDefinition,
  findingsPublishDefinition,
  findingsReadDefinition,
  ingestPaperDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function deepResearchHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { deepResearch } = await import("../../../research-pipeline");
  console.log(`[research] Starting: ${params.question?.slice(0, 80)}`);
  const report = await deepResearch(params.question, params.depth || "standard");
  return {
    answer: report.answer,
    sources: report.sources,
    confidence: report.confidence,
    followUpQuestions: report.followUpQuestions,
    executionTimeMs: report.executionTimeMs,
  };
}

async function parallelResearchHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for parallel_research" };
  const tenantId = ctx.tenantId as number;
  const topics: string[] = Array.isArray(params.topics) ? params.topics.filter((t: any) => typeof t === "string" && t.trim()) : [];
  if (topics.length === 0) return { error: "At least one topic is required" };
  if (topics.length > 10) return { error: "Max 10 topics per parallel_research call" };
  const providerPref: string = params.provider || "auto";
  const concurrency = Math.max(1, Math.min(Number(params.concurrency) || 4, 8));

  try {
    const { runParallel } = await import("../../../agentic/executor");
    const { cachedPerplexitySearch, cachedFirecrawlSearch } = await import("../../../agentic/cached-tools");
    const { isPerplexityAvailable } = await import("../../../perplexity-search");
    const { isFirecrawlAvailable } = await import("../../../firecrawl");

    const usePerplexity = (providerPref === "perplexity" || providerPref === "auto") && isPerplexityAvailable();
    const useFirecrawl = !usePerplexity && (providerPref === "firecrawl" || providerPref === "auto") && isFirecrawlAvailable();

    const branches = topics.map((topic: string, idx: number) => ({
      id: `t${idx}`,
      input: topic,
      fn: async (query: string) => {
        if (usePerplexity) {
          const r = await cachedPerplexitySearch(query, tenantId);
          return { topic: query, provider: "perplexity", success: r.success, answer: r.answer, citations: r.citations, error: r.error };
        }
        if (useFirecrawl) {
          const r = await cachedFirecrawlSearch(query, 5, tenantId);
          return { topic: query, provider: "firecrawl", success: r.success, results: r.results, error: r.error };
        }
        return { topic: query, provider: "none", success: false, error: "No search provider available" };
      },
    }));

    const { runId, results } = await runParallel({
      tenantId,
      goal: `Parallel research: ${topics.length} topics`,
      branches,
      concurrency,
    });

    return {
      runId,
      topicCount: topics.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      totalDurationMs: Math.max(...results.map(r => r.durationMs)),
      results: results.map((r: any) => ({
        topic: r.value?.topic ?? topics[Number(String(r.id).slice(1))] ?? r.id,
        success: r.success,
        durationMs: r.durationMs,
        data: r.value,
        error: r.error,
      })),
    };
  } catch (err: any) {
    return { error: `parallel_research failed: ${err.message}` };
  }
}

async function researchDigestHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { generateResearchDigest } = await import("../../../research-engine");
  // R64.C — fail-closed: digests are per-tenant; never fall through to admin.
  if (!ctx.tenantId) return { error: "Tenant context required for research_digest" };
  return await generateResearchDigest(ctx.tenantId);
}

async function recursiveSynthesizeHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // Architect-flagged hardening (R74.13z-bis pass #2):
  //   (a) cap content at 2MB to bound memory before per-sub-call caps engage
  //   (b) restrict rootModel/subModel to a hard allowlist of $0 modelfarm
  //       models so personas can't quietly upgrade to a paid frontier model.
  //   (c) cap task at 8KB (it's repeated twice in the prompt envelope).
  const RLM_TOOL_MAX_CONTENT = 2_000_000;
  const RLM_TOOL_MAX_TASK = 8_000;
  const RLM_MODEL_ALLOWLIST = new Set([
    "gpt-5.4",
    "gpt-5.5",
    "gpt-5-mini",
    "gemini-2.5-flash",
  ]);
  const content = String(params.content ?? "");
  const task = String(params.task ?? "").trim();
  if (!content) return { error: "content is required (the long source text to synthesize over)" };
  if (!task) return { error: "task is required (what to extract / synthesize)" };
  if (content.length > RLM_TOOL_MAX_CONTENT) {
    return { error: `content exceeds the per-call cap of ${RLM_TOOL_MAX_CONTENT.toLocaleString()} chars (got ${content.length.toLocaleString()}). Pre-summarize, slice, or split into multiple calls.` };
  }
  if (task.length > RLM_TOOL_MAX_TASK) {
    return { error: `task exceeds the cap of ${RLM_TOOL_MAX_TASK.toLocaleString()} chars (got ${task.length.toLocaleString()}). Tasks should be a focused question, not embedded source material — put source in 'content'.` };
  }
  const requestedRoot = params.rootModel ? String(params.rootModel) : undefined;
  const requestedSub = params.subModel ? String(params.subModel) : undefined;
  if (requestedRoot && !RLM_MODEL_ALLOWLIST.has(requestedRoot)) {
    return { error: `rootModel='${requestedRoot}' is not on the recursive_synthesize allowlist. Allowed: ${[...RLM_MODEL_ALLOWLIST].join(", ")}. The allowlist enforces $0 modelfarm-only execution; paid models are blocked here even when the rest of the platform allows them.` };
  }
  if (requestedSub && !RLM_MODEL_ALLOWLIST.has(requestedSub)) {
    return { error: `subModel='${requestedSub}' is not on the recursive_synthesize allowlist. Allowed: ${[...RLM_MODEL_ALLOWLIST].join(", ")}.` };
  }
  const { runRecursiveLLM } = await import("../../../recursive-llm");
  const wrappedPrompt = `${task}\n\n=== SOURCE CONTENT START ===\n${content}\n=== SOURCE CONTENT END ===\n\nTask (repeated): ${task}`;
  const t0 = Date.now();
  try {
    const result = await runRecursiveLLM(wrappedPrompt, {
      tenantId: ctx.tenantId ?? undefined,
      rootModel: requestedRoot,
      subModel: requestedSub,
      taskHint: task.slice(0, 1500),
    });
    const elapsedMs = Date.now() - t0;
    return {
      success: result.ok,
      answer: result.answer,
      rounds: result.rounds,
      subCalls: result.subCalls,
      totalSubPromptChars: result.totalSubPromptChars,
      totalSubResponseChars: result.totalSubResponseChars,
      rootModel: result.rootModel,
      subModel: result.subModel,
      elapsedMs,
      contentChars: content.length,
      error: result.error,
    };
  } catch (err: any) {
    return { success: false, error: `recursive_synthesize threw: ${String(err?.message || err).slice(0, 300)}` };
  }
}

async function trendResearchHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const { trendResearch } = await import("../../../trend-research");
    const result = await trendResearch({
      topic: params.topic,
      days: params.days,
      sources: params.sources,
      depth: params.depth,
      maxResults: params.max_results,
    });
    return result;
  } catch (err: any) {
    return { error: `Trend research failed: ${err.message}` };
  }
}

async function findingsPublishHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for findings_publish" };
  if (!params.job_id || !params.subtask_id) {
    return { error: "job_id and subtask_id are required" };
  }
  try {
    // R125+15 — blackboard claim mode: atomic division-of-labor. A claim
    // needs only job_id + subtask_id + slot_key (no finding payload).
    if (params.claim === true) {
      if (!params.slot_key) return { error: "claim requires slot_key" };
      const { claimSlot } = await import("../../../lib/parallel-findings-bus");
      const res = await claimSlot({
        tenantId: ctx.tenantId,
        jobId: String(params.job_id),
        subtaskId: String(params.subtask_id),
        slotKey: String(params.slot_key),
      });
      return { ok: true, claimed: res.won, owner: res.owner };
    }
    // DISCOVERY + SLOT writes carry a value.
    if (params.finding === undefined) return { error: "finding is required (omit only when claim:true)" };
    const { publishFinding } = await import("../../../lib/parallel-findings-bus");
    const row = await publishFinding({
      tenantId: ctx.tenantId,
      jobId: String(params.job_id),
      subtaskId: String(params.subtask_id),
      finding: params.finding,
      confidence: typeof params.confidence === "number" ? params.confidence : undefined,
      slotKey: params.slot_key ? String(params.slot_key) : undefined,
    });
    return { ok: true, id: row.id, confidence: row.confidence, slot_key: row.slotKey ?? undefined };
  } catch (e: any) { return { error: e?.message || String(e) }; }
}

async function findingsReadHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for findings_read" };
  if (!params.job_id) return { error: "job_id is required" };
  // R125+15 — blackboard read modes.
  if (params.mode === "board") {
    const { readBoard } = await import("../../../lib/parallel-findings-bus");
    const slots = await readBoard({ tenantId: ctx.tenantId, jobId: String(params.job_id) });
    return { count: slots.length, slots };
  }
  if (params.slot_key) {
    const { readSlot } = await import("../../../lib/parallel-findings-bus");
    const slot = await readSlot({ tenantId: ctx.tenantId, jobId: String(params.job_id), slotKey: String(params.slot_key) });
    return { slot };
  }
  const { readFindings } = await import("../../../lib/parallel-findings-bus");
  const rows = await readFindings({
    tenantId: ctx.tenantId,
    jobId: String(params.job_id),
    callerSubtaskId: params.caller_subtask_id ? String(params.caller_subtask_id) : undefined,
    sinceId: typeof params.since_id === "number" ? params.since_id : undefined,
    minConfidence: typeof params.min_confidence === "number" ? params.min_confidence : undefined,
    limit: typeof params.limit === "number" ? params.limit : undefined,
  });
  const cursor = rows.length > 0 ? rows[rows.length - 1].id : (typeof params.since_id === "number" ? params.since_id : 0);
  return { count: rows.length, next_since_id: cursor, findings: rows };
}

async function ingestPaperHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R113+ — paper-ingestion pipeline: PDF / arXiv tarball → chunked + embedded
  // rows in agent_knowledge. Tenant-scoped + idempotent (re-running on the
  // same source is a no-op). Used to make papers Bob attaches in chat
  // citable by ensemble_query / Neptune / Robert / autoresearch.
  if (!ctx.tenantId) return { error: "Tenant context required for ingest_paper" };
  if (!params.file_path) return { error: "ingest_paper requires file_path" };
  try {
    const { ingestPaper } = await import("../../../lib/paper-ingest");
    const res = await ingestPaper({
      filePath: String(params.file_path),
      tenantId: ctx.tenantId,
      titleHint: params.title_hint ? String(params.title_hint) : undefined,
      sourceUrl: params.source_url ? String(params.source_url) : undefined,
      imageSummaries: typeof params.image_summaries === "boolean" ? params.image_summaries : undefined,
    });
    return res;
  } catch (e: any) {
    return { ok: false, error: e?.message || "ingest_paper failed" };
  }
}

/** Registered by ./index.ts at import time. */
export const researchDomainTools: RegisteredTool[] = [
  defineTool(deepResearchDefinition, deepResearchHandler),
  defineTool(parallelResearchDefinition, parallelResearchHandler),
  defineTool(researchDigestDefinition, researchDigestHandler),
  defineTool(recursiveSynthesizeDefinition, recursiveSynthesizeHandler),
  defineTool(trendResearchDefinition, trendResearchHandler),
  defineTool(findingsPublishDefinition, findingsPublishHandler),
  defineTool(findingsReadDefinition, findingsReadHandler),
  defineTool(ingestPaperDefinition, ingestPaperHandler),
];
