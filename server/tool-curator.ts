/**
 * R59 Tool Curator — the central enrichment layer for tool routing.
 *
 * Combines four signals on top of the existing keyword router:
 *   1. Usage hints (tool-usage-hints.ts) for richer "use when" matching.
 *   2. Embedding-based semantic similarity for fallback when keywords miss.
 *   3. Per-tenant tool_performance scoring for re-ranking.
 *   4. Soft deprecation list (config-driven, not DB-stored) so dead tools
 *      stop crowding the prompt without losing their code.
 *
 * Failure mode: every public method is fail-OPEN — on error, returns a
 * neutral default (no boost, no penalty, not deprecated, no semantic match).
 * The router can call any of these methods and a curator outage will simply
 * regress routing to the prior keyword-only behavior.
 *
 * Caching: tenant-scoped 5-minute TTL on perf + deprecation. Embeddings are
 * persisted to .cache/tool-embeddings.json with a content-hash header so
 * they only get recomputed when a tool's description or hint corpus changes.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { generateEmbedding, cosineSimilarity } from "./embeddings";
import { TOOL_USAGE_HINTS, buildHintCorpus, getHintedToolNames } from "./tool-usage-hints";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const CACHE_DIR = ".cache";
const EMBEDDINGS_CACHE_FILE = path.join(CACHE_DIR, "tool-embeddings.json");
const PERF_CACHE_TTL_MS = 5 * 60 * 1000;
const DEPRECATION_CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Soft-deprecation list ─────────────────────────────────────────────
// Tools listed here are HIDDEN from the router by default. They remain
// callable when explicitly named in a forceCategories or toolFilter.
// Populate via a one-time scan — see /api/admin/tool-curator-status.
// Keep this hand-edited so nothing gets removed accidentally.
export const SOFT_DEPRECATED_TOOLS: Set<string> = new Set([
  // R125+9.1 candidate review (2026-05-24): The Zombie Detector + 30d
  // agent_trace_spans scan surfaced these 21 tools as untraced. DO NOT
  // uncomment blindly — agent_trace_spans is sparsely populated, and
  // several of these are actively used in production but bypass tracing
  // (post-edit-pipeline emails, BWB video PDFs, etc).
  //
  // Triage status:
  //   PRODUCTION-IN-USE (do not deprecate, fix instrumentation instead):
  //     "send_email", "post_x", "drive_upload", "render_pdf", "web_search",
  //     "create_memory", "search_memory",
  //
  //   GENUINE CANDIDATES (review + uncomment one at a time, watch for regressions):
  //     "aevo_meta_editing",        // legacy editing tool, superseded by FFmpeg pipeline
  //     "code_proposal",            // earlier code-suggestion pattern, now built into Felix
  //     "compress_context",         // pre-MNEMA token-saver, MNEMA handles compaction now
  //     "cost_eval",                // early cost-estimator, replaced by upfront-estimates
  //     "create_plan",              // session_plan workflow replaces this
  //     "get_usage_analytics",      // pre-Hyperagent dashboard, now /admin/ecosystem-health
  //     "llm_task",                 // generic catch-all, eclipsed by typed tools
  //     "monid_catalog_browse",     // R125+13.12 — Monid uncommented; 166-endpoint catalog now active, powers Creator Sponsor Ops Pro tier brand-discovery + cheap OCR alt for Archive Rescue demo path
  //     "monid_discover",
  //     "monid_inspect",
  //     "monid_run",
  //     "scan_for_prompt_injection",// fold into intent-gate AHB layer instead
  //     "scan_for_secrets",         // covered by HoundDog + git pre-commit
  //     "verify_proposal",          // pair of `code_proposal`, retire together
]);

// ─── Embedding cache (process-local + disk-persistent) ─────────────────
interface ToolEmbeddingEntry {
  toolName: string;
  contentHash: string;
  embedding: number[];
}

interface EmbeddingsCacheFile {
  version: number;
  generatedAt: string;
  entries: ToolEmbeddingEntry[];
}

const _embeddingMap = new Map<string, ToolEmbeddingEntry>();
let _embeddingsLoaded = false;
let _precomputeInFlight: Promise<void> | null = null;

function buildContentHash(toolName: string, description: string): string {
  const corpus = buildHintCorpus(toolName);
  return createHash("sha256").update(`${toolName}::${description}::${corpus}`).digest("hex").slice(0, 16);
}

function buildToolEmbeddingText(toolName: string, description: string): string {
  const hintCorpus = buildHintCorpus(toolName);
  const parts = [`Tool: ${toolName}`, `Description: ${description}`];
  if (hintCorpus) parts.push(`Use when: ${hintCorpus}`);
  return parts.join(". ");
}

function loadEmbeddingsFromDisk(): void {
  if (_embeddingsLoaded) return;
  _embeddingsLoaded = true;
  try {
    if (!fs.existsSync(EMBEDDINGS_CACHE_FILE)) return;
    const raw = fs.readFileSync(EMBEDDINGS_CACHE_FILE, "utf8");
    const parsed: EmbeddingsCacheFile = JSON.parse(raw);
    if (parsed.version !== 1) return;
    for (const entry of parsed.entries) {
      _embeddingMap.set(entry.toolName, entry);
    }
    console.log(`[tool-curator] Loaded ${_embeddingMap.size} tool embeddings from cache (generated ${parsed.generatedAt})`);
  } catch (err) {
    console.warn("[tool-curator] Failed to load embeddings cache:", (err as Error).message);
  }
}

function saveEmbeddingsToDisk(): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file: EmbeddingsCacheFile = {
      version: 1,
      generatedAt: new Date().toISOString(),
      entries: [..._embeddingMap.values()],
    };
    fs.writeFileSync(EMBEDDINGS_CACHE_FILE, JSON.stringify(file));
  } catch (err) {
    console.warn("[tool-curator] Failed to save embeddings cache:", (err as Error).message);
  }
}

/**
 * Precompute embeddings for all tools whose description+hint corpus has
 * changed since the last run. Idempotent and safe to call repeatedly. Runs
 * at most once concurrently (debounced via _precomputeInFlight).
 *
 * Cost: One OpenAI embeddings call per CHANGED tool. With cache hits, this
 * is typically 0–5 calls per startup. First run on an empty cache will
 * make ~243 calls (~0.001 each on text-embedding-3-small ≈ $0.05 total).
 */
export async function precomputeEmbeddings(
  toolDefs: { function: { name: string; description: string } }[]
): Promise<{ generated: number; reused: number; failed: number; total: number }> {
  if (_precomputeInFlight) {
    await _precomputeInFlight;
    return { generated: 0, reused: _embeddingMap.size, failed: 0, total: toolDefs.length };
  }

  let resolveFn: () => void = () => {};
  _precomputeInFlight = new Promise<void>(r => { resolveFn = r; });

  try {
    loadEmbeddingsFromDisk();
    let generated = 0, reused = 0, failed = 0;

    for (const def of toolDefs) {
      const name = def.function.name;
      const desc = def.function.description || "";
      const hash = buildContentHash(name, desc);
      const existing = _embeddingMap.get(name);
      if (existing && existing.contentHash === hash) {
        reused++;
        continue;
      }
      try {
        const text = buildToolEmbeddingText(name, desc);
        const emb = await generateEmbedding(text);
        if (!emb) { failed++; continue; }
        _embeddingMap.set(name, { toolName: name, contentHash: hash, embedding: emb });
        generated++;
      } catch (err) {
        failed++;
        console.warn(`[tool-curator] Embed failed for ${name}:`, (err as Error).message);
      }
    }

    if (generated > 0) saveEmbeddingsToDisk();
    console.log(`[tool-curator] Embeddings: ${generated} new, ${reused} cached, ${failed} failed (${toolDefs.length} total)`);
    return { generated, reused, failed, total: toolDefs.length };
  } finally {
    resolveFn();
    _precomputeInFlight = null;
  }
}

/**
 * Semantic ranking: returns top-K tool names whose embeddings best match
 * the user message. Returns [] if embeddings unavailable.
 *
 * If `candidatePool` is provided, only ranks within that subset.
 */
export async function semanticRank(
  userMessage: string,
  options?: { topK?: number; candidatePool?: Set<string>; minScore?: number }
): Promise<{ name: string; score: number }[]> {
  const topK = options?.topK ?? 8;
  const minScore = options?.minScore ?? 0.25;
  try {
    if (!userMessage || userMessage.length < 4) return [];
    loadEmbeddingsFromDisk();
    if (_embeddingMap.size === 0) return [];

    const queryEmb = await generateEmbedding(userMessage);
    if (!queryEmb) return [];

    const scored: { name: string; score: number }[] = [];
    for (const entry of _embeddingMap.values()) {
      if (options?.candidatePool && !options.candidatePool.has(entry.toolName)) continue;
      const score = cosineSimilarity(queryEmb, entry.embedding);
      if (score >= minScore) {
        scored.push({ name: entry.toolName, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  } catch (err) {
    console.warn("[tool-curator] semanticRank failed:", (err as Error).message);
    return [];
  }
}

// ─── Performance scoring (per-tenant cached) ──────────────────────────
interface PerfRow {
  tool_name: string;
  success_count: number;
  fail_count: number;
  last_success_at: Date | null;
  last_failure_at: Date | null;
}
interface PerfCacheEntry {
  loadedAt: number;
  scores: Map<string, number>; // toolName → 0..1
}
const _perfCache = new Map<number, PerfCacheEntry>();

async function loadPerfScores(tenantId: number): Promise<Map<string, number>> {
  const cached = _perfCache.get(tenantId);
  if (cached && Date.now() - cached.loadedAt < PERF_CACHE_TTL_MS) return cached.scores;

  try {
    const result: any = await db.execute(sql`
      SELECT tool_name, success_count, fail_count, last_success_at, last_failure_at
      FROM tool_performance
      WHERE tenant_id = ${tenantId}
    `);
    const rows: PerfRow[] = result.rows || result;
    const scores = new Map<string, number>();
    const now = Date.now();
    for (const r of rows) {
      const total = (r.success_count || 0) + (r.fail_count || 0);
      if (total === 0) continue;
      const successRatio = (r.success_count || 0) / total;
      const recencyMs = r.last_success_at ? now - new Date(r.last_success_at).getTime() : Infinity;
      const recencyDays = recencyMs / (1000 * 60 * 60 * 24);
      // recencyBonus: 1.0 if used in last 7d, decays to 0.5 at 60d
      const recencyBonus = recencyDays < 7 ? 1.0 : recencyDays < 60 ? 1.0 - (recencyDays - 7) / 106 : 0.5;
      // volume saturation: more invocations = more confidence in the ratio
      const volumeWeight = Math.min(1, total / 20);
      // Final 0..1 score
      const score = (successRatio * 0.5 + recencyBonus * 0.3 + volumeWeight * 0.2);
      scores.set(r.tool_name, Math.max(0, Math.min(1, score)));
    }
    _perfCache.set(tenantId, { loadedAt: Date.now(), scores });
    return scores;
  } catch (err) {
    console.warn(`[tool-curator] Perf load failed for tenant ${tenantId}:`, (err as Error).message);
    const empty = new Map<string, number>();
    _perfCache.set(tenantId, { loadedAt: Date.now(), scores: empty });
    return empty;
  }
}

export async function getPerformanceScore(tenantId: number, toolName: string): Promise<number> {
  const scores = await loadPerfScores(tenantId);
  // Default: 0.5 (neutral) for tools with no history
  return scores.get(toolName) ?? 0.5;
}

/**
 * Stable re-rank a list of tool names by performance score, preserving
 * relative order within ties. Tools with no history get neutral 0.5.
 */
export async function rankByPerformance(
  tenantId: number,
  toolNames: string[]
): Promise<string[]> {
  const scores = await loadPerfScores(tenantId);
  const indexed = toolNames.map((name, idx) => ({
    name,
    score: scores.get(name) ?? 0.5,
    idx,
  }));
  indexed.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return indexed.map(e => e.name);
}

// ─── Soft deprecation ──────────────────────────────────────────────────
// Snapshot the file-constant SOFT_DEPRECATED_TOOLS at module load — these are
// the hand-curated entries. Anything added at runtime via setSoftDeprecated()
// goes into _autoDeprecated. clearAutoDeprecations() removes ONLY auto entries
// from SOFT_DEPRECATED_TOOLS, leaving hand-curated overlaps intact (R65 fix
// for architect finding #4: "auto/hand-curated overlap").
const _handCurated: Set<string> = new Set(SOFT_DEPRECATED_TOOLS);
const _autoDeprecated = new Set<string>();

export function setSoftDeprecated(toolName: string, isAuto: boolean = false): void {
  SOFT_DEPRECATED_TOOLS.add(toolName);
  if (isAuto) _autoDeprecated.add(toolName);
}

export function unsetSoftDeprecated(toolName: string): void {
  SOFT_DEPRECATED_TOOLS.delete(toolName);
  _autoDeprecated.delete(toolName);
  _handCurated.delete(toolName);
}

/**
 * Remove only auto-engine entries from SOFT_DEPRECATED_TOOLS. Tools that are
 * BOTH auto-flagged AND hand-curated remain in SOFT_DEPRECATED_TOOLS (the
 * hand-curation wins). _autoDeprecated is fully cleared regardless.
 */
export function clearAutoDeprecations(): void {
  for (const name of _autoDeprecated) {
    if (!_handCurated.has(name)) {
      SOFT_DEPRECATED_TOOLS.delete(name);
    }
  }
  _autoDeprecated.clear();
}

export function getAutoDeprecatedNames(): string[] {
  return [..._autoDeprecated].sort();
}

export function getHandCuratedDeprecations(): string[] {
  return [..._handCurated].sort();
}

export function isDeprecated(toolName: string): boolean {
  return SOFT_DEPRECATED_TOOLS.has(toolName);
}

export function filterDeprecated<T extends { function: { name: string } }>(
  tools: T[]
): T[] {
  if (SOFT_DEPRECATED_TOOLS.size === 0) return tools;
  return tools.filter(t => !SOFT_DEPRECATED_TOOLS.has(t.function.name));
}

// ─── Hint-based keyword expansion ─────────────────────────────────────
/**
 * Scans usage hints for fuzzy matches against the user message and returns
 * { toolName: matchScore } for tools whose hints overlap. The router can
 * fold this into its category scoring as an additional signal.
 */
export function matchHintsToMessage(userMessage: string): Map<string, number> {
  const matches = new Map<string, number>();
  const msg = userMessage.toLowerCase();
  if (msg.length < 4) return matches;

  for (const [toolName, hint] of Object.entries(TOOL_USAGE_HINTS)) {
    let score = 0;
    for (const trigger of hint.exampleTriggers) {
      if (msg.includes(trigger.toLowerCase())) {
        score += trigger.includes(" ") ? 4 : 2;
      }
    }
    for (const phrase of hint.useWhen) {
      // Score each non-stop word that overlaps
      const words = phrase.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      let hits = 0;
      for (const w of words) {
        if (msg.includes(w)) hits++;
      }
      if (hits >= 2) score += hits;
    }
    if (score > 0) matches.set(toolName, score);
  }
  return matches;
}

// ─── Stats / observability ─────────────────────────────────────────────
export function getCuratorStats(): {
  hintCoverage: number;
  hintedTools: number;
  embeddingsCached: number;
  embeddingsCacheFile: string;
  embeddingsCacheExists: boolean;
  perfCacheTenants: number;
  softDeprecated: number;
} {
  loadEmbeddingsFromDisk();
  return {
    hintCoverage: getHintedToolNames().length,
    hintedTools: getHintedToolNames().length,
    embeddingsCached: _embeddingMap.size,
    embeddingsCacheFile: EMBEDDINGS_CACHE_FILE,
    embeddingsCacheExists: fs.existsSync(EMBEDDINGS_CACHE_FILE),
    perfCacheTenants: _perfCache.size,
    softDeprecated: SOFT_DEPRECATED_TOOLS.size,
  };
}

/** Drop perf cache for a tenant (call after large invocation bursts). */
export function invalidatePerfCache(tenantId?: number): void {
  if (tenantId === undefined) _perfCache.clear();
  else _perfCache.delete(tenantId);
}
